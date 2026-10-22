// Свои окна подтверждения и сообщений вместо window.confirm/alert:
// во встроенном WebView (Tauri на macOS, Android) системные окна не показываются,
// confirm() молча возвращает false — и действие (например, удаление) не выполнялось.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { tr } from "../i18n";

interface AskState {
  text: string;
  ok: string;
  cancel: string | null; // null — простое сообщение с одной кнопкой
  danger: boolean;
  resolve: (v: boolean) => void;
}

const queue: AskState[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function push(s: Omit<AskState, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ ...s, resolve });
    emit();
  });
}

/** Спросить подтверждение. Возвращает true, если нажали «ОК». */
export function ask(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return push({ text, ok: opts.ok ?? tr("Продолжить"), cancel: tr("Отмена"), danger: !!opts.danger });
}

/** Показать сообщение (ошибку, результат) с кнопкой «Понятно». */
export function notice(text: unknown): void {
  const s = text instanceof Error ? text.message : String(text);
  void push({ text: s, ok: tr("Понятно"), cancel: null, danger: false });
}

export function AskHost() {
  const cur = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => queue[0] ?? null,
  );
  const okRef = useRef<HTMLButtonElement>(null);

  const done = (v: boolean) => {
    const s = queue.shift();
    s?.resolve(v);
    emit();
  };

  useEffect(() => {
    if (!cur) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cur]);

  if (!cur) return null;
  return (
    <div className="modal-bg ask-bg" onClick={() => done(false)}>
      <div className="card modal ask" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="ask-text">{cur.text}</p>
        <div className="modal-actions">
          {cur.cancel !== null && (
            <button className="ghost" onClick={() => done(false)}>
              {cur.cancel}
            </button>
          )}
          <button ref={okRef} className={"primary" + (cur.danger ? " danger-bg" : "")} onClick={() => done(true)}>
            {cur.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
