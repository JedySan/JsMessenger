// Быстрые реакции: свои семь смайликов (меню сообщения и кнопки при наведении).
import { useSyncExternalStore } from "react";

export const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "👌", "🎉", "👀", "✅"];
const KEY = "jsm.reactions";
const listeners = new Set<() => void>();

let list: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) && v.length === DEFAULT_REACTIONS.length && v.every((x) => typeof x === "string" && x) ? v : DEFAULT_REACTIONS;
  } catch {
    return DEFAULT_REACTIONS;
  }
})();

export function getQuickReactions(): string[] {
  return list;
}

export function setQuickReactions(next: string[]) {
  list = next.length === DEFAULT_REACTIONS.length ? next : DEFAULT_REACTIONS;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* без хранилища — до перезапуска */
  }
  listeners.forEach((f) => f());
}

export function useQuickReactions(): string[] {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => list,
  );
}
