// Подписи к файлам (MSC2530, как в Element): у файла с подписью `filename` — имя файла,
// а `body` (и `formatted_body`) — текст подписи. Без подписи `body` совпадает с именем
// или `filename` нет вовсе (старые клиенты кладут имя в `body`).
import { textToContent } from "./richtext";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

export function fileNameOf(content: Record<string, any>): string {
  return String(content.filename || content.body || "");
}

/** Текст подписи или null, если подписи нет. */
export function captionOf(content: Record<string, any>): { text: string; html?: string } | null {
  const name = content.filename;
  const body = content.body;
  if (typeof name !== "string" || !name || typeof body !== "string" || !body.trim() || body === name) return null;
  const html = content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string" ? content.formatted_body : undefined;
  return { text: body, html };
}

/** Поля сообщения для подписи (с Markdown, как у обычных сообщений). */
export function captionFields(caption: string): Record<string, string> | undefined {
  const t = caption.trim();
  if (!t) return undefined;
  return textToContent(t) as Record<string, string>;
}

// ---------- Подпись отдельным сообщением (для старого Element) ----------
// Старый Element не показывает подписи MSC2530, поэтому отправляем вложение без подписи,
// а следом — обычное текстовое сообщение с пометкой `jsm.caption_for: <id вложения>`.
// Чужие клиенты видят картинку и под ней текст; у нас они склеиваются в одно сообщение.

export const CAPTION_FOR = "jsm.caption_for";
/** Причина удаления подписи — чтобы на месте удалённой подписи не было заглушки. */
export const CAPTION_REDACT_REASON = "jsm.caption";

/** id вложения → событие-подпись (заполняет linkCaptions при показе ленты). */
const linked = new Map<string, MatrixEvent>();

function isCaptionRedaction(e: MatrixEvent): boolean {
  return e.isRedacted() && (e.getUnsigned() as any)?.redacted_because?.content?.reason === CAPTION_REDACT_REASON;
}

/**
 * Из списка видимых сообщений убирает подписи-сообщения, у которых вложение рядом в ленте
 * (тот же отправитель), и запоминает связь — Message покажет подпись под вложением.
 */
export function linkCaptions(events: MatrixEvent[]): MatrixEvent[] {
  const byId = new Map<string, MatrixEvent>();
  for (const e of events) {
    const id = e.getId();
    if (id) byId.set(id, e);
  }
  const hidden = new Set<MatrixEvent>();
  for (const e of events) {
    if (isCaptionRedaction(e)) {
      hidden.add(e);
      continue;
    }
    if (e.isRedacted()) continue;
    const target = e.getContent()[CAPTION_FOR];
    if (typeof target !== "string") continue;
    const media = byId.get(target);
    if (!media || media.isRedacted() || media.getSender() !== e.getSender()) continue;
    linked.set(target, e);
    hidden.add(e);
  }
  return hidden.size ? events.filter((e) => !hidden.has(e)) : events;
}

/** Событие-подпись этого вложения, если есть. */
export function captionEventOf(media: MatrixEvent): MatrixEvent | undefined {
  const c = linked.get(media.getId() ?? "");
  return c && !c.isRedacted() ? c : undefined;
}

/** Содержимое вложения с подписью из отдельного сообщения — в виде MSC2530, как будто подпись внутри. */
export function mergeCaption(media: MatrixEvent, content: Record<string, any>): Record<string, any> {
  const cap = captionEventOf(media);
  if (!cap) return content;
  const cc = cap.replacingEvent()?.getContent()["m.new_content"] ?? cap.getContent();
  const text = typeof cc.body === "string" ? cc.body : "";
  if (!text.trim()) return content;
  const { format: _f, formatted_body: _fb, ...rest } = content;
  return {
    ...rest,
    filename: fileNameOf(content),
    body: text,
    ...(cc.format && typeof cc.formatted_body === "string" ? { format: cc.format, formatted_body: cc.formatted_body } : {}),
  };
}

/** Тред вложения — подпись кладём туда же. */
export function captionRelation(media: { threadRootId?: string; id: string }): Record<string, unknown> | undefined {
  if (!media.threadRootId || media.threadRootId === media.id) return undefined;
  return { rel_type: "m.thread", event_id: media.threadRootId, is_falling_back: true, "m.in_reply_to": { event_id: media.id } };
}

/** Отправить подпись отдельным сообщением к вложению mediaId. */
export async function sendCaption(
  client: MatrixClient,
  roomId: string,
  mediaId: string,
  fields: Record<string, unknown>,
  threadRootId?: string,
): Promise<void> {
  const content: Record<string, unknown> = { msgtype: "m.text", ...fields, [CAPTION_FOR]: mediaId };
  const rel = captionRelation({ threadRootId, id: mediaId });
  if (rel) content["m.relates_to"] = rel;
  await client.sendMessage(roomId, content as any);
}
