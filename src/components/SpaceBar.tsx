import { NotificationCountType, type MatrixClient } from "matrix-js-sdk";
import { MessagesSquare, Plus, User } from "lucide-react";
import { directRoomIds, roomIdsInSpace, topLevelSpaces, type Scope } from "../rooms";
import { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";

/** Узкая колонка слева: все чаты, личные, пространства. */
export default function SpaceBar({ client, scope, onScope }: { client: MatrixClient; scope: Scope; onScope: (s: Scope) => void }) {
  const spaces = topLevelSpaces(client);
  const unreadIn = (ids: Iterable<string>) => {
    let total = 0;
    let mention = false;
    for (const id of ids) {
      const r = client.getRoom(id);
      if (!r) continue;
      total += r.getUnreadNotificationCount(NotificationCountType.Total);
      mention ||= r.getUnreadNotificationCount(NotificationCountType.Highlight) > 0;
    }
    return { total, mention };
  };
  const dms = unreadIn(directRoomIds(client));

  return (
    <nav className="space-bar" aria-label="Пространства">
      <div className="titlebar" data-tauri-drag-region />
      <SpaceButton active={scope.kind === "all"} title="Все чаты" onClick={() => onScope({ kind: "all" })}>
        <span className="space-icon">
          <MessagesSquare size={20} />
        </span>
      </SpaceButton>
      <SpaceButton
        active={scope.kind === "dm"}
        title="Личные сообщения"
        onClick={() => onScope({ kind: "dm" })}
        unread={dms.total}
        mention={dms.mention}
      >
        <span className="space-icon">
          <User size={20} />
        </span>
      </SpaceButton>
      {spaces.length > 0 && <div className="space-sep" />}
      <div className="space-list">
        {spaces.map((s) => {
          const u = unreadIn(roomIdsInSpace(client, s.roomId));
          return (
            <SpaceButton
              key={s.roomId}
              active={scope.kind === "space" && scope.id === s.roomId}
              title={s.name}
              onClick={() => onScope({ kind: "space", id: s.roomId })}
              unread={u.total}
              mention={u.mention}
            >
              <span className="space-avatar">
                <RoomAvatar client={client} room={s} size={40} />
              </span>
            </SpaceButton>
          );
        })}
      </div>
      <SpaceButton active={false} title="Создать пространство" onClick={() => openDialog({ kind: "createSpace" })}>
        <span className="space-icon add">
          <Plus size={20} />
        </span>
      </SpaceButton>
    </nav>
  );
}

function SpaceButton({
  active,
  title,
  onClick,
  unread = 0,
  mention = false,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  unread?: number;
  mention?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button className={"space-btn" + (active ? " active" : "")} onClick={onClick} title={title} aria-label={title}>
      <span className="space-pip" />
      {children}
      {unread > 0 &&
        (mention ? <span className="space-badge">{unread > 99 ? "99+" : unread}</span> : <span className="space-dot" />)}
    </button>
  );
}
