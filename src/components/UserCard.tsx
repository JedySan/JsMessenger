import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Check, Copy, MessageSquare, Phone, Video } from "lucide-react";
import { openDirectChat } from "../rooms";
import { call } from "../call";
import { errText } from "../App";
import Avatar from "./Avatar";
import { Modal } from "./ui";
import { tr } from "../i18n";

/** Карточка человека: имя, адрес и быстрые действия — написать, позвонить. */
export default function UserCard({
  client,
  userId,
  onClose,
  onOpenRoom,
}: {
  client: MatrixClient;
  userId: string;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
}) {
  const known = client.getUser(userId);
  const [profile, setProfile] = useState<{ name: string; avatar?: string }>({
    name: known?.displayName || userId,
    avatar: known?.avatarUrl,
  });
  const [busy, setBusy] = useState<null | "chat" | "audio" | "video">(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = userId === client.getSafeUserId();

  // свежий профиль с сервера (имя и аватар могли поменяться)
  useEffect(() => {
    let alive = true;
    client
      .getProfileInfo(userId)
      .then((p) => alive && setProfile({ name: p.displayname || userId, avatar: p.avatar_url }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, userId]);

  const go = async (what: "chat" | "audio" | "video") => {
    setBusy(what);
    setError(null);
    try {
      const roomId = await openDirectChat(client, userId);
      onOpenRoom(roomId);
      onClose();
      if (what !== "chat") {
        const room = client.getRoom(roomId);
        if (room) await call.join(client, room, what === "video");
      }
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal title="" onClose={onClose}>
      <div className="user-card">
        <Avatar client={client} mxc={profile.avatar} name={profile.name} seed={userId} size={84} />
        <div className="user-card-name">{profile.name}</div>
        <button className="user-card-id" onClick={copy} title={tr("Скопировать адрес")}>
          {userId}
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {!me && (
          <div className="user-card-actions">
            <button className="user-action" onClick={() => go("chat")} disabled={!!busy}>
              <MessageSquare size={20} />
              <span>{busy === "chat" ? tr("Открываю…") : tr("Написать")}</span>
            </button>
            <button className="user-action" onClick={() => go("audio")} disabled={!!busy}>
              <Phone size={20} />
              <span>{tr("Позвонить")}</span>
            </button>
            <button className="user-action" onClick={() => go("video")} disabled={!!busy}>
              <Video size={20} />
              <span>{tr("Видеозвонок")}</span>
            </button>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}
