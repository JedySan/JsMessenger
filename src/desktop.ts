// Возможности настольного приложения: автообновление, автозапуск, выход.
// В браузере (npm run dev) всё это тихо выключено.

import { electron, isAndroidApp, isDesktop, isTauri } from "./platform";
import { tr } from "./i18n";

// ---------- автообновление ----------
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
const listeners = new Set<() => void>();
let hideTimer: number | undefined;
function set(s: UpdateState) {
  state = s;
  listeners.forEach((f) => f());
  // «У вас последняя версия» — короткое подтверждение, само скрывается
  window.clearTimeout(hideTimer);
  if (s.kind === "none") hideTimer = window.setTimeout(() => state.kind === "none" && set({ kind: "idle" }), 4000);
}
export function getUpdateState() {
  return state;
}
export function subscribeUpdate(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

// Найденное обновление — объект плагина; держим его до установки
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

/** Включено ли автообновление в этой сборке (зависит от ключа подписи при сборке). */
export async function updaterEnabled(): Promise<boolean> {
  if (isAndroidApp()) return true;
  const el = electron();
  if (el) return el.updaterEnabled().catch(() => false);
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("updater_enabled").catch(() => false);
}

/** Проверить наличие обновления. silent — не показывать «обновлений нет» и ошибки сети. */
export async function checkForUpdate(silent = false): Promise<void> {
  if (!(await updaterEnabled())) {
    if (!silent) set({ kind: "error", message: tr("В этой сборке автообновление выключено") });
    return;
  }
  if (state.kind === "downloading" || state.kind === "ready") return;
  set({ kind: "checking" });
  try {
    if (isAndroidApp()) {
      const u = await checkAndroidRelease();
      if (u) set({ kind: "available", version: u.version, notes: u.notes });
      else set(silent ? { kind: "idle" } : { kind: "none" });
      return;
    }
    const el = electron();
    if (el) {
      const u = await el.updateCheck();
      if (u) set({ kind: "available", version: u.version, notes: u.notes });
      else set(silent ? { kind: "idle" } : { kind: "none" });
      return;
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pending = update;
      set({ kind: "available", version: update.version, notes: update.body ?? undefined });
    } else {
      set(silent ? { kind: "idle" } : { kind: "none" });
    }
  } catch (e) {
    console.warn("update check", e);
    set(silent ? { kind: "idle" } : { kind: "error", message: tr("Не удалось проверить обновления: {0}", String(e)) });
  }
}

/** Скачать и установить; после установки — перезапуск. */
export async function installUpdate(): Promise<void> {
  if (isAndroidApp()) {
    // Android: скачивание APK в браузере; установка — по уведомлению о загрузке
    if (apkUrl) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(apkUrl).catch((e) => set({ kind: "error", message: tr("Не удалось открыть загрузку: {0}", String(e)) }));
      dismissUpdate();
    }
    return;
  }
  const el = electron();
  if (el) {
    if (state.kind !== "available") return;
    const version = state.version;
    set({ kind: "downloading", version, percent: null });
    try {
      await el.updateDownload((percent) => set({ kind: "downloading", version, percent }));
      set({ kind: "ready", version });
      el.updateInstall();
    } catch (e) {
      console.error("update install", e);
      set({ kind: "error", message: tr("Не удалось установить обновление: {0}", String(e)) });
    }
    return;
  }
  if (!pending) return;
  const version = pending.version;
  let total = 0;
  let got = 0;
  set({ kind: "downloading", version, percent: null });
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ kind: "downloading", version, percent: total ? Math.min(100, Math.round((got / total) * 100)) : null });
      }
    });
    set({ kind: "ready", version });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    console.error("update install", e);
    set({ kind: "error", message: tr("Не удалось установить обновление: {0}", String(e)) });
  }
}

export function dismissUpdate() {
  if (state.kind === "available" || state.kind === "error" || state.kind === "none") set({ kind: "idle" });
}

// ---------- Android: новые версии — APK в релизах GitHub ----------
const RELEASES_API = "https://api.github.com/repos/JedySan/JsMessenger/releases/latest";
let apkUrl: string | null = null;

/** «1.2.10» > «1.2.9» */
function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

async function checkAndroidRelease(): Promise<{ version: string; notes?: string } | null> {
  const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(tr("GitHub ответил {0}", res.status));
  const rel = await res.json();
  const version = String(rel.tag_name ?? "").replace(/^v/, "");
  const apk = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith(".apk"));
  if (!version || !apk || !newer(version, __APP_VERSION__)) return null;
  apkUrl = apk.browser_download_url;
  return { version, notes: (rel.body ?? "").trim() || undefined };
}

let timer: number | undefined;
/** Проверка при запуске и затем каждые 6 часов. */
export function startUpdateChecks() {
  if (!(isDesktop() || isAndroidApp()) || timer) return;
  setTimeout(() => checkForUpdate(true), 15_000);
  timer = window.setInterval(() => checkForUpdate(true), 6 * 60 * 60 * 1000);
}

// ---------- автозапуск ----------
const FIRST_RUN_KEY = "jsm.autostart.initialized";

export async function isAutostartEnabled(): Promise<boolean> {
  const el = electron();
  if (el) return el.autostartGet().catch(() => false);
  if (!isTauri()) return false;
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled().catch(() => false);
}

export async function setAutostart(on: boolean): Promise<void> {
  const el = electron();
  if (el) return el.autostartSet(on);
  if (!isTauri()) return;
  const a = await import("@tauri-apps/plugin-autostart");
  if (on) await a.enable();
  else await a.disable();
}

/** При первом запуске включаем автозапуск — мессенджер должен работать всегда. Дальше решает пользователь. */
export async function initAutostartOnce(): Promise<void> {
  if (!isDesktop() || import.meta.env.DEV) return;
  try {
    if (localStorage.getItem(FIRST_RUN_KEY)) return;
    localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch {
    return;
  }
  await setAutostart(true).catch((e) => console.warn("autostart", e));
}

// ---------- полноэкранный режим (для демонстрации экрана в звонке) ----------
/** На весь экран — само окно приложения (на macOS — отдельный рабочий стол, как у видео). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if ((await w.isFullscreen()) !== on) await w.setFullscreen(on);
      return;
    }
    // Electron и браузер — стандартный Fullscreen API
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch (e) {
    console.warn("fullscreen", e);
  }
}

// ---------- выход ----------
/** Полный выход (крестик только прячет окно). */
export async function quitApp(): Promise<void> {
  const el = electron();
  if (el) return el.quit();
  if (!isTauri()) return;
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}
