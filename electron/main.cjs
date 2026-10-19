// JsMessenger для Linux (Electron). Интерфейс тот же, что в macOS-версии (папка web/ — сборка Vite).
// Здесь: окно, значок в трее, уведомления, загрузки, доступ к камере/микрофону/экрану,
// автозапуск и автообновление (electron-updater, файлы из релизов GitHub).
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_ID = "jsmessenger";
const HIDDEN_ARG = "--hidden";
const SCHEME = "app";
const ORIGIN = `${SCHEME}://jsm`;
const WEB_DIR = path.join(__dirname, "web");
const ICON = path.join(__dirname, "icons", "icon.png");
const DEV_URL = process.env.JSM_DEV_URL; // npm run electron:dev — интерфейс с dev-сервера Vite

app.setName("JsMessenger");
const IS_WIN = process.platform === "win32";
// Windows показывает уведомления только приложениям с AppUserModelID (совпадает с appId установщика)
if (IS_WIN) app.setAppUserModelId("io.github.jedysan.jsmessenger");

// Один экземпляр: повторный запуск просто показывает окно
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Своя схема app:// вместо file:// — для WASM-шифрования, воркеров и fetch нужен «настоящий» origin
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function serveApp(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const data = fs.readFileSync(file);
    return new Response(data, {
      headers: { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

let win = null;
let tray = null;
let quitting = false;

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

function createWindow(startHidden) {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: "JsMessenger",
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17191c" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once("ready-to-show", () => {
    if (!startHidden) win.show();
  });

  // Крестик прячет окно: приложение продолжает получать сообщения (как на macOS)
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Ссылки — во внешний браузер; само окно никуда не уходит со своей страницы
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const own = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(ORIGIN);
    if (!own) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Инструменты разработчика: Ctrl+Shift+I; перезагрузка: Ctrl+R
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !input.control) return;
    if (input.shift && input.key.toLowerCase() === "i") {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if (!input.shift && input.key.toLowerCase() === "r") {
      win.webContents.reload();
      e.preventDefault();
    }
  });

  win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
}

function setupPermissions() {
  const allowed = new Set([
    "media",
    "notifications",
    "fullscreen",
    "clipboard-read",
    "clipboard-sanitized-write",
    "display-capture",
    "speaker-selection",
  ]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Демонстрация экрана. На Wayland выбор экрана/окна показывает сама система (портал PipeWire) —
  // тогда источник один. Иначе (Windows, X11) показываем свой выбор: экраны и окна с превью.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, cb) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: false,
        });
        if (sources.length <= 1) return cb(sources.length ? { video: sources[0] } : {});
        const id = await pickSource(sources);
        const chosen = sources.find((s) => s.id === id);
        cb(chosen ? { video: chosen } : {});
      } catch (e) {
        console.warn("display media", e);
        cb({});
      }
    },
    { useSystemPicker: true },
  );
}

// ---------- выбор экрана для показа ----------
let pickSeq = 0;
const pickWaiters = new Map();
function pickSource(sources) {
  return new Promise((resolve) => {
    if (!win) return resolve(null);
    const id = ++pickSeq;
    pickWaiters.set(id, resolve);
    showMain();
    win.webContents.send(
      "pick-source",
      id,
      sources.map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.toDataURL() })),
    );
  });
}
ipcMain.on("pick-source-result", (_e, id, sourceId) => {
  const done = pickWaiters.get(id);
  pickWaiters.delete(id);
  done?.(sourceId ?? null);
});

function setupTray() {
  try {
    const size = IS_WIN ? 16 : 22;
    const img = nativeImage.createFromPath(ICON).resize({ width: size, height: size });
    tray = new Tray(img);
    tray.setToolTip("JsMessenger");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Открыть JsMessenger", click: showMain },
        { type: "separator" },
        { label: "Выйти", click: quitApp },
      ]),
    );
    tray.on("click", showMain);
  } catch (e) {
    // нет области уведомлений (например, GNOME без расширения) — окно вернёт повторный запуск
    console.warn("tray", e);
  }
}

// ---------- уведомления ----------
const liveNotifications = new Set(); // держим ссылки, иначе клик по уведомлению теряется

ipcMain.handle("notify", (_e, { title, body, roomId }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, icon: ICON, silent: false });
  liveNotifications.add(n);
  n.on("click", () => {
    showMain();
    if (roomId) win?.webContents.send("notification-click", roomId);
  });
  n.on("close", () => liveNotifications.delete(n));
  setTimeout(() => liveNotifications.delete(n), 10 * 60 * 1000);
  n.show();
  return true;
});

