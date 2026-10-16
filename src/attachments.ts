// Вложения: шифрование (как в Element: AES-CTR-256 + SHA-256), загрузка, скачивание, сохранение.
import { MsgType, type MatrixClient, type Room } from "matrix-js-sdk";

export interface EncryptedFile {
  url: string;
  key: JsonWebKey;
  iv: string;
  hashes: { sha256: string };
  v: string;
}

// ---------- base64 ----------
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm + "===".slice((norm.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64Unpadded(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "");
}

// ---------- шифрование ----------
export async function encryptAttachment(plain: ArrayBuffer): Promise<{ data: ArrayBuffer; info: Omit<EncryptedFile, "url"> }> {
  // IV: 8 случайных байт + 8 нулевых (счётчик), как требует спецификация
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, plain);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return {
    data,
    info: {
      v: "v2",
      key: { alg: "A256CTR", ext: true, k: jwk.k, key_ops: ["encrypt", "decrypt"], kty: "oct" },
      iv: bytesToB64Unpadded(iv),
      hashes: { sha256: bytesToB64Unpadded(hash) },
    },
  };
}

export async function decryptAttachment(data: ArrayBuffer, file: EncryptedFile): Promise<ArrayBuffer> {
  // Проверяем целостность до расшифровки
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const expected = b64ToBytes(file.hashes.sha256);
  if (hash.length !== expected.length || hash.some((b, i) => b !== expected[i])) {
    throw new Error("Файл повреждён: контрольная сумма не совпадает");
  }
  const key = await crypto.subtle.importKey("jwk", file.key, { name: "AES-CTR" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: b64ToBytes(file.iv), length: 64 }, key, data);
}

// ---------- скачивание ----------
/** Скачивает (и при необходимости расшифровывает) вложение сообщения. */
export async function downloadMedia(client: MatrixClient, content: Record<string, any>): Promise<Blob> {
  const encrypted = content.file as EncryptedFile | undefined;
  const mxc: string | undefined = encrypted?.url ?? content.url;
  if (!mxc) throw new Error("В сообщении нет файла");
  const http = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
  if (!http) throw new Error("Некорректная ссылка на файл");
  const res = await fetch(http, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } });
  if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
  let data = await res.arrayBuffer();
  if (encrypted) data = await decryptAttachment(data, encrypted);
  return new Blob([data], { type: content.info?.mimetype ?? "application/octet-stream" });
}

import { electron, isTauri } from "./platform";

/** Сохраняет файл в «Загрузки» и показывает его в Finder (в браузере — обычное скачивание). */
export async function saveToDownloads(name: string, blob: Blob): Promise<void> {
  const safe = name.replace(/[/\\:*?"<>|]+/g, "_").trim() || "file";
  const el = electron();
  if (el) {
    await el.saveDownload(safe, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  if (!isTauri()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = safe;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return;
  }
  const { writeFile, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const { downloadDir, join } = await import("@tauri-apps/api/path");
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  // Не перезаписываем существующий файл: «отчёт.pdf» → «отчёт (1).pdf»
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let candidate = safe;
  for (let i = 1; await exists(candidate, { baseDir: BaseDirectory.Download }); i++) candidate = `${base} (${i})${ext}`;
  await writeFile(candidate, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.Download });
  await revealItemInDir(await join(await downloadDir(), candidate));
}

// ---------- отправка ----------
function imageSize(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function videoMeta(file: Blob): Promise<{ w: number; h: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight, duration: Math.round(v.duration * 1000) });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

/** Имя для вставленного скриншота: у файлов из буфера обмена имя бессмысленное. */
export function nameForPasted(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `Снимок ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
  return new File([file], name, { type: file.type || "image/png" });
}

/** Загружает файл (зашифрованным, если комната зашифрована) и отправляет сообщение. */
export async function sendFile(
  client: MatrixClient,
  room: Room,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
  relatesTo?: Record<string, unknown>,
): Promise<void> {
  const mime = file.type || "application/octet-stream";
  const info: Record<string, unknown> = { mimetype: mime, size: file.size };
  let msgtype: string = MsgType.File;
  if (mime.startsWith("image/")) {
    msgtype = MsgType.Image;
    const s = await imageSize(file);
    if (s) Object.assign(info, s);
  } else if (mime.startsWith("video/")) {
    msgtype = MsgType.Video;
    const m = await videoMeta(file);
    if (m) Object.assign(info, m);
  } else if (mime.startsWith("audio/")) {
    msgtype = MsgType.Audio;
  }

  const content: Record<string, any> = { msgtype, body: file.name, filename: file.name, info };
  const progressHandler = (p: { loaded: number; total: number }) => onProgress?.(p.loaded, p.total);

  if (room.hasEncryptionStateEvent()) {
    const { data, info: enc } = await encryptAttachment(await file.arrayBuffer());
    const up = await client.uploadContent(new Blob([data], { type: "application/octet-stream" }), {
      type: "application/octet-stream",
      includeFilename: false,
      progressHandler,
    });
    content.file = { ...enc, url: up.content_uri, mimetype: mime };
  } else {
    const up = await client.uploadContent(file, { type: mime, name: file.name, progressHandler });
    content.url = up.content_uri;
  }
  if (relatesTo) content["m.relates_to"] = relatesTo;
  await client.sendMessage(room.roomId, content as any);
}

export function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} ГБ`;
}
