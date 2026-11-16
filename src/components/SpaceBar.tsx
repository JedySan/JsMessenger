import { NotificationCountType, type MatrixClient } from "matrix-js-sdk";
import { MessagesSquare, Plus, User } from "lucide-react";
import { directRoomIds, roomIdsInSpace, topLevelSpaces, type Scope } from "../rooms";
import { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";
import { AccountMark } from "./RoomList";
import { tr } from "../i18n";

/** Узкая колонка слева: все чаты, личные, пространства. */
export default function SpaceBar({
  client,
  scope,
  onScope,
  others = [],
  order,
  onForeignSpace,
}: {
  client: MatrixClient;
  scope: Scope;
  onScope: (s: Scope) => void;
  /** общий список: пространства других аккаунтов тоже здесь (со значком аккаунта) */
  others?: MatrixClient[];
  /** все аккаунты в постоянном порядке — чтобы плитки не переставлялись при переключении аккаунта */
  order?: MatrixClient[];
  /** открыть пространство другого аккаунта (переключает аккаунт) */
  onForeignSpace?: (client: MatrixClient, spaceId: string) => void;
}) {
  const multi = others.length > 0;
  // порядок аккаунтов не зависит от того, какой сейчас открыт: пространства стоят на своих местах
  const accs = multi ? (order?.filter((c) => c === client || others.includes(c)) ?? [client, ...others]) : [client];
  const all = accs.flatMap((c) => topLevelSpaces(c).map((s) => ({ c, s })));
  const unreadIn = (ids: Iterable<string>, c: MatrixClient = client) => {
    let total = 0;
    let mention = false;
    for (const id of ids) {
      const r = c.getRoom(id);
      if (!r) continue;
      total += r.getUnreadNotificationCount(NotificationCountType.Total);
      mention ||= r.getUnreadNotificationCount(NotificationCountType.Highlight) > 0;
    }
    return { total, mention };
  };
  const dms = unreadIn(directRoomIds(client));
  for (const c of others) {
    const u = unreadIn(directRoomIds(c), c);
    dms.total += u.total;
    dms.mention ||= u.mention;
  }

  return (
    <nav className="space-bar" aria-label={tr("Пространства")}>
      <div className="titlebar" data-tauri-drag-region />
      <SpaceButton active={scope.kind === "all"} title={tr("Все чаты")} onClick={() => onScope({ kind: "all" })}>
        <span className="space-icon">
          <MessagesSquare size={20} />
        </span>
      </SpaceButton>
      <SpaceButton
        active={scope.kind === "dm"}
        title={tr("Личные сообщения")}
        onClick={() => onScope({ kind: "dm" })}
        unread={dms.total}
        mention={dms.mention}
      >
        <span className="space-icon">
          <User size={20} />
        </span>
      </SpaceButton>
      {all.length > 0 && <div className="space-sep" />}
      <div className="space-list">
        {all.map(({ c, s }) => {
          const own = c === client;
          const u = unreadIn(roomIdsInSpace(c, s.roomId), c);
          return (
            <SpaceButton
              key={c.getSafeUserId() + s.roomId}
              active={own && scope.kind === "space" && scope.id === s.roomId}
              title={own ? s.name : tr("{0} — аккаунт {1}", s.name, c.getSafeUserId())}
              onClick={() => (own ? onScope({ kind: "space", id: s.roomId }) : onForeignSpace?.(c, s.roomId))}
              unread={u.total}
              mention={u.mention}
            >
              <span className="space-avatar">
                <RoomAvatar client={c} room={s} size={40} />
                {multi && <AccountMark client={c} />}
              </span>
            </SpaceButton>
          );
        })}
      </div>
      <SpaceButton active={false} title={tr("Создать пространство")} onClick={() => openDialog({ kind: "createSpace" })}>
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
