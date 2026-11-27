// JsMessenger Plus: вход через Matrix (OpenID), тариф пользователя, коды активации.
//   POST /api/plus/auth    { openid: { access_token, matrix_server_name } } → { session, mxid, plus }
//   GET  /api/plus/me      (Authorization: Bearer <session>)                 → { mxid, plus }
//   POST /api/plus/redeem  { code }                                           → { plus }
// Кто такой пользователь, узнаём у его Matrix-сервера (как вход в звонки LiveKit): приложение берёт
// у своего сервера одноразовый OpenID-токен, мы проверяем его через federation API.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import dns from "node:dns/promises";
import { handleScheduled, initScheduled, scheduledStats } from "./scheduled.mjs";
import { handleTranscribe, initTranscribe, transcribeReady, transcribeStats } from "./transcribe.mjs";

const DAY = 86_400_000;
const SESSION_DAYS = 60;
/** Что входит в Plus — приложение показывает этот список (и включает функции). */
export const plusFeatures = () => [
  { id: "scheduled", title: "Отложенные сообщения через сервер JsMessenger" },
  { id: "transcribe", title: "Расшифровка голосовых сообщений", soon: !transcribeReady() },
];

let FILE;
let INSECURE = false;
let db = { subs: {}, codes: {}, sessions: {} };
let saving = Promise.resolve();

