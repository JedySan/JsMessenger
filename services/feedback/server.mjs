// Приём отзывов из JsMessenger.
//   POST /api/feedback  — отзыв из приложения (JSON); сохраняется и уходит письмом
//   GET  /admin/        — админка: список отзывов (вход по логину и паролю)
// Настройки — переменные окружения (см. feedback.env.example). Зависимость одна: nodemailer.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { adminPlusAction, adminPlusPage, handlePlusApi, initPlus } from "./plus.mjs";

const env = process.env;
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || "127.0.0.1";
const DATA_DIR = path.resolve(env.DATA_DIR || "./data");
const DB_FILE = path.join(DATA_DIR, "feedback.json");
const ADMIN_USER = env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "";
/** адрес сайта — для ссылки в письме и проверки Origin у действий в админке */
const SITE = (env.SITE_URL || "https://jsmassenger.ru").replace(/\/+$/, "");
const MAIL_TO = env.MAIL_TO || "";
const MAIL_FROM = env.MAIL_FROM || env.SMTP_USER || "";

const MAX_BODY = 32 * 1024;
/** с картинками: до 5 штук, каждая до 4 МБ (в base64 — примерно на треть больше) */
const MAX_FEEDBACK_BODY = 30 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_FILE = 4 * 1024 * 1024;
const FILES_DIR = path.join(DATA_DIR, "files");
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** сверяем начало файла с заявленным типом — чтобы под видом картинки не положили что-то другое */
function looksLike(type, b) {
  if (type === "image/png") return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/gif") return b.length > 6 && b.toString("ascii", 0, 3) === "GIF";
  if (type === "image/webp") return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  return false;
}
const MAX_TEXT = 5000;
const KINDS = { bug: "Ошибка", idea: "Предложение", other: "Другое" };

if (!ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD не задан — админка закрыта");

// ---------- хранилище: один JSON-файл, запись через временный файл ----------
let items = [];
try {
  items = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await fs.mkdir(DATA_DIR, { recursive: true });
await initPlus(DATA_DIR, env);
let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    const tmp = DB_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(items, null, 1), { mode: 0o600 });
    await fs.rename(tmp, DB_FILE);
  });
  return saving;
}

// ---------- почта ----------
let mailer = null;
if (MAIL_TO && env.SMTP_HOST) {
  mailer =
    env.SMTP_HOST === "sendmail"
      ? nodemailer.createTransport({ sendmail: true, newline: "unix", path: env.SENDMAIL_PATH || "/usr/sbin/sendmail" })
      : nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: Number(env.SMTP_PORT) === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || "" } : undefined,
        });
} else console.warn("MAIL_TO или SMTP_HOST не заданы — письма не отправляются, отзывы видны только в админке");

async function mail(it) {
  if (!mailer) return;
  const lines = [
    `${KINDS[it.kind] ?? it.kind} · ${new Date(it.ts).toLocaleString("ru-RU", { timeZone: env.TZ || "UTC" })}`,
    "",
    it.text,
    "",
    it.contact ? `Связаться: ${it.contact}` : "Контакт не указан",
    it.app ? `Приложение: ${[it.app.version, it.app.platform, it.app.server].filter(Boolean).join(" · ")}` : "",
    it.app?.ua ? `Устройство: ${it.app.ua}` : "",
    "",
    `Админка: ${SITE}/admin/`,
  ];
  try {
    await mailer.sendMail({
      from: MAIL_FROM,
      to: MAIL_TO,
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(it.contact) ? it.contact : undefined,
      subject: `JsMessenger: ${KINDS[it.kind] ?? "отзыв"} — ${it.text.replace(/\s+/g, " ").slice(0, 60)}`,
      text: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n"),
      attachments: (it.files ?? []).map((f) => ({ filename: f.name, contentType: f.type, path: path.join(FILES_DIR, it.id, f.file) })),
    });
  } catch (e) {
    console.error("mail", e?.message ?? e);
  }
}

// ---------- ограничение частоты: с одного адреса не больше 5 отзывов за 10 минут ----------
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 5) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------- HTTP ----------
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", ...headers });

