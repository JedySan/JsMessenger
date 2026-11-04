// Настройки этого устройства (не аккаунта): звук, вид уведомлений, общий список чатов.
import { useSyncExternalStore } from "react";

export interface Prefs {
  /** звук нового сообщения */
  sound: boolean;
  /** Windows/Linux: свои всплывашки как в Telegram или уведомления системы */
  notifyStyle: "popup" | "system";
  /** чаты всех аккаунтов в одном списке */
  unified: boolean;
  /** «Не беспокоить»: 0 — уведомления включены, -1 — выключены до включения, иначе — до этого времени (мс) */
  muteUntil: number;
}
const KEY = "jsm.prefs";
const DEFAULTS: Prefs = { sound: true, notifyStyle: "popup", unified: true, muteUntil: 0 };

let prefs: Prefs = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export const getPrefs = () => prefs;
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs = { ...prefs, [k]: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* без хранилища — до перезапуска */
  }
  listeners.forEach((f) => f());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => prefs,
  );
}

/** Уведомления о сообщениях выключены («Не беспокоить»). Звонки звонят всё равно. */
export function isNotifyMuted(): boolean {
  const u = prefs.muteUntil;
  return u === -1 || u > Date.now();
}

// Оболочка Electron: пункт «Не беспокоить» в меню значка в трее
let expiry: number | undefined;
function syncMute() {
  window.jsmDesktop?.setMute?.(isNotifyMuted() ? prefs.muteUntil : 0);
  window.clearTimeout(expiry);
  // время вышло — снова включаем (и меню в трее, и подписи в интерфейсе)
  if (prefs.muteUntil > Date.now()) expiry = window.setTimeout(() => setPref("muteUntil", 0), Math.min(prefs.muteUntil - Date.now(), 2 ** 31 - 1));
}
listeners.add(syncMute);
syncMute();
window.jsmDesktop?.onMute?.((until) => setPref("muteUntil", until));
