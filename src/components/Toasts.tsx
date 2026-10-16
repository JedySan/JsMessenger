import { useSyncExternalStore } from "react";
import { MessageSquare, X } from "lucide-react";
import { dismissToast, getToasts, subscribeToasts } from "../notifications";

/** Карточки о новых сообщениях внутри приложения (когда окно в фокусе). */
export default function Toasts({ onOpen }: { onOpen: (roomId: string) => void }) {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <button
            className="toast-main"
            onClick={() => {
              dismissToast(t.id);
              onOpen(t.roomId);
            }}
          >
            <MessageSquare size={16} />
            <span>
              <b>{t.title}</b>
              <span>{t.body}</span>
            </span>
          </button>
          <button className="icon-btn small" onClick={() => dismissToast(t.id)} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