function readBody(req, max = MAX_BODY) {
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
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** IP клиента: за nginx — из X-Real-IP (только если запрос пришёл с этой же машины). */
function clientIp(req) {
  const peer = req.socket.remoteAddress ?? "";
  const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  return (local && (req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim())) || peer;
}

// приложение шлёт отзыв с любого «адреса» (tauri://, file:// и т. п.) — без cookie, поэтому CORS открыт
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

async function postFeedback(req, res) {
  const ip = clientIp(req);
  let data;
  try {
    data = JSON.parse(await readBody(req, MAX_FEEDBACK_BODY));
  } catch (e) {
    return json(res, e.status ?? 400, { error: e.status === 413 ? "too large" : "bad request" }, CORS);
  }
  const text = clip(data?.text, MAX_TEXT);
  if (!text) return json(res, 400, { error: "empty" }, CORS);
  // картинки и скриншоты: [{ name, type, data: base64 }]
  const files = [];
  for (const f of Array.isArray(data?.attachments) ? data.attachments.slice(0, MAX_FILES) : []) {
    const ext = IMAGE_TYPES[f?.type];
    if (!ext || typeof f.data !== "string") continue;
    const buf = Buffer.from(f.data, "base64");
    if (!buf.length || buf.length > MAX_FILE || !looksLike(f.type, buf)) continue;
    files.push({ name: clip(f.name, 120).replace(/[\\/\x00-\x1f]/g, "_") || `image.${ext}`, type: f.type, ext, buf });
  }
  if (limited(ip)) return json(res, 429, { error: "too many" }, CORS);
  const app = data?.app && typeof data.app === "object" ? data.app : null;
  const it = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    kind: KINDS[data?.kind] ? data.kind : "other",
    text,
    contact: clip(data?.contact, 200),
    app: app
      ? { version: clip(app.version, 40), platform: clip(app.platform, 60), server: clip(app.server, 200), ua: clip(app.ua, 400) }
      : null,
    ip,
    done: false,
    files: files.map((f, i) => ({ name: f.name, type: f.type, size: f.buf.length, file: `${i}.${f.ext}` })),
  };
  if (files.length) {
    const dir = path.join(FILES_DIR, it.id);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(files.map((f, i) => fs.writeFile(path.join(dir, `${i}.${f.ext}`), f.buf, { mode: 0o600 })));
  }
  items.unshift(it);
  await save();
  void mail(it);
  return json(res, 200, { ok: true }, CORS);
}

// ---------- админка: страницы без скриптов (CSP сайта запрещает встроенные) ----------
function authorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], "base64").toString("utf8").split(":");
  const pass = rest.join(":");
  const eq = (a, b) => {
    const x = crypto.createHash("sha256").update(a).digest();
    const y = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(x, y);
  };
  return eq(user, ADMIN_USER) & eq(pass, ADMIN_PASSWORD) ? true : false;
}

function page(title, body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/admin/admin.css"></head><body>${body}</body></html>`;
}

function adminList(url) {
  const show = url.searchParams.get("show") ?? "new";
  const list = items.filter((it) => (show === "all" ? true : show === "done" ? it.done : !it.done));
  const fresh = items.filter((it) => !it.done).length;
  const tab = (id, label) => `<a class="tab${show === id ? " on" : ""}" href="/admin/?show=${id}">${label}</a>`;
  const card = (it) => `
<article class="card${it.done ? " done" : ""}">
  <header>
    <span class="kind k-${esc(it.kind)}">${esc(KINDS[it.kind] ?? it.kind)}</span>
    <time>${esc(new Date(it.ts).toLocaleString("ru-RU", { timeZone: env.TZ || "UTC" }))}</time>
  </header>
  <p class="text">${esc(it.text)}</p>
  <dl>
    ${it.contact ? `<dt>Контакт</dt><dd>${esc(it.contact)}</dd>` : ""}
    ${it.app ? `<dt>Приложение</dt><dd>${esc([it.app.version, it.app.platform, it.app.server].filter(Boolean).join(" · "))}</dd>` : ""}
    ${it.app?.ua ? `<dt>Устройство</dt><dd class="ua">${esc(it.app.ua)}</dd>` : ""}
  </dl>
  ${(it.files ?? []).length ? `<div class="shots">${it.files.map((f) => `<a href="/admin/file/${esc(it.id)}/${esc(f.file)}" target="_blank" rel="noopener"><img src="/admin/file/${esc(it.id)}/${esc(f.file)}" alt="${esc(f.name)}" loading="lazy"></a>`).join("")}</div>` : ""}
  <form method="post" action="/admin/action">
    <input type="hidden" name="id" value="${esc(it.id)}">
    <input type="hidden" name="show" value="${esc(show)}">
    <button name="do" value="${it.done ? "undone" : "done"}">${it.done ? "Вернуть в новые" : "Обработано"}</button>
    <button name="do" value="delete" class="danger">Удалить</button>
  </form>
</article>`;
  return page(
    "Отзывы — JsMessenger",
    `<main><h1>Отзывы JsMessenger</h1>
<nav>${tab("new", `Новые${fresh ? ` <b>${fresh}</b>` : ""}`)}${tab("done", "Обработанные")}${tab("all", "Все")}<a class="tab" href="/admin/downloads">Скачивания</a><a class="tab" href="/admin/plus">Plus</a></nav>
${list.length ? list.map(card).join("") : `<p class="empty">Пусто</p>`}</main>`,
  );
}

