// Жесты на сообщении (телефон): долгое нажатие — меню, свайп влево — ответить. Как в Telegram.
import { useEffect, type RefObject } from "react";

const LONG_MS = 420;
const SWIPE_REPLY = 64;
const SWIPE_MAX = 84;

export function useMessageGestures(
  ref: RefObject<HTMLElement | null>,
  /** что сдвигаем при свайпе (пузырь) */
  moveRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  on: { long: (x: number, y: number) => void; reply?: () => void },
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let timer = 0;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let mode: "" | "swipe" | "scroll" = "";
    let fired = false;

    const reset = () => {
      window.clearTimeout(timer);
      const m = moveRef.current;
      if (m && dx) {
        m.style.transition = "transform 0.2s ease";
        m.style.transform = "";
        el.style.removeProperty("--swipe");
      }
      dx = 0;
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
      dx = 0;
      mode = "";
      fired = false;
      window.clearTimeout(timer);
      // долгое нажатие на полях ввода и плеерах — системное
      if ((e.target as HTMLElement).closest("input, textarea, video, audio")) return;
      timer = window.setTimeout(() => {
        fired = true;
        navigator.vibrate?.(8);
        on.long(x0, y0);
      }, LONG_MS);
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (!mode && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        window.clearTimeout(timer);
        mode = on.reply && mx < 0 && Math.abs(mx) > Math.abs(my) * 1.4 ? "swipe" : "scroll";
      }
      if (mode !== "swipe") return;
      e.preventDefault(); // не прокручивать ленту, пока тянем пузырь
      dx = Math.max(-SWIPE_MAX, Math.min(0, mx));
      const m = moveRef.current;
      if (m) {
        m.style.transition = "none";
        m.style.transform = `translateX(${dx}px)`;
      }
      el.style.setProperty("--swipe", String(Math.min(1, -dx / SWIPE_REPLY)));
    };
    const end = (e: TouchEvent) => {
      window.clearTimeout(timer);
      if (fired) e.preventDefault(); // после меню не открывать то, что было под пальцем
      if (mode === "swipe" && dx <= -SWIPE_REPLY) {
        navigator.vibrate?.(8);
        on.reply?.();
      }
      reset();
      mode = "";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", reset);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", reset);
    };
  });
}

// ---------- долгое нажатие на строке списка (чаты) ----------
let lpTimer = 0;
let lpX = 0;
let lpY = 0;
let lpFired = false;
/** Обработчики для React-элемента: долгое нажатие вызывает onLong, а «клик» после него гасится. */
export function longPressProps(onLong: (x: number, y: number) => void) {
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      lpX = t.clientX;
      lpY = t.clientY;
      lpFired = false;
      window.clearTimeout(lpTimer);
      lpTimer = window.setTimeout(() => {
        lpFired = true;
        navigator.vibrate?.(8);
        onLong(lpX, lpY);
      }, LONG_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (Math.abs(t.clientX - lpX) > 8 || Math.abs(t.clientY - lpY) > 8) window.clearTimeout(lpTimer);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      window.clearTimeout(lpTimer);
      if (lpFired) e.preventDefault();
    },
    onTouchCancel: () => window.clearTimeout(lpTimer),
  };
}
