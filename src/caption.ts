// Подписи к файлам (MSC2530, как в Element): у файла с подписью `filename` — имя файла,
// а `body` (и `formatted_body`) — текст подписи. Без подписи `body` совпадает с именем
// или `filename` нет вовсе (старые клиенты кладут имя в `body`).
import { textToContent } from "./richtext";

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
