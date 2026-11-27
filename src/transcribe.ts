// Расшифровка голосовых (JsMessenger Plus): звук расшифровываем у себя и отправляем на сервер JsMessenger,
// он распознаёт речь и возвращает текст. Готовый текст помним на этом устройстве — второй раз не просим.
import type { MatrixClient } from "matrix-js-sdk";
import { downloadMedia } from "./attachments";
import { plusApi, PlusError } from "./plus";
import { tr } from "./i18n";

const KEY = "jsm.transcripts";
const MAX_KEEP = 400;

type Store = Record<string, { text: string; ts: number }>;
function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const mediaKey = (content: Record<string, any>): string => content.file?.url ?? content.url ?? "";

/** Уже расшифрованное (на этом устройстве). */
export function savedTranscript(content: Record<string, any>): string | undefined {
  const k = mediaKey(content);
  return k ? load()[k]?.text : undefined;
}

function remember(content: Record<string, any>, text: string) {
  const k = mediaKey(content);
  if (!k) return;
  const s = load();
  s[k] = { text, ts: Date.now() };
  const keys = Object.keys(s);
  if (keys.length > MAX_KEEP) keys.sort((a, b) => s[a].ts - s[b].ts).slice(0, keys.length - MAX_KEEP).forEach((x) => delete s[x]);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* не запомним — расшифруем ещё раз, если попросят */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running = new Map<string, Promise<string>>();

/** Расшифровать голосовое. onQueue — место в очереди на сервере (0 — уже распознаётся). */
export function transcribe(client: MatrixClient, content: Record<string, any>, onQueue?: (pos: number) => void): Promise<string> {
  const k = mediaKey(content);
  const known = running.get(k);
  if (known) return known;
  const p = (async () => {
    const blob = await downloadMedia(client, content);
    const type = (blob.type || "audio/ogg").split(";")[0];
    // язык речи сервер определяет сам: голосовые бывают на любом
    const start = await plusApi(client, "/api/plus/transcribe?lang=auto", { method: "POST", body: blob, contentType: type.startsWith("audio/") || type.startsWith("video/") ? type : "audio/ogg" });
    const id: string = start.id;
    onQueue?.(start.position ?? 0);
    for (let i = 0; ; i++) {
      await sleep(i < 5 ? 1500 : 3000);
      const r = await plusApi(client, `/api/plus/transcribe/${id}`);
      if (r.status === "done") {
        const text = String(r.text ?? "").trim();
        remember(content, text);
        return text;
      }
      if (r.status === "error") throw new PlusError(r.error ?? "failed", "failed");
      onQueue?.(r.status === "queued" ? (r.position ?? 1) : 0);
      if (i > 600) throw new PlusError("timeout", "timeout");
    }
  })();
  running.set(k, p);
  p.finally(() => running.delete(k)).catch(() => {});
  return p;
}

/** Понятный текст ошибки расшифровки. */
export function transcribeError(e: unknown): string {
  if (e instanceof PlusError) {
    if (e.code === "plus") return tr("Расшифровка голосовых входит в JsMessenger Plus");
    if (e.code === "network") return tr("Нет связи с сервером JsMessenger");
    if (e.code === "unavailable") return tr("Расшифровка пока не настроена на сервере");
    if (e.code === "busy") return tr("Сервер расшифровки сейчас занят — попробуйте чуть позже");
    if (e.code === "limit") return tr("На сегодня расшифровок слишком много — попробуйте завтра");
    if (e.code === "timeout") return tr("Расшифровка заняла слишком много времени");
    if (e.code === "openid") return tr("Не удалось войти в JsMessenger Plus");
    return tr("Не удалось расшифровать");
  }
  return e instanceof Error ? e.message : String(e);
}
