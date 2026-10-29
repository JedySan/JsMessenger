// Скачивание вложений: с прогрессом, в «Загрузки» или «Сохранить как…», потом «Открыть» и «Показать в папке».
// Состояние общее для всего приложения (один файл в ленте, в «Медиа» и в просмотрщике — одна загрузка),
// пути скачанных файлов запоминаются между запусками.
import { useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { decryptAttachment, type EncryptedFile } from "./attachments";
import { electron, isIOSApp, isMobile, isTauri } from "./platform";
import { tr } from "./i18n";

export interface DlState {
  status: "idle" | "loading" | "done" | "error";
  /** 0…1, null — размер неизвестен */
  progress?: number | null;
  /** где лежит файл (в браузере неизвестно) */
  path?: string;
  error?: string;
}

const IDLE: DlState = { status: "idle" };
const KEY = "jsm.downloads";
const states = new Map<string, DlState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

/** Ключ вложения — адрес файла на сервере (одинаков в ленте, «Медиа», просмотрщике). */
export function mediaKey(content: Record<string, any>): string {
  return content.file?.url ?? content.url ?? "";
}

export function fileName(content: Record<string, any>): string {
  const n = String(content.filename ?? content.body ?? "").trim();
  if (n) return n;
  const ext = String(content.info?.mimetype ?? "").split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "";
  return ext ? `file.${ext}` : "file";
}

// ---------- запомненные пути ----------
function loadSaved(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function remember(key: string, path: string | undefined) {
  try {
    const all = loadSaved();
    if (path) all[key] = path;
    else delete all[key];
    // не копим бесконечно: последние 500
    const entries = Object.entries(all).slice(-500);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* хранилище недоступно — просто не помним */
  }
}
for (const [k, p] of Object.entries(loadSaved())) states.set(k, { status: "done", path: p });

function set(key: string, s: DlState) {
  states.set(key, s);
  emit();
}

export function useDownload(content: Record<string, any>): DlState {
  const key = mediaKey(content);
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => states.get(key) ?? IDLE,
  );
}

// ---------- что умеет платформа ----------
const desktopTauri = () => isTauri() && !isMobile();
/** Можно ли открыть скачанный файл и показать его в папке */
export const canOpenFiles = () => !!electron()?.openPath || desktopTauri();
/** Есть ли окно «Сохранить как…» */
export const canSaveAs = () => !!electron()?.saveAs || desktopTauri() || !isTauri();

// ---------- скачивание ----------
/** Скачивает (и расшифровывает) вложение, сообщая прогресс. */
export async function fetchMedia(
  client: MatrixClient,
  content: Record<string, any>,
  onProgress?: (p: number | null) => void,
): Promise<Blob> {
  const encrypted = content.file as EncryptedFile | undefined;
  const mxc: string | undefined = encrypted?.url ?? content.url;
  if (!mxc) throw new Error(tr("В сообщении нет файла"));
  const http = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
  if (!http) throw new Error(tr("Некорректная ссылка на файл"));
  const res = await fetch(http, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } });
  if (!res.ok) throw new Error(tr("Сервер вернул {0}", res.status));
  const total = Number(res.headers.get("content-length")) || Number(content.info?.size) || 0;
  let data: ArrayBuffer;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(total ? Math.min(got / total, 1) : null);
    }
    const buf = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      buf.set(p, at);
      at += p.length;
    }
    data = buf.buffer;
  } else {
    data = await res.arrayBuffer();
  }
  if (encrypted) data = await decryptAttachment(data, encrypted);
  return new Blob([data], { type: content.info?.mimetype ?? "application/octet-stream" });
}

const safeName = (name: string) => name.replace(/[/\\:*?"<>|]+/g, "_").trim() || "file";

/** Куда сохранять в Tauri: «Загрузки»; на iPhone — папка приложения в «Файлах» (своих «Загрузок» там нет). */
async function saveBase() {
  const { BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const path = await import("@tauri-apps/api/path");
  return isIOSApp() ? { baseDir: BaseDirectory.Document, dir: path.documentDir } : { baseDir: BaseDirectory.Download, dir: path.downloadDir };
}

async function tauriUnique(name: string): Promise<string> {
  const { exists } = await import("@tauri-apps/plugin-fs");
  const { baseDir } = await saveBase();
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let i = 1; await exists(candidate, { baseDir }); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

/** Записать уже скачанное. Возвращает путь; null — пользователь отменил «Сохранить как…». */
async function writeBlob(name: string, blob: Blob, saveAs: boolean): Promise<string | null | undefined> {
  const safe = safeName(name);
  const el = electron();
  if (el) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return saveAs && el.saveAs ? el.saveAs(safe, bytes) : el.saveDownload(safe, bytes);
  }
  if (!isTauri()) {
    // браузер: обычное скачивание (место выбирает сам браузер)
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = safe;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return undefined;
  }
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const { downloadDir, join } = await import("@tauri-apps/api/path");
  if (saveAs && desktopTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: await join(await downloadDir(), safe), title: tr("Сохранить как") });
    if (!path) return null;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  const file = await tauriUnique(safe);
  const base = await saveBase();
  await writeFile(file, new Uint8Array(await blob.arrayBuffer()), { baseDir: base.baseDir });
  return join(await base.dir(), file);
}

/**
 * Скачать вложение: в «Загрузки» (saveAs = false) или в выбранное место.
 * Возвращает путь (если известен); null — отменили выбор места.
 */
export async function download(client: MatrixClient, content: Record<string, any>, saveAs = false): Promise<string | null | undefined> {
  const key = mediaKey(content);
  const prev = states.get(key) ?? IDLE;
  if (prev.status === "loading") return undefined;
  set(key, { status: "loading", progress: 0 });
  try {
    const blob = await fetchMedia(client, content, (p) => set(key, { status: "loading", progress: p }));
    const path = await writeBlob(fileName(content), blob, saveAs);
    if (path === null) {
      set(key, prev); // отменили «Сохранить как…»
      return null;
    }
    set(key, { status: "done", path: path ?? undefined });
    if (path) remember(key, path);
    return path;
  } catch (e) {
    set(key, { status: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

function forget(key: string) {
  remember(key, undefined);
  set(key, IDLE);
}

/** Открыть скачанный файл программой по умолчанию. false — файла уже нет (удалили или переместили). */
export async function openDownloaded(content: Record<string, any>): Promise<boolean> {
  const key = mediaKey(content);
  const path = states.get(key)?.path;
  if (!path) return false;
  try {
    const el = electron();
    if (el?.openPath) await el.openPath(path);
    else {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(path);
    }
    return true;
  } catch {
    forget(key);
    return false;
  }
}

/** Показать скачанный файл в Finder / Проводнике. */
export async function revealDownloaded(content: Record<string, any>): Promise<boolean> {
  const key = mediaKey(content);
  const path = states.get(key)?.path;
  if (!path) return false;
  try {
    const el = electron();
    if (el?.showItem) await el.showItem(path);
    else {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    }
    return true;
  } catch {
    forget(key);
    return false;
  }
}

/** Скопировать картинку в буфер обмена (как PNG — его понимают все программы). */
export async function copyImage(client: MatrixClient, content: Record<string, any>): Promise<void> {
  const blob = await fetchMedia(client, content);
  let png = blob;
  if (blob.type !== "image/png") {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
