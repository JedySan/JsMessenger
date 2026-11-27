// Plus: отложенная отправка через сервер JsMessenger — для тех, чей Matrix-сервер не умеет MSC4140
// (или не разрешает планировать надолго).
//   GET    /api/plus/scheduled            → { items: [{ id, roomId, at, status, error }] }
//   POST   /api/plus/scheduled            { roomId, type, content, at, homeserver, accessToken, txnId }
//   POST   /api/plus/scheduled/<id>/send  — отправить сейчас
//   DELETE /api/plus/scheduled/<id>       — отменить (или убрать из списка неотправленное)
// Приложение само шифрует сообщение (в зашифрованном чате мы видим только шифротекст) и даёт токен
// своего устройства. Токен проверяем у Matrix-сервера (он должен принадлежать тому же Matrix ID, что вошёл
// в Plus), храним зашифрованным и стираем сразу после отправки.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

const MAX_PENDING = 100; // на одного пользователя
const MAX_CONTENT = 64 * 1024;
const MAX_AHEAD = 400 * 86_400_000;
const KEEP_FAILED = 7 * 86_400_000;
const KEEP_SENT = 86_400_000;
const GIVE_UP = 24 * 3_600_000; // сервер недоступен сутки — сдаёмся

let FILE;
let KEY;
let ALLOW_PRIVATE = false;
let INSECURE = false;
let db = { jobs: {} };
let saving = Promise.resolve();

export async function initScheduled(dataDir, env) {
  FILE = path.join(dataDir, "scheduled.json");
  ALLOW_PRIVATE = env.RELAY_ALLOW_PRIVATE === "1"; // только для теста: Matrix-сервер в локальной сети
  INSECURE = env.FEDERATION_INSECURE === "1";
  KEY = await loadKey(dataDir, env.RELAY_KEY);
  try {
    db = { jobs: {}, ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // после перезапуска «отправляется» значит «не успели» — попробуем ещё раз
  for (const j of Object.values(db.jobs)) if (j.status === "sending") j.status = "pending";
  setInterval(tick, 5_000).unref();
  setTimeout(tick, 1_000).unref();
}

/** Ключ шифрования токенов: RELAY_KEY (32 байта hex/base64) или файл relay.key рядом с данными. */
async function loadKey(dataDir, fromEnv) {
  if (fromEnv) {
    const b = /^[0-9a-f]{64}$/i.test(fromEnv) ? Buffer.from(fromEnv, "hex") : Buffer.from(fromEnv, "base64");
    if (b.length !== 32) throw new Error("RELAY_KEY: нужно 32 байта (64 hex-символа)");
    return b;
  }
  const f = path.join(dataDir, "relay.key");
  try {
    const b = Buffer.from((await fs.readFile(f, "utf8")).trim(), "hex");
    if (b.length === 32) return b;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const b = crypto.randomBytes(32);
  await fs.writeFile(f, b.toString("hex"), { mode: 0o600 });
  return b;
}

const seal = (text) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};
const unseal = (s) => {
  const [iv, tag, data] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
};

function save() {
  saving = saving.then(async () => {
    const tmp = FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db), { mode: 0o600 });
    await fs.rename(tmp, FILE);
  });
  return saving;
}

