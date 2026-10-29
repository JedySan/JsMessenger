// Форматирование дат и превью сообщений.
import { EventType, MsgType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { locale, tr } from "./i18n";
import { htmlToText } from "./richtext";
import { captionOf, fileNameOf } from "./caption";
import { POLL_START, pollPreview } from "./polls";

const VISIBLE = new Set<string>([EventType.RoomMessage, EventType.RoomMessageEncrypted, EventType.Sticker, ...POLL_START]);

export function isVisibleMessage(e: MatrixEvent): boolean {
  // удалённые сообщения показываем заглушкой «Сообщение удалено»
  return VISIBLE.has(e.getType()) && !e.isRelation("m.replace");
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function timeHM(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Время для списка чатов: сегодня — часы, на неделе — день недели, иначе дата. */
export function listTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return timeHM(ts);
  if (days === 1) return tr("вчера");
  if (days < 7) return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: days > 300 ? "2-digit" : undefined });
}

/** Подпись разделителя дня в ленте. */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return tr("Сегодня");
  if (days === 1) return tr("Вчера");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: sameYear ? undefined : "numeric" });
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

function withCaption(label: string, content: Record<string, any>): string {
  const cap = captionOf(content);
  return cap ? `${label} · ${(cap.html ? htmlToText(cap.html) : cap.text).replace(/\s+/g, " ").trim()}` : label;
}

/** Короткое превью последнего сообщения комнаты. */
export function lastMessagePreview(room: Room, myUserId: string, isDm = false): { text: string; ts: number } | null {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!isVisibleMessage(e)) continue;
    const content = e.replacingEvent()?.getContent()["m.new_content"] ?? e.getContent();
    let text: string;
    if (e.isRedacted()) text = tr("Сообщение удалено");
    else if (e.isDecryptionFailure() || e.getType() === EventType.RoomMessageEncrypted) text = tr("Зашифрованное сообщение");
    else if (POLL_START.includes(e.getType())) text = pollPreview(e);
    else if (content.msgtype === MsgType.Image) text = withCaption(tr("Фото"), content);
    else if (content.msgtype === MsgType.File) text = withCaption(tr("Файл: {0}", fileNameOf(content)), content);
    else if (content.msgtype === MsgType.Video) text = withCaption(tr("Видео"), content);
    else if (content.msgtype === MsgType.Audio) text = content["org.matrix.msc3245.voice"] ? tr("Голосовое сообщение") : tr("Аудио");
    else if (content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string")
      text = htmlToText(content.formatted_body).replace(/\s+/g, " ").trim(); // без значков Markdown
    else text = stripReplyFallback(String(content.body ?? "")).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
    const sender = e.getSender();
    const who = sender === myUserId ? tr("Вы") : isDm ? null : (room.getMember(sender ?? "")?.name ?? null);
    return { text: who ? `${who}: ${text}` : text, ts: e.getTs() };
  }
  return null;
}

/** Убирает цитату-«фоллбек» ответа ("> <@user> текст") из тела сообщения. */
export function stripReplyFallback(body: string): string {
  const lines = body.split("\n");
  if (!lines[0]?.startsWith("> <")) return body;
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

/** Инициалы для аватара. */
export function initials(name: string): string {
  const parts = name.replace(/^[@#!]/, "").split(/[\s._:-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Приглушённые оттенки для аватаров без картинки; один и тот же id всегда даёт один цвет
const AVATAR_HUES = [174, 205, 262, 330, 28, 96, 225];
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length];
}
