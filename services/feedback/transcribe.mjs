// Plus: расшифровка голосовых сообщений.
//   POST /api/plus/transcribe?lang=auto   тело — сам аудиофайл (ogg/opus, m4a, mp3, webm…) → { id }
//   GET  /api/plus/transcribe/<id>        → { status: queued|working|done|error, position?, text?, error? }
// Приложение расшифровывает голосовое у себя и присылает звук; на диск он не попадает дольше, чем
// нужно ffmpeg, а текст хранится в памяти 10 минут — только чтобы приложение успело его забрать.
// Распознаёт whisper.cpp на этом же сервере (WHISPER_URL) или любой сервис с API как у OpenAI
// (WHISPER_API_URL + WHISPER_API_KEY). Работы по одной: процессор у сервера небольшой.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const MAX_AUDIO = 20 * 1024 * 1024;
const MAX_SECONDS = 15 * 60; // как самое длинное голосовое в приложении
const MAX_QUEUE = 30;
const PER_DAY = 200; // расшифровок на человека в сутки
const KEEP = 10 * 60_000;

let cfg = {};
const jobs = new Map(); // id → { mxid, status, text, error, created, audio, type, lang }
const queue = [];
let running = false;
const daily = new Map(); // mxid → [ts…]

export function initTranscribe(env) {
  cfg = {
    whisperUrl: env.WHISPER_URL || "",
    apiUrl: env.WHISPER_API_URL || "",
    apiKey: env.WHISPER_API_KEY || "",
    apiModel: env.WHISPER_API_MODEL || "whisper-1",
    ffmpeg: env.FFMPEG || "ffmpeg",
    timeout: Number(env.WHISPER_TIMEOUT || 15 * 60) * 1000,
  };
  if (cfg.whisperUrl) {
    void ping();
    setInterval(ping, 60_000).unref();
  }
  setInterval(() => {
    const now = Date.now();
    for (const [id, j] of jobs) if ((j.status === "done" || j.status === "error") && now - j.finished > KEEP) jobs.delete(id);
  }, 60_000).unref();
}

/** Отвечает ли whisper.cpp (проверяем раз в минуту — для админки). */
let alive = null;
async function ping() {
  try {
    const r = await fetch(new URL("/", cfg.whisperUrl), { signal: AbortSignal.timeout(5000) });
    alive = r.status > 0; // ответил хоть что-то — процесс жив
  } catch {
    alive = false;
  }
}

/** Настроена ли расшифровка (иначе в Plus она помечена «скоро»). */
export const transcribeReady = () => !!(cfg.whisperUrl || (cfg.apiUrl && cfg.apiKey));

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Любой звук → WAV 16 кГц моно (так его ждёт whisper.cpp). Через файл: m4a с конца файла из трубы не читается. */
async function toWav(audio) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsm-tr-"));
  const src = path.join(dir, "in");
  try {
    await fs.writeFile(src, audio, { mode: 0o600 });
    return await new Promise((resolve, reject) => {
      const p = spawn(cfg.ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", src, "-t", String(MAX_SECONDS), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out = [];
      let err = "";
      p.stdout.on("data", (c) => out.push(c));
      p.stderr.on("data", (c) => (err += c).length > 4000 && (err = err.slice(-2000)));
      p.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "ffmpeg не установлен" : e.message)));
      p.on("close", (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error("ffmpeg: " + (err.trim().split("\n").pop() || code)))));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const EXT = { "audio/ogg": "ogg", "audio/opus": "ogg", "audio/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

async function recognize(j) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeout);
  try {
    const fd = new FormData();
    let res;
    if (cfg.whisperUrl) {
      // whisper.cpp server: POST /inference
      fd.append("file", new Blob([await toWav(j.audio)], { type: "audio/wav" }), "voice.wav");
      fd.append("response_format", "json");
      fd.append("temperature", "0");
      fd.append("language", j.lang || "auto");
      res = await fetch(cfg.whisperUrl, { method: "POST", body: fd, signal: ac.signal });
    } else {
      fd.append("file", new Blob([j.audio], { type: j.type }), "voice." + (EXT[j.type] ?? "ogg"));
      fd.append("model", cfg.apiModel);
      fd.append("response_format", "json");
      if (j.lang && j.lang !== "auto") fd.append("language", j.lang);
      res = await fetch(cfg.apiUrl, { method: "POST", body: fd, signal: ac.signal, headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`распознавание: HTTP ${res.status} ${String(body?.error?.message ?? body?.error ?? "").slice(0, 120)}`);
    return String(body.text ?? "")
      .replace(/\[(BLANK_AUDIO|MUSIC|музыка)\]/gi, "")
      .replace(/\s+\n/g, "\n")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      const j = jobs.get(id);
      if (!j) continue;
      j.status = "working";
      try {
        j.text = await recognize(j);
        j.status = "done";
      } catch (e) {
        console.error("transcribe", e?.message ?? e);
        j.status = "error";
        j.error = e?.name === "AbortError" ? "timeout" : "failed";
      }
      j.finished = Date.now();
      delete j.audio;
    }
  } finally {
    running = false;
  }
}

/** Обработать /api/plus/transcribe*; ctx: { req, url, s, plusOf, reply }. */
export async function handleTranscribe(ctx) {
  const { req, url, s, reply } = ctx;
  if (url.pathname === "/api/plus/transcribe" && req.method === "POST") {
    if (!ctx.plusOf(s.mxid)) return reply(402, { error: "plus" });
    if (!transcribeReady()) return reply(503, { error: "unavailable" });
    const now = Date.now();
    const day = (daily.get(s.mxid) ?? []).filter((t) => now - t < 86_400_000);
    if (day.length >= PER_DAY) return reply(429, { error: "limit" });
    const waiting = [...jobs.values()].filter((j) => j.mxid === s.mxid && (j.status === "queued" || j.status === "working")).length;
    if (waiting >= 5) return reply(429, { error: "busy" });
    if (queue.length >= MAX_QUEUE) return reply(503, { error: "busy" });
    const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("audio/") && !type.startsWith("video/")) return reply(415, { error: "type" });
    const audio = await readRaw(req, MAX_AUDIO);
    if (audio.length < 100) return reply(400, { error: "empty" });
    const lang = /^[a-z]{2,3}$/.test(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang") : "auto";
    const id = crypto.randomBytes(12).toString("base64url");
    jobs.set(id, { mxid: s.mxid, status: "queued", created: now, audio, type, lang });
    queue.push(id);
    day.push(now);
    daily.set(s.mxid, day);
    if (daily.size > 10_000) daily.clear();
    const position = queue.length + (running ? 1 : 0);
    void pump();
    return reply(200, { id, status: "queued", position });
  }
  const m = /^\/api\/plus\/transcribe\/([\w-]{8,32})$/.exec(url.pathname);
  if (m && req.method === "GET") {
    const j = jobs.get(m[1]);
    if (!j || j.mxid !== s.mxid) return reply(404, { error: "not found" });
    const out = { status: j.status };
    if (j.status === "queued") out.position = queue.indexOf(m[1]) + 1;
    if (j.status === "done") out.text = j.text;
    if (j.status === "error") out.error = j.error;
    return reply(200, out);
  }
  return reply(404, { error: "not found" });
}

/** Для админки. */
export function transcribeStats() {
  return { ready: transcribeReady(), alive: cfg.whisperUrl ? alive : true, backend: cfg.whisperUrl ? "whisper.cpp" : cfg.apiUrl ? "API" : "—", queue: queue.length, today: [...daily.values()].reduce((n, l) => n + l.filter((t) => Date.now() - t < 86_400_000).length, 0) };
}