const ADMIN_CSS = `
.bad { color: #e5534b; }
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#1c2024;--muted:#6b7280;--line:#e3e5e8;--accent:#1f8f7a}
@media(prefers-color-scheme:dark){:root{--bg:#16191d;--card:#1f2328;--text:#e7eaee;--muted:#9aa3ad;--line:#2e343b;--accent:#3bb39b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 60px}h1{font-size:22px;margin:0 0 14px}
nav{display:flex;gap:6px;margin-bottom:16px}.tab{padding:6px 12px;border-radius:9px;color:var(--text);text-decoration:none;background:var(--card);border:1px solid var(--line)}
.tab.on{background:var(--accent);border-color:var(--accent);color:#fff}.tab b{margin-left:4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}.card.done{opacity:.65}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}time{color:var(--muted);font-size:13px}
.kind{font-size:12px;font-weight:600;padding:2px 8px;border-radius:7px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.k-bug{background:color-mix(in srgb,#d9534f 16%,transparent);color:#d9534f}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 10px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 10px;font-size:13px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.ua{color:var(--muted)}
form{display:flex;gap:8px}button{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}
button.danger{color:#d9534f}.empty{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}.stat-n{font-size:26px;font-weight:700}
.stat-l{font-weight:600}.stat-s{color:var(--muted);font-size:12.5px}.note{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:13.5px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:600}
main{overflow-x:auto}
.card h2{font-size:16px;margin:0 0 10px}.row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.row input,.row select{font:inherit;font-size:14px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
.row input{flex:1;min-width:160px}form.inline{display:inline-flex;gap:6px}tr.expired td{color:var(--muted)}
tr.fresh td{background:color-mix(in srgb,var(--accent) 14%,transparent)}td.code{font-family:ui-monospace,Menlo,monospace;letter-spacing:.5px}
.card table{border:0;border-radius:0}.shots{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.shots img{width:120px;height:90px;object-fit:cover;border-radius:9px;border:1px solid var(--line);display:block}`;

// ---------- скачивания: счётчики релизов GitHub ----------
const REPO = env.GITHUB_REPO || "JedySan/JsMessenger";
let relCache = { at: 0, data: null, error: null };

async function releases() {
  if (relCache.data && Date.now() - relCache.at < 10 * 60_000) return relCache.data;
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${REPO}/releases?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "jsmessenger-feedback", ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
    });
    if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
    const list = await r.json();
    all.push(...list);
    if (list.length < 100) break;
  }
  relCache = { at: Date.now(), data: all, error: null };
  return all;
}

/** Что это за файл: платформа и «установка» (скачали руками) или «обновление» (скачало приложение само). */
function classify(name) {
  if (/\.app\.tar\.gz$/i.test(name)) return ["macOS", "upd"];
  if (/macOS\.zip$/i.test(name) || /\.dmg$/i.test(name)) return ["macOS", "inst"];
  if (/Setup\.exe$/i.test(name)) return ["Windows", "both"];
  if (/\.AppImage$/i.test(name)) return ["Linux", "both"];
  if (/\.deb$/i.test(name)) return ["Linux", "inst"];
  if (/\.apk$/i.test(name)) return ["Android", "inst"];
  return null; // latest.json, .blockmap, .yml — служебные
}

