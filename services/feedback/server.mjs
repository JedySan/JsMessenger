// Приём отзывов из JsMessenger.
//   POST /api/feedback  — отзыв из приложения (JSON); сохраняется и уходит письмом
//   GET  /admin/        — админка: список отзывов (вход по логину и паролю)
// Настройки — переменные окружения (см. feedback.env.example). Зависимость одна: nodemailer.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
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
    data = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, e.status ?? 400, { error: "bad request" }, CORS);
  }
  const text = clip(data?.text, MAX_TEXT);
  if (!text) return json(res, 400, { error: "empty" }, CORS);
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
  };
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
<nav>${tab("new", `Новые${fresh ? ` <b>${fresh}</b>` : ""}`)}${tab("done", "Обработанные")}${tab("all", "Все")}</nav>
${list.length ? list.map(card).join("") : `<p class="empty">Пусто</p>`}</main>`,
  );
}

const ADMIN_CSS = `
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
button.danger{color:#d9534f}.empty{color:var(--muted)}`;

async function adminAction(req, res) {
  // защита от подделки запроса с чужого сайта: действие — только со страницы админки
  const origin = req.headers.origin;
  if (origin && origin !== SITE && origin !== `http://${req.headers.host}`) return send(res, 403, "Forbidden");
  const form = new URLSearchParams(await readBody(req));
  const it = items.find((x) => x.id === form.get("id"));
  const act = form.get("do");
  if (it && act === "done") it.done = true;
  if (it && act === "undone") it.done = false;
  if (it && act === "delete") items = items.filter((x) => x !== it);
  if (it) await save();
  const show = ["new", "done", "all"].includes(form.get("show")) ? form.get("show") : "new";
  send(res, 303, "", { Location: `/admin/?show=${show}` });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
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
