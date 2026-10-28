// Общие элементы: всплывающее меню, модальное окно, поиск пользователей.
import { searchPeople } from "../people";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Check, Search, X } from "lucide-react";
import Avatar from "./Avatar";
import { tr } from "../i18n";

// ---------- всплывающее меню ----------
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
  hidden?: boolean;
  /** черта перед пунктом — отделить группу */
  sep?: boolean;
  /** подсказка справа: сочетание клавиш */
  hint?: string;
}

/** Меню, привязанное к координатам (клик правой кнопкой или по кнопке «…»). */
export function PopupMenu({
  x,
  y,
  items,
  onClose,
  header,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** над пунктами — например, ряд реакций */
  header?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // не даём меню вылезти за край окна
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div className="popup-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {header}
      {items
        .filter((i) => !i.hidden)
        .map((i, n) => (
          <div key={n} className="popup-group">
            {i.sep && n > 0 && <div className="popup-sep" role="separator" />}
            <button
              role="menuitem"
              className={"popup-item" + (i.danger ? " danger" : "")}
              onClick={() => {
                onClose();
                i.onClick();
              }}
            >
              <span className="popup-icon">{i.icon}</span>
              <span className="popup-label">{i.label}</span>
              {i.hint && <span className="popup-hint">{i.hint}</span>}
            </button>
          </div>
        ))}
    </div>
  );
}

// ---------- модальное окно ----------
export function Modal({
  title,
  icon,
  children,
  onClose,
  wide,
  busy,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className={"card modal" + (wide ? " wide" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title">
            {icon && <span className="modal-icon small">{icon}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label={tr("Закрыть")}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- выбор пользователей из каталога сервера ----------
export interface PickedUser {
  userId: string;
  name: string;
  avatar?: string;
}

export function UserPicker({
  client,
  selected,
  onChange,
  multiple = true,
  exclude = [],
  autoFocus = true,
}: {
  client: MatrixClient;
  selected: PickedUser[];
  onChange: (u: PickedUser[]) => void;
  multiple?: boolean;
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = term.trim();
    if (!t) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    // небольшая задержка, чтобы не дёргать сервер на каждую букву
    const timer = setTimeout(async () => {
      try {
        // свои (участники наших чатов) + каталог сервера; понимает перепутанную раскладку
        const people = await searchPeople(client, t, 20);
        const list: PickedUser[] = people.map((p) => ({ userId: p.userId, name: p.name, avatar: p.avatar }));
        if (alive) setResults(list.filter((u) => !exclude.includes(u.userId) && u.userId !== client.getSafeUserId()));
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // exclude — массив; сравниваем по содержимому
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, term, exclude.join(",")]);

  const toggle = (u: PickedUser) => {
    const has = selected.some((s) => s.userId === u.userId);
    if (!multiple) onChange(has ? [] : [u]);
    else onChange(has ? selected.filter((s) => s.userId !== u.userId) : [...selected, u]);
  };

  return (
    <div className="user-picker">
      {multiple && selected.length > 0 && (
        <div className="picked">
          {selected.map((u) => (
            <span key={u.userId} className="picked-chip">
              {u.name}
              <button onClick={() => toggle(u)} aria-label={tr("Убрать {0}", u.name)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="search modal-search">
        <Search size={15} />
        <input
          placeholder={tr("Имя, логин или @user:сервер")}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>
      <div className="picker-results">
        {loading && results.length === 0 && <div className="picker-empty">{tr("Ищу…")}</div>}
        {!loading && term.trim() && results.length === 0 && <div className="picker-empty">{tr("Никого не нашлось")}</div>}
        {!term.trim() && <div className="picker-empty">{tr("Начните вводить имя или логин")}</div>}
        {results.map((u) => {
          const on = selected.some((s) => s.userId === u.userId);
          return (
            <button key={u.userId} className={"picker-row" + (on ? " on" : "")} onClick={() => toggle(u)}>
              <Avatar client={client} mxc={u.avatar} name={u.name} seed={u.userId} size={32} />
              <span className="picker-text">
                <span className="picker-name">{u.name}</span>
                <span className="picker-id">{u.userId}</span>
              </span>
              {on && <Check size={16} className="picker-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