// ---------- запросы к Matrix-серверу пользователя ----------
/** Адрес из частной сети? Туда не ходим: иначе через нас можно было бы стучаться во внутренние сервисы. */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    if (!ALLOW_PRIVATE && list.some((a) => privateIp(a.address)))
      return cb(Object.assign(new Error("private address"), { code: "EPRIVATE" }));
    if (opts?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

/** Проверить и нормализовать адрес Matrix-сервера из приложения. */
function homeserverUrl(s) {
  let u;
  try {
    u = new URL(String(s ?? ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && !(ALLOW_PRIVATE && u.protocol === "http:")) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  // адрес цифрами обходит проверку при поиске имени — проверяем сразу
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !ALLOW_PRIVATE && privateIp(host)) return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

function hsRequest(base, method, p, token, body) {
  const u = new URL(base + p);
  const mod = u.protocol === "https:" ? https : http;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method,
        lookup: safeLookup,
        timeout: 20_000,
        rejectUnauthorized: !INSECURE,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          text += c;
          if (text.length > 64 * 1024) req.destroy(new Error("too large"));
        });
        res.on("end", () => {
          let json = {};
          try {
            json = JSON.parse(text || "{}");
          } catch {
            /* не JSON */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- отправка по расписанию ----------
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    let dirty = false;
    for (const [id, j] of Object.entries(db.jobs)) {
      if ((j.status === "failed" && now - j.done > KEEP_FAILED) || (j.status === "sent" && now - j.done > KEEP_SENT)) {
        delete db.jobs[id];
        dirty = true;
      }
    }
    if (dirty) await save();
    const due = Object.entries(db.jobs)
      .filter(([, j]) => j.status === "pending" && j.at <= now && (j.retryAt ?? 0) <= now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, j] of due) await deliver(id, j);
  } catch (e) {
    console.error("scheduled", e);
  } finally {
    busy = false;
  }
}

function finish(j, status, error) {
  j.status = status;
  j.done = Date.now();
  if (error) j.error = error;
  delete j.tok; // доступ к аккаунту больше не нужен
  delete j.content;
  delete j.retryAt;
}

async function deliver(id, j) {
  j.status = "sending";
  let r;
  try {
    const p = `/_matrix/client/v3/rooms/${encodeURIComponent(j.roomId)}/send/${encodeURIComponent(j.type)}/${encodeURIComponent(j.txnId)}`;
    r = await hsRequest(j.hs, "PUT", p, unseal(j.tok), j.content);
  } catch (e) {
    r = { status: 0, json: { error: String(e?.message ?? e) } };
  }
  const code = r.json?.errcode;
  if (r.status === 200 && r.json?.event_id) {
    finish(j, "sent");
    j.eventId = r.json.event_id;
  } else if (r.status === 401 || code === "M_UNKNOWN_TOKEN") {
    finish(j, "failed", "token"); // вышли из аккаунта на устройстве
  } else if (r.status === 403) {
    finish(j, "failed", "forbidden"); // больше не участник чата или нет прав писать
  } else if ((r.status === 0 || r.status === 429 || r.status >= 500) && Date.now() - j.at < GIVE_UP) {
    j.tries = (j.tries ?? 0) + 1;
    const wait = r.status === 429 && r.json?.retry_after_ms ? r.json.retry_after_ms : Math.min(10 * 60_000, 15_000 * 2 ** Math.min(j.tries, 6));
    j.retryAt = Date.now() + wait;
    j.status = "pending";
    j.lastError = r.status ? `HTTP ${r.status}` : String(r.json?.error ?? "network").slice(0, 120);
  } else {
    finish(j, "failed", r.status ? code || `HTTP ${r.status}` : "unreachable");
  }
  db.jobs[id] = j;
  await save();
}

// ---------- API ----------
const view = (id, j) => ({ id, roomId: j.roomId, at: j.at, status: j.status === "sending" ? "pending" : j.status, error: j.error, eventId: j.eventId });

/** Обработать /api/plus/scheduled*; ctx: { req, url, s (сессия), plusOf, reply, body }. */
export async function handleScheduled(ctx) {
  const { req, url, s, reply } = ctx;
  const mine = (id) => {
    const j = db.jobs[id];
    return j && j.mxid === s.mxid ? j : null;
  };

  if (url.pathname === "/api/plus/scheduled" && req.method === "GET") {
    const items = Object.entries(db.jobs)
      .filter(([, j]) => j.mxid === s.mxid)
      .map(([id, j]) => view(id, j))
      .sort((a, b) => a.at - b.at);
    return reply(200, { items });
  }

  if (url.pathname === "/api/plus/scheduled" && req.method === "POST") {
    if (!ctx.plusOf(s.mxid)) return reply(402, { error: "plus" });
    const b = await ctx.body(MAX_CONTENT + 8 * 1024);
    if (!b) return reply(400, { error: "bad request" });
    const roomId = String(b.roomId ?? "");
    const type = String(b.type ?? "");
    const at = Number(b.at);
    const hs = homeserverUrl(b.homeserver);
    const token = String(b.accessToken ?? "");
    const txnId = String(b.txnId ?? "") || "jsm" + crypto.randomBytes(9).toString("base64url");
    if (!/^![\x21-\x7e]{1,254}$/.test(roomId)) return reply(400, { error: "room" });
    if (type !== "m.room.message" && type !== "m.room.encrypted") return reply(400, { error: "type" });
    if (!b.content || typeof b.content !== "object" || JSON.stringify(b.content).length > MAX_CONTENT) return reply(400, { error: "content" });
    if (!Number.isFinite(at) || at > Date.now() + MAX_AHEAD) return reply(400, { error: "at" });
    if (!hs) return reply(400, { error: "homeserver" });
    if (!/^[\x21-\x7e]{8,2048}$/.test(token)) return reply(400, { error: "token" });
    if (!/^[\w.~-]{1,64}$/.test(txnId)) return reply(400, { error: "txn" });
    const pending = Object.values(db.jobs).filter((j) => j.mxid === s.mxid && j.status === "pending").length;
    if (pending >= MAX_PENDING) return reply(429, { error: "limit" });

    // токен должен принадлежать тому же человеку, что вошёл в Plus
    let who;
    try {
      who = await hsRequest(hs, "GET", "/_matrix/client/v3/account/whoami", token);
    } catch (e) {
      return reply(502, { error: "homeserver", detail: String(e?.message ?? e).slice(0, 120) });
    }
    if (who.status !== 200) return reply(403, { error: "token" });
    if (who.json?.user_id !== s.mxid) return reply(403, { error: "mxid" });

    const id = crypto.randomBytes(12).toString("base64url");
    db.jobs[id] = { mxid: s.mxid, roomId, type, content: b.content, at: Math.max(at, Date.now()), hs, tok: seal(token), device: who.json.device_id, txnId, status: "pending", created: Date.now() };
    await save();
    return reply(200, view(id, db.jobs[id]));
  }

  const m = /^\/api\/plus\/scheduled\/([\w-]{8,32})(\/send)?$/.exec(url.pathname);
  if (m) {
    const j = mine(m[1]);
    if (!j) return reply(404, { error: "not found" });
    if (m[2] && req.method === "POST") {
      if (j.status !== "pending") return reply(409, { error: j.status });
      j.at = Date.now();
      delete j.retryAt;
      await save();
      await tick();
      return reply(200, view(m[1], db.jobs[m[1]] ?? j));
    }
    if (!m[2] && req.method === "DELETE") {
      if (j.status === "sending") return reply(409, { error: "sending" });
      delete db.jobs[m[1]];
      await save();
      return reply(200, { ok: true });
    }
  }
  return reply(404, { error: "not found" });
}

/** Для админки: сколько ждёт отправки, сколько ушло и не ушло. */
export function scheduledStats() {
  const st = { pending: 0, sent: 0, failed: 0 };
  for (const j of Object.values(db.jobs)) st[j.status === "sending" ? "pending" : j.status] = (st[j.status === "sending" ? "pending" : j.status] ?? 0) + 1;
  return st;
}
