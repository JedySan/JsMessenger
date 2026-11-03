// Всплывающие уведомления как в Telegram: свои окошки в правом нижнем углу экрана, поверх всех окон.
// Системные уведомления Windows и Linux часто прячутся в «Центр уведомлений» или не показываются вовсе
// (режим «Не беспокоить», GNOME без значков) — эти видны всегда, пока приложение свёрнуто или в фоне.
const { BrowserWindow, nativeTheme, screen } = require("electron");

const WIDTH = 360;
const HEIGHT = 86;
const GAP = 10;
const MARGIN = 14;
const SHOW_MS = 6500;
const MAX = 3;

/** @type {{ win: BrowserWindow, timer: NodeJS.Timeout | null }[]} */
let shown = [];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page({ title, body, icon }) {
  const dark = nativeTheme.shouldUseDarkColors;
  const bg = dark ? "rgba(34,40,47,0.97)" : "rgba(255,255,255,0.98)";
  const fg = dark ? "#e7eaee" : "#17202b";
  const fg2 = dark ? "#a2aab4" : "#5d6773";
  const line = dark ? "rgba(255,255,255,0.08)" : "rgba(16,24,32,0.10)";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;
      font:14px/1.35 "Segoe UI",-apple-system,"Noto Sans",Ubuntu,sans-serif;-webkit-user-select:none;user-select:none}
    .card{box-sizing:border-box;position:absolute;inset:4px;display:flex;gap:12px;align-items:center;padding:12px 34px 12px 14px;
      border-radius:14px;background:${bg};color:${fg};box-shadow:0 0 0 1px ${line},0 6px 18px rgba(0,0,0,.25);cursor:pointer;
      animation:in .22s cubic-bezier(.2,.9,.3,1.1)}
    @keyframes in{from{transform:translateX(30px);opacity:0}}
    .card:hover{filter:brightness(${dark ? 1.08 : 0.98})}
    img{width:42px;height:42px;border-radius:50%;flex-shrink:0}
    .t{min-width:0;flex:1}
    b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:${fg2};font-size:13px}
    a{position:absolute;top:8px;right:10px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      color:${fg2};text-decoration:none;font-size:15px;line-height:1}
    a:hover{background:${line};color:${fg}}
  </style></head><body>
    <div class="card" onclick="location.href='jsm-popup://open'">
      <img src="${icon}" alt="">
      <div class="t"><b>${esc(title)}</b><span>${esc(body)}</span></div>
      <a href="jsm-popup://close" onclick="event.stopPropagation()" title="Закрыть">✕</a>
    </div></body></html>`;
}

function layout() {
  const area = screen.getPrimaryDisplay().workArea;
  shown.forEach(({ win }, i) => {
    if (win.isDestroyed()) return;
    const x = area.x + area.width - WIDTH - MARGIN;
    const y = area.y + area.height - MARGIN - (i + 1) * HEIGHT - i * GAP;
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
  });
}

function close(entry) {
  if (entry.timer) clearTimeout(entry.timer);
  shown = shown.filter((e) => e !== entry);
  if (!entry.win.isDestroyed()) entry.win.destroy();
  layout();
}

/**
 * Показать всплывашку. onOpen — нажали на неё (открыть чат).
 * icon — data: URL картинки (значок приложения или аватар).
 */
function showPopup({ title, body, icon }, onOpen) {
  // в одном чате — одна всплывашка: свежая заменяет старую (как в Telegram); не больше трёх
  while (shown.length >= MAX) close(shown[shown.length - 1]);
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces?.(true);
  const entry = { win, timer: null };
  shown.unshift(entry);
  layout();

  const arm = () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => close(entry), SHOW_MS);
  };
  win.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    if (url.startsWith("jsm-popup://open")) onOpen();
    close(entry);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page({ title, body, icon })));
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.showInactive();
    arm();
  });
  return true;
}

function closeAllPopups() {
  [...shown].forEach(close);
}

module.exports = { showPopup, closeAllPopups };
