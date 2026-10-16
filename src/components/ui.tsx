// Общие элементы: всплывающее меню, модальное окно, поиск пользователей.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Check, Search, X } from "lucide-react";
import Avatar from "./Avatar";

// ---------- всплывающее меню ----------
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
  hidden?: boolean;
}

/** Меню, привязанное к координатам (клик правой кнопкой или по кнопке «…»). */
export function PopupMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
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
      {items
        .filter((i) => !i.hidden)
        .map((i, n) => (
          <button
            key={n}
            role="menuitem"
            className={"popup-item" + (i.danger ? " danger" : "")}
            onClick={() => {
              onClose();
              i.onClick();
            }}
          >
            <span className="popup-icon">{i.icon}</span>
            {i.label}
          </button>
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
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть">
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
        const res = await client.searchUserDirectory({ term: t, limit: 20 });
        let list: PickedUser[] = res.results.map((r) => ({
          userId: r.user_id,
          name: r.display_name || r.user_id,
          avatar: r.avatar_url,
        }));
        // полный MXID, которого нет в каталоге, тоже можно выбрать
        if (/^@[^:]+:.+/.test(t) && !list.some((u) => u.userId === t)) list = [{ userId: t, name: t }, ...list];
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
              <button onClick={() => toggle(u)} aria-label={`Убрать ${u.name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="search modal-search">
        <Search size={15} />
        <input
          placeholder="Имя, логин или @user:сервер"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>
      <div className="picker-results">
        {loading && results.length === 0 && <div className="picker-empty">Ищу…</div>}
        {!loading && term.trim() && results.length === 0 && <div className="picker-empty">Никого не нашлось</div>}
        {!term.trim() && <div className="picker-empty">Начните вводить имя или логин</div>}
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