ipcMain.on("attention", () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});

// Входящий звонок: показать окно поверх, но не отнимать фокус у текущей программы
ipcMain.on("show-window", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  if (!win.isFocused()) win.flashFrame(true);
});

ipcMain.on("badge", (_e, count, image) => {
  const n = Number(count) || 0;
  if (IS_WIN) {
    // Windows: кружок с числом поверх значка на панели задач (картинку рисует интерфейс)
    win?.setOverlayIcon(n > 0 && image ? nativeImage.createFromDataURL(image) : null, n > 0 ? `Непрочитанных: ${n}` : "");
  } else {
    app.setBadgeCount(n); // счётчик на значке в доке Ubuntu (Unity/Dash to Dock)
  }
  tray?.setToolTip(n > 0 ? `JsMessenger — непрочитанных: ${n}` : "JsMessenger");
});

// ---------- файлы и ссылки ----------
ipcMain.handle("save-download", async (_e, { name, data }) => {
  const dir = app.getPath("downloads");
  const safe = String(name).replace(/[/\\:*?"<>|]+/g, "_").trim() || "file";
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let file = path.join(dir, safe);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i})${ext}`);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(file, Buffer.from(data));
  shell.showItemInFolder(file);
  return file;
});

ipcMain.handle("open-external", (_e, url) => {
  if (/^(https?|mailto):/i.test(String(url))) return shell.openExternal(url);
});

// ---------- автозапуск: Linux — ~/.config/autostart/jsmessenger.desktop, Windows — реестр ----------
const autostartFile = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "autostart",
  `${APP_ID}.desktop`,
);

// Windows — штатный автозапуск (раздел Run в реестре пользователя)
ipcMain.handle("autostart-get", () =>
  IS_WIN ? app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin : fs.existsSync(autostartFile),
);
ipcMain.handle("autostart-set", async (_e, on) => {
  if (IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: !!on, args: [HIDDEN_ARG] });
    return;
  }
  if (!on) {
    await fs.promises.rm(autostartFile, { force: true });
    return;
  }
  // AppImage запускается по своему пути, установленный .deb — по пути исполняемого файла
  const exe = process.env.APPIMAGE || process.execPath;
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=JsMessenger",
    `Exec="${exe}" ${HIDDEN_ARG}`,
    `Icon=${APP_ID}`,
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
  await fs.promises.mkdir(path.dirname(autostartFile), { recursive: true });
  await fs.promises.writeFile(autostartFile, entry);
});

// ---------- автообновление ----------
let updater = null;
function getUpdater() {
  if (updater) return updater;
  // app-update.yml кладёт electron-builder, когда в сборке настроена публикация
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return null;
  updater = require("electron-updater").autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.logger = console;
  return updater;
}

const stripHtml = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

ipcMain.handle("update-enabled", () => !!getUpdater());
ipcMain.handle("update-check", async () => {
  const u = getUpdater();
  if (!u) return null;
  const r = await u.checkForUpdates();
  if (!r || !r.isUpdateAvailable) return null;
  const notes = Array.isArray(r.updateInfo.releaseNotes)
    ? r.updateInfo.releaseNotes.map((n) => n.note).join(" ")
    : r.updateInfo.releaseNotes;
  return { version: r.updateInfo.version, notes: stripHtml(notes) || undefined };
});
ipcMain.handle("update-download", async (e) => {
  const u = getUpdater();
  if (!u) throw new Error("Автообновление выключено");
  const onProgress = (p) => e.sender.send("update-progress", Math.round(p.percent));
  u.on("download-progress", onProgress);
  try {
    await u.downloadUpdate();
  } finally {
    u.off("download-progress", onProgress);
  }
});
ipcMain.on("update-install", () => {
  const u = getUpdater();
  if (!u) return;
  quitting = true;
  // Windows и AppImage обновляются молча; для .deb система спросит пароль администратора
  setImmediate(() => u.quitAndInstall(IS_WIN, true));
});

ipcMain.on("quit", quitApp);

// ---------- запуск ----------
app.on("second-instance", showMain);
app.on("before-quit", () => {
  quitting = true;
});
app.on("activate", showMain);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serveApp);
  setupPermissions();
  createWindow(process.argv.includes(HIDDEN_ARG));
  setupTray();
});

// Окно не уничтожается при закрытии, но на всякий случай: без окон — выходим
app.on("window-all-closed", () => app.quit());
