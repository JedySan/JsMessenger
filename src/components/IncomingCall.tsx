import { useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Phone, PhoneOff, Video, X } from "lucide-react";
import { acceptIncoming, declineIncoming, getIncoming, subscribeIncoming } from "../incoming";
import { isDirect } from "../rooms";
import Avatar from "./Avatar";
import { tr } from "../i18n";
import { notice } from "./Ask";

/** Карточка входящего звонка поверх окна. Для групповых звонков без «ring» — тихая плашка. */
export default function IncomingCall({ client, onOpenRoom }: { client: MatrixClient; onOpenRoom: (id: string) => void }) {
  const c = useSyncExternalStore(subscribeIncoming, getIncoming);
  if (!c) return null;
  const room = client.getRoom(c.roomId);
  if (!room) return null;
  const member = room.getMember(c.sender);
  const who = member?.name ?? c.sender;
  const direct = isDirect(client, room);
  const kind = c.video ? tr("Входящий видеозвонок") : tr("Входящий аудиозвонок");

  const accept = (video: boolean) => {
    onOpenRoom(c.roomId);
    acceptIncoming(video).catch((e) => notice(tr("Не удалось подключиться: {0}", e)));
  };

  return (
    <div className={"incoming" + (c.ring ? " ring" : " quiet")} role="alertdialog" aria-label={kind}>
      <div className="incoming-who">
        <span className="incoming-avatar">
          <Avatar client={client} mxc={member?.getMxcAvatarUrl()} name={who} seed={c.sender} size={c.ring ? 56 : 40} />
        </span>
        <span className="incoming-text">
          <b>{who}</b>
          <span>{c.ring ? (direct ? kind : `${kind} · ${room.name}`) : tr("Начал звонок в «{0}»", room.name)}</span>
        </span>
      </div>
      <div className="incoming-actions">
        {c.ring ? (
          <>
            <button className="round decline" onClick={() => declineIncoming()} title={tr("Отклонить")} aria-label={tr("Отклонить")}>
              <PhoneOff size={20} />
            </button>
            <button className="round accept" onClick={() => accept(false)} title={tr("Принять без видео")} aria-label={tr("Принять без видео")}>
              <Phone size={20} />
            </button>
            {c.video && (
              <button className="round accept" onClick={() => accept(true)} title={tr("Принять с видео")} aria-label={tr("Принять с видео")}>
                <Video size={20} />
              </button>
            )}
          </>
        ) : (
          <>
            <button className="pill join" onClick={() => accept(false)}>
              <Phone size={15} />
              {tr("Присоединиться")}
            </button>
            <button className="icon-btn" onClick={() => declineIncoming()} title={tr("Скрыть")} aria-label={tr("Скрыть")}>
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