async function adminDownloads() {
  let list;
  try {
    list = await releases();
  } catch (e) {
    return page("Скачивания — JsMessenger", `<main><h1>Скачивания</h1><p class="empty">Не удалось получить данные с GitHub: ${esc(e.message)}</p><p><a href="/admin/">← К отзывам</a></p></main>`);
  }
  const PLAT = ["macOS", "Windows", "Linux", "Android"];
  const total = Object.fromEntries(PLAT.map((p) => [p, { inst: 0, upd: 0, both: 0 }]));
  const rows = [];
  for (const r of list.filter((r) => !r.draft)) {
    const per = Object.fromEntries(PLAT.map((p) => [p, { inst: 0, upd: 0, both: 0 }]));
    for (const a of r.assets ?? []) {
      const c = classify(a.name);
      if (!c) continue;
      per[c[0]][c[1]] += a.download_count;
      total[c[0]][c[1]] += a.download_count;
    }
    rows.push({ tag: r.tag_name, date: r.published_at, per });
  }
  const cell = (x) => {
    const parts = [];
    if (x.inst) parts.push(`${x.inst} уст.`);
    if (x.upd) parts.push(`${x.upd} обн.`);
    if (x.both) parts.push(`${x.both}`);
    return parts.join(" · ") || "—";
  };
  const sum = (x) => x.inst + x.upd + x.both;
  const card = (p) => `<div class="stat"><div class="stat-n">${sum(total[p])}</div><div class="stat-l">${p}</div><div class="stat-s">${esc(cell(total[p]))}</div></div>`;
  const installs = PLAT.reduce((n, p) => n + total[p].inst, 0);
  return page(
    "Скачивания — JsMessenger",
    `<main><h1>Скачивания JsMessenger</h1>
<nav><a class="tab" href="/admin/">Отзывы</a><a class="tab on" href="/admin/downloads">Скачивания</a><a class="tab" href="/admin/plus">Plus</a></nav>
<div class="stats">${PLAT.map(card).join("")}</div>
<p class="note">Скачали вручную (установки macOS, .deb и Android): <b>${installs}</b>.
«обн.» — приложение скачало обновление само. Для Windows и AppImage GitHub не различает установку и обновление — там общее число.
Счётчики GitHub считают каждое скачивание, а не людей; обновляются раз в 10 минут.</p>
<table><thead><tr><th>Версия</th><th>Дата</th>${PLAT.map((p) => `<th>${p}</th>`).join("")}</tr></thead><tbody>
${rows
  .map(
    (r) =>
      `<tr><td>${esc(r.tag)}</td><td>${esc(new Date(r.date).toLocaleDateString("ru-RU"))}</td>${PLAT.map((p) => `<td>${esc(cell(r.per[p]))}</td>`).join("")}</tr>`,
  )
  .join("")}
</tbody></table></main>`,
  );
}

async function adminAction(req, res) {
  // защита от подделки запроса с чужого сайта: действие — только со страницы админки
  const origin = req.headers.origin;
  if (origin && origin !== SITE && origin !== `http://${req.headers.host}`) return send(res, 403, "Forbidden");
  const form = new URLSearchParams(await readBody(req));
  const it = items.find((x) => x.id === form.get("id"));
  const act = form.get("do");
  if (it && act === "done") it.done = true;
  if (it && act === "undone") it.done = false;
  if (it && act === "delete") {
    items = items.filter((x) => x !== it);
    await fs.rm(path.join(FILES_DIR, it.id), { recursive: true, force: true }).catch(() => {});
  }
  if (it) await save();
  const show = ["new", "done", "all"].includes(form.get("show")) ? form.get("show") : "new";
  send(res, 303, "", { Location: `/admin/?show=${show}` });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (await handlePlusApi(req, res, url, { CORS, send, json, readBody, clientIp })) return;
    if (url.pathname === "/api/feedback") {
      if (req.method === "OPTIONS") return send(res, 204, "", CORS);
      if (req.method === "POST") return await postFeedback(req, res);
      return send(res, 405, "", CORS);
    }
    if (url.pathname === "/admin" ) return send(res, 301, "", { Location: "/admin/" });
    if (url.pathname.startsWith("/admin/")) {
      if (url.pathname === "/admin/admin.css") return send(res, 200, ADMIN_CSS, { "Content-Type": "text/css; charset=utf-8" });
      if (!authorized(req))
        return send(res, 401, "Нужен вход", { "WWW-Authenticate": 'Basic realm="JsMessenger feedback", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
      const fm = /^\/admin\/file\/([0-9a-f-]{36})\/(\d+\.(png|jpg|webp|gif))$/.exec(url.pathname);
      if (fm && req.method === "GET") {
        const it = items.find((x) => x.id === fm[1]);
        const f = it?.files?.find((x) => x.file === fm[2]);
        if (!f) return send(res, 404, "Not found");
        const body = await fs.readFile(path.join(FILES_DIR, it.id, f.file)).catch(() => null);
        if (!body) return send(res, 404, "Not found");
        return send(res, 200, body, { "Content-Type": f.type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
      }
      if (url.pathname === "/admin/plus" && req.method === "GET")
        return send(res, 200, adminPlusPage(url, { esc, page, tz: env.TZ }), { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      if (url.pathname === "/admin/plus/action" && req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== SITE && origin !== `http://${req.headers.host}`) return send(res, 403, "Forbidden");
        const to = await adminPlusAction(new URLSearchParams(await readBody(req)));
        return send(res, 303, "", { Location: to });
      }
      if (url.pathname === "/admin/downloads" && req.method === "GET")
        return send(res, 200, await adminDownloads(), { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      if (url.pathname === "/admin/" && req.method === "GET")
        return send(res, 200, adminList(url), { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      if (url.pathname === "/admin/action" && req.method === "POST") return await adminAction(req, res);
    }
    send(res, 404, "Not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status ?? 500, "Error");
  }
});
server.listen(PORT, HOST, () => console.log(`feedback: http://${HOST}:${PORT} (данные: ${DB_FILE})`));
