import { useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Phone, PhoneOff, Video, X } from "lucide-react";
import { acceptIncoming, declineIncoming, getIncoming, subscribeIncoming } from "../incoming";
import { isDirect } from "../rooms";
import Avatar from "./Avatar";

/** Карточка входящего звонка поверх окна. Для групповых звонков без «ring» — тихая плашка. */
export default function IncomingCall({ client, onOpenRoom }: { client: MatrixClient; onOpenRoom: (id: string) => void }) {
  const c = useSyncExternalStore(subscribeIncoming, getIncoming);
  if (!c) return null;
  const room = client.getRoom(c.roomId);
  if (!room) return null;
  const member = room.getMember(c.sender);
  const who = member?.name ?? c.sender;
  const direct = isDirect(client, room);
  const kind = c.video ? "Входящий видеозвонок" : "Входящий аудиозвонок";

  const accept = (video: boolean) => {
    onOpenRoom(c.roomId);
    acceptIncoming(video).catch((e) => alert(`Не удалось подключиться: ${e}`));
  };

  return (
    <div className={"incoming" + (c.ring ? " ring" : " quiet")} role="alertdialog" aria-label={kind}>
      <div className="incoming-who">
        <span className="incoming-avatar">
          <Avatar client={client} mxc={member?.getMxcAvatarUrl()} name={who} seed={c.sender} size={c.ring ? 56 : 40} />
        </span>
        <span className="incoming-text">
          <b>{who}</b>
          <span>{c.ring ? (direct ? kind : `${kind} · ${room.name}`) : `Начал звонок в «${room.name}»`}</span>
        </span>
      </div>
      <div className="incoming-actions">
        {c.ring ? (
          <>
            <button className="round decline" onClick={() => declineIncoming()} title="Отклонить" aria-label="Отклонить">
              <PhoneOff size={20} />
            </button>
            <button className="round accept" onClick={() => accept(false)} title="Принять без видео" aria-label="Принять без видео">
              <Phone size={20} />
            </button>
            {c.video && (
              <button className="round accept" onClick={() => accept(true)} title="Принять с видео" aria-label="Принять с видео">
                <Video size={20} />
              </button>
            )}
          </>
        ) : (
          <>
            <button className="pill join" onClick={() => accept(false)}>
              <Phone size={15} />
              Присоединиться
            </button>
            <button className="icon-btn" onClick={() => declineIncoming()} title="Скрыть" aria-label="Скрыть">
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