export async function initPlus(dataDir, env) {
  FILE = path.join(dataDir, "plus.json");
  INSECURE = env.FEDERATION_INSECURE === "1"; // только для теста с самоподписанным сертификатом
  try {
    db = { subs: {}, codes: {}, sessions: {}, ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // просроченные сессии — прочь
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k];
  await initScheduled(dataDir, env);
  initTranscribe(env);
}

function save() {
  saving = saving.then(async () => {
    const tmp = FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
    await fs.rename(tmp, FILE);
  });
  return saving;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Тариф пользователя: { plan: "plus", until } или null. */
export function plusOf(mxid) {
  const s = db.subs[mxid];
  return s && s.until > Date.now() ? { plan: "plus", until: s.until } : null;
}

/** Продлить Plus на months месяцев (от текущего окончания, если он ещё действует). */
function extend(mxid, months, note) {
  const now = Date.now();
  const cur = db.subs[mxid]?.until > now ? db.subs[mxid].until : now;
  const d = new Date(cur);
  d.setMonth(d.getMonth() + months);
  db.subs[mxid] = { ...(db.subs[mxid] ?? {}), until: d.getTime(), note: note ?? db.subs[mxid]?.note ?? "", updated: now };
}

// ---------- проверка OpenID-токена у Matrix-сервера пользователя ----------
const SERVER_NAME = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** Куда стучаться по federation API: .well-known/matrix/server → SRV → имя:8448. */
async function resolveServer(name) {
  if (/:\d+$/.test(name)) return { host: name.replace(/:\d+$/, ""), port: Number(name.split(":").pop()), sni: name.replace(/:\d+$/, "") };
  try {
    const wk = await getJson(`https://${name}/.well-known/matrix/server`, 5000);
    const s = String(wk?.["m.server"] ?? "");
    if (s) {
      const [h, p] = s.split(":");
      return { host: h, port: Number(p) || 8448, sni: h };
    }
  } catch {
    /* нет делегирования */
  }
  for (const srv of [`_matrix-fed._tcp.${name}`, `_matrix._tcp.${name}`]) {
    try {
      const r = await dns.resolveSrv(srv);
      if (r.length) return { host: r[0].name, port: r[0].port, sni: name };
    } catch {
      /* нет SRV */
    }
  }
  return { host: name, port: 8448, sni: name };
}

function getJson(url, timeout = 8000, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, rejectUnauthorized: !INSECURE, ...opts }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
        if (body.length > 64 * 1024) req.destroy(new Error("too large"));
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function verifyOpenId(token, serverName) {
  if (!SERVER_NAME.test(serverName) || typeof token !== "string" || token.length > 512) throw new Error("bad openid");
  const t = await resolveServer(serverName);
  const url = `https://${t.host}:${t.port}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`;
  const info = await getJson(url, 8000, { servername: t.sni, headers: { Host: serverName } });
  const sub = String(info?.sub ?? "");
  // Matrix ID должен быть с того же сервера, что выдал токен
  if (!sub.startsWith("@") || sub.slice(sub.indexOf(":") + 1) !== serverName) throw new Error("mxid mismatch");
  return sub;
}

// ---------- ограничение попыток ввода кода ----------
const tries = new Map();
function tooMany(key, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (tries.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  tries.set(key, list);
  if (tries.size > 10_000) tries.clear();
  return list.length > max;
}

/** Обработать /api/plus/*; вернуть true, если запрос наш. */
export async function handlePlusApi(req, res, url, h) {
  if (!url.pathname.startsWith("/api/plus/")) return false;
  const CORS = { ...h.CORS, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
  if (req.method === "OPTIONS") return h.send(res, 204, "", CORS), true;
  const ip = h.clientIp(req);
  const reply = (status, obj) => (h.json(res, status, obj, CORS), true);
  const body = async (max) => {
    try {
      return JSON.parse((await h.readBody(req, max)) || "{}");
    } catch {
      return null;
    }
  };
  const session = () => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? "");
    const s = m && db.sessions[sha(m[1])];
    return s && s.exp > Date.now() ? s : null;
  };
  const view = (mxid) => ({ mxid, plus: plusOf(mxid), features: plusFeatures() });

  if (url.pathname === "/api/plus/auth" && req.method === "POST") {
    if (tooMany("auth:" + ip, 30)) return reply(429, { error: "too many" });
    const b = await body();
    let mxid;
    try {
      mxid = await verifyOpenId(b?.openid?.access_token, String(b?.openid?.matrix_server_name ?? ""));
    } catch (e) {
      return reply(401, { error: "openid", detail: String(e?.message ?? e).slice(0, 120) });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    db.sessions[sha(token)] = { mxid, exp: Date.now() + SESSION_DAYS * DAY, created: Date.now() };
    await save();
    return reply(200, { session: token, ...view(mxid) });
  }

  const s = session();
  if (!s) return reply(401, { error: "session" });

  if (url.pathname === "/api/plus/me" && req.method === "GET") return reply(200, view(s.mxid));
  const ctx = { req, url, s, plusOf, reply, body };
  if (url.pathname === "/api/plus/scheduled" || url.pathname.startsWith("/api/plus/scheduled/")) return handleScheduled(ctx);
  if (url.pathname === "/api/plus/transcribe" || url.pathname.startsWith("/api/plus/transcribe/")) return handleTranscribe(ctx);

  if (url.pathname === "/api/plus/redeem" && req.method === "POST") {
    if (tooMany("redeem:" + ip) || tooMany("redeem:" + s.mxid)) return reply(429, { error: "too many" });
    const b = await body();
    let code = String(b?.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length === 15 && code.startsWith("JSM")) code = code.slice(3); // ввели вместе с «JSM-»
    const c = db.codes[code];
    if (!c) return reply(404, { error: "code" });
    if (c.usedBy) return reply(409, { error: "used" });
    extend(s.mxid, c.months, c.note);
    c.usedBy = s.mxid;
    c.usedAt = Date.now();
    await save();
    return reply(200, view(s.mxid));
  }

  if (url.pathname === "/api/plus/logout" && req.method === "POST") {
    for (const [k, v] of Object.entries(db.sessions)) if (v === s) delete db.sessions[k];
    await save();
    return reply(200, { ok: true });
  }
  return reply(404, { error: "not found" });
}

// ---------- админка ----------
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O и 1/I — чтобы не путали при вводе
function newCode() {
  const b = crypto.randomBytes(12);
  let s = "";
  for (const x of b) s += ALPH[x % ALPH.length];
  return s;
}
export const prettyCode = (c) => `JSM-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;

const fmtDate = (ms, tz) => new Date(ms).toLocaleDateString("ru-RU", { timeZone: tz || "UTC" });

export function adminPlusPage(url, h) {
  const now = Date.now();
  const subs = Object.entries(db.subs).sort((a, b) => b[1].until - a[1].until);
  const codes = Object.entries(db.codes).sort((a, b) => b[1].created - a[1].created);
  const fresh = new Set((url.searchParams.get("new") ?? "").split(",").filter(Boolean));
  const esc = h.esc;
  const sched = scheduledStats();
  const tr = transcribeStats();
  return h.page(
    "Plus — JsMessenger",
    `<main><h1>JsMessenger Plus</h1>
<nav><a class="tab" href="/admin/">Отзывы</a><a class="tab" href="/admin/downloads">Скачивания</a><a class="tab on" href="/admin/plus">Plus</a></nav>

<section class="card"><h2>Сервисы</h2>
<p>Отложенные: ждут отправки — ${sched.pending}, отправлено за сутки — ${sched.sent}, не ушло (7 дней) — ${sched.failed}</p>
<p>Расшифровка: ${tr.ready ? `работает (${esc(tr.backend)}), в очереди — ${tr.queue}, за сутки — ${tr.today}` : "не настроена (WHISPER_URL или WHISPER_API_URL)"}</p></section>

<section class="card"><h2>Выдать или продлить</h2>
<form method="post" action="/admin/plus/action" class="row">
  <input name="mxid" placeholder="@user:server" required pattern="@[^:]+:.+">
  <select name="months"><option value="1">1 мес.</option><option value="3">3 мес.</option><option value="6">6 мес.</option><option value="12" selected>12 мес.</option></select>
  <input name="note" placeholder="заметка (необязательно)">
  <button name="do" value="grant">Выдать</button>
</form></section>

<section class="card"><h2>Подписчики (${subs.filter(([, v]) => v.until > now).length} действующих)</h2>
${
  subs.length
    ? `<table><thead><tr><th>Matrix ID</th><th>До</th><th>Заметка</th><th></th></tr></thead><tbody>${subs
        .map(
          ([m, v]) => `<tr class="${v.until > now ? "" : "expired"}"><td>${esc(m)}</td><td>${fmtDate(v.until, h.tz)}${v.until > now ? "" : " (истёк)"}</td><td>${esc(v.note ?? "")}</td>
<td><form method="post" action="/admin/plus/action" class="inline"><input type="hidden" name="mxid" value="${esc(m)}">
<button name="do" value="plus1">+1 мес.</button><button name="do" value="revoke" class="danger">Отключить</button></form></td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="empty">Пока никого</p>`
}</section>

<section class="card"><h2>Коды активации</h2>
<form method="post" action="/admin/plus/action" class="row">
  <input name="count" type="number" min="1" max="100" value="5" style="width:80px">
  <select name="months"><option value="1">на 1 мес.</option><option value="3">на 3 мес.</option><option value="6">на 6 мес.</option><option value="12">на 12 мес.</option></select>
  <input name="note" placeholder="для кого / откуда (необязательно)">
  <button name="do" value="codes">Выпустить</button>
</form>
${
  codes.length
    ? `<table><thead><tr><th>Код</th><th>Срок</th><th>Заметка</th><th>Использован</th><th></th></tr></thead><tbody>${codes
        .map(
          ([c, v]) => `<tr class="${fresh.has(c) ? "fresh" : v.usedBy ? "expired" : ""}"><td class="code">${prettyCode(c)}</td><td>${v.months} мес.</td><td>${esc(v.note ?? "")}</td>
<td>${v.usedBy ? `${esc(v.usedBy)}, ${fmtDate(v.usedAt, h.tz)}` : "—"}</td>
<td>${v.usedBy ? "" : `<form method="post" action="/admin/plus/action" class="inline"><input type="hidden" name="code" value="${esc(c)}"><button name="do" value="delcode" class="danger">Удалить</button></form>`}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="empty">Кодов пока нет</p>`
}</section></main>`,
  );
}

/** Действие из админки; вернуть адрес, куда перейти. */
export async function adminPlusAction(form) {
  const act = form.get("do");
  const mxid = String(form.get("mxid") ?? "").trim();
  const months = Math.min(36, Math.max(1, Number(form.get("months")) || 1));
  const note = String(form.get("note") ?? "").slice(0, 200);
  let to = "/admin/plus";
  if (act === "grant" && /^@[^:\s]+:\S+$/.test(mxid)) extend(mxid, months, note || undefined);
  if (act === "plus1" && db.subs[mxid]) extend(mxid, 1);
  if (act === "revoke" && db.subs[mxid]) db.subs[mxid].until = Date.now() - 1;
  if (act === "codes") {
    const count = Math.min(100, Math.max(1, Number(form.get("count")) || 1));
    const made = [];
    for (let i = 0; i < count; i++) {
      let c;
      do c = newCode();
      while (db.codes[c]);
      db.codes[c] = { months, note, created: Date.now() };
      made.push(c);
    }
    to = `/admin/plus?new=${made.join(",")}`;
  }
  if (act === "delcode") {
    const c = String(form.get("code") ?? "");
    if (db.codes[c] && !db.codes[c].usedBy) delete db.codes[c];
  }
  await save();
  return to;
}
