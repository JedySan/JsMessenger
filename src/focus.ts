// Активно ли окно приложения. document.hasFocus() во встроенном WebView macOS (Tauri)
// бывает ложным, хотя окно на переднем плане, — тогда отметки о прочтении не уходили,
// а телефон продолжал показывать сообщения непрочитанными. Поэтому собираем сигналы отовсюду.
import { isMobile, isTauri } from "./platform";

let focused = document.hasFocus() && !document.hidden;
const listeners = new Set<() => void>();

function set(v: boolean) {
  if (v === focused) return;
  focused = v;
  if (v) listeners.forEach((f) => f());
}

window.addEventListener("focus", () => set(true));
window.addEventListener("blur", () => set(false));
document.addEventListener("visibilitychange", () => set(!document.hidden));
// пользователь что-то делает в окне — значит, оно точно активно
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(ev, () => !document.hidden && set(true), { capture: true, passive: true });
}

if (isTauri() && !isMobile()) {
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      set(await w.isFocused());
      await w.onFocusChanged(({ payload }) => set(payload));
    } catch {
      /* без Tauri API остаются события браузера */
    }
  })();
} else if (isMobile()) {
  // на телефоне приложение на экране = активно
  focused = !document.hidden;
}

/** Окно приложения сейчас активно (пользователь его видит и с ним работает). */
export function isAppFocused(): boolean {
  return focused && !document.hidden;
}

/** Вызвать, когда окно снова стало активным. Возвращает отписку. */
export function onAppFocus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
