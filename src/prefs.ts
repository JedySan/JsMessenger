// Настройки этого устройства (не аккаунта): звук, вид уведомлений, общий список чатов.
import { useSyncExternalStore } from "react";

export interface Prefs {
  /** звук нового сообщения */
  sound: boolean;
  /** Windows/Linux: свои всплывашки как в Telegram или уведомления системы */
  notifyStyle: "popup" | "system";
  /** чаты всех аккаунтов в одном списке */
  unified: boolean;
}
const KEY = "jsm.prefs";
const DEFAULTS: Prefs = { sound: true, notifyStyle: "popup", unified: true };

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
