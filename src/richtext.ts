// Форматирование: Markdown → HTML при отправке, безопасный показ HTML из входящих сообщений.
import DOMPurify from "dompurify";
import { marked } from "marked";

// Теги и атрибуты, разрешённые спецификацией Matrix для formatted_body
const ALLOWED_TAGS = [
  "font", "del", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "sup", "sub",
  "li", "b", "i", "u", "strong", "em", "strike", "s", "code", "hr", "br", "div", "table", "thead",
  "tbody", "tr", "th", "td", "caption", "pre", "span", "details", "summary",
];
const ALLOWED_ATTR = ["href", "title", "data-mx-color", "data-mx-bg-color", "class", "start", "colspan", "rowspan"];

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      // Упоминания пользователей (matrix.to/#/@user) показываем «плашкой»
      const m = href.match(/^https:\/\/matrix\.to\/#\/(@[^/?]+)/);
      if (m) node.setAttribute("class", "mention-pill");
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute("href");
    }
    if (node.tagName === "CODE" && !/^language-[\w-]+$/.test(node.getAttribute("class") ?? "")) {
      node.removeAttribute("class");
    }
    if (node.tagName !== "A" && node.tagName !== "CODE") node.removeAttribute("class");
  });
}

/** Чистит HTML из сообщения; убирает устаревшую цитату ответа <mx-reply>. */
export function sanitizeMessageHtml(html: string): string {
  ensureHooks();
  const withoutReply = html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "");
  return DOMPurify.sanitize(withoutReply, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
}

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Превращает текст с Markdown в content для отправки.
 * Если форматирования нет — отправляем только body, как Element.
 */
export function textToContent(text: string): { body: string; format?: string; formatted_body?: string } {
  const html = (marked.parse(text, { async: false }) as string).trim();
  const single = html.match(/^<p>([\s\S]*)<\/p>$/);
  const inner = single && !single[1].includes("<p>") ? single[1] : null;
  // Если Markdown ничего не добавил (обычный текст) — отправляем только body, как Element
  if (inner !== null && inner.replace(/<br>\n?/g, "\n") === escapeHtml(text)) return { body: text };
  return { body: text, format: "org.matrix.custom.html", formatted_body: sanitizeMessageHtml(inner ?? html) };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]}'»]/gi;

/** Разбивает простой текст на куски «текст / ссылка» для автоссылок. */
export function linkify(text: string): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Текст из HTML — для цитат и превью. */
export function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = sanitizeMessageHtml(html);
  return div.textContent ?? "";
}
