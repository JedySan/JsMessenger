import { useState, type MouseEvent } from "react";
import { KnownMembership, NotificationCountType, type MatrixClient, type Room } from "matrix-js-sdk";
import {
  Bell,
  BellOff,
  Check,
  Hash,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Settings,
  Star,
  StarOff,
  UserPlus,
  X,
} from "lucide-react";
import { errText } from "../App";
import { lastMessagePreview, listTime } from "../format";
import {
  directRoomIds,
  isDirect,
  isFavourite,
  isMuted,
  leaveRoom,
  roomIdsInSpace,
  toggleFavourite,
  toggleMute,
  type Scope,
} from "../rooms";
import { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";
import { PopupMenu, type MenuItem } from "./ui";

type Filter = "all" | "unread" | "fav";

export default function RoomList({
  client,
  scope,
  selected,
  onSelect,
  onOpenInfo,
}: {
  client: MatrixClient;
  scope: Scope;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenInfo: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const me = client.getSafeUserId();
  const directs = directRoomIds(client);
  const space = scope.kind === "space" ? client.getRoom(scope.id) : null;
  const inSpace = scope.kind === "space" ? roomIdsInSpace(client, scope.id) : null;

  const f = search.trim().toLowerCase();
  const inScope = (r: Room) => {
    // пространства живут в левой колонке; в списке показываем только приглашения в них
    if (r.isSpaceRoom()) return scope.kind === "all" && r.getMyMembership() === KnownMembership.Invite;
    if (scope.kind === "dm") return isDirect(client, r, directs);
    if (inSpace) return inSpace.has(r.roomId);
    return true;
  };
  const rooms = client.getVisibleRooms().filter((r) => inScope(r) && (!f || r.name.toLowerCase().includes(f)));

  const invites = rooms.filter((r) => r.getMyMembership() === KnownMembership.Invite);
  let joined = rooms
    .filter((r) => r.getMyMembership() === KnownMembership.Join)
    .map((r) => ({ r, last: lastMessagePreview(r, me, isDirect(client, r, directs)) }))
    .sort((a, b) => (b.last?.ts ?? b.r.getLastActiveTimestamp()) - (a.last?.ts ?? a.r.getLastActiveTimestamp()));
  if (filter === "unread") joined = joined.filter(({ r }) => r.getUnreadNotificationCount(NotificationCountType.Total) > 0);
  if (filter === "fav") joined = joined.filter(({ r }) => isFavourite(r));
  const favs = filter === "all" ? joined.filter(({ r }) => isFavourite(r)) : [];
  const rest = filter === "all" ? joined.filter(({ r }) => !isFavourite(r)) : joined;

  const accept = async (r: Room) => {
    try {
      await client.joinRoom(r.roomId);
      onSelect(r.roomId);
    } catch (e) {
      alert(errText(e));
    }
  };
  const decline = async (r: Room) => {
    try {
      await client.leave(r.roomId);
    } catch (e) {
      alert(errText(e));
    }
  };

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => alert(errText(e)));

  const roomMenu = (r: Room, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fav = isFavourite(r);
    const muted = isMuted(client, r);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: fav ? "Убрать из избранного" : "В избранное", icon: fav ? <StarOff size={15} /> : <Star size={15} />, onClick: () => run(() => toggleFavourite(client, r)) },
        { label: muted ? "Включить уведомления" : "Без звука", icon: muted ? <Bell size={15} /> : <BellOff size={15} />, onClick: () => run(() => toggleMute(client, r)) },
        { label: "Пригласить", icon: <UserPlus size={15} />, hidden: !r.canInvite(me), onClick: () => openDialog({ kind: "invite", roomId: r.roomId }) },
        { label: "Участники и настройки", icon: <Settings size={15} />, onClick: () => onOpenInfo(r.roomId) },
        {
          label: "Покинуть",
          icon: <LogOut size={15} />,
          danger: true,
          onClick: () => confirm(`Покинуть «${r.name}»?`) && run(() => leaveRoom(client, r)),
        },
      ],
    });
  };

  const addMenu = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 6,
      items: [
        { label: "Новый личный чат", icon: <MessageSquarePlus size={15} />, onClick: () => openDialog({ kind: "startChat" }) },
        {
          label: space ? `Новая комната в «${space.name}»` : "Новая комната",
          icon: <Hash size={15} />,
          onClick: () => openDialog({ kind: "createRoom", spaceId: space?.roomId }),
        },
        {
          label: "Новое пространство",
          icon: <LayoutGrid size={15} />,
          hidden: !!space,
          onClick: () => openDialog({ kind: "createSpace" }),
        },
      ],
    });
  };

  const title = scope.kind === "all" ? "Все чаты" : scope.kind === "dm" ? "Личные" : (space?.name ?? "Пространство");

  const row = ({ r, last }: { r: Room; last: ReturnType<typeof lastMessagePreview> }) => {
    const unread = r.getUnreadNotificationCount(NotificationCountType.Total);
    const mention = r.getUnreadNotificationCount(NotificationCountType.Highlight) > 0;
    const inCall = (client.matrixRTC.getActiveRoomSession(r)?.memberships.length ?? 0) > 0;
    const muted = isMuted(client, r);
    return (
      <div
        key={r.roomId}
        className={"room-item" + (r.roomId === selected ? " active" : "") + (unread > 0 && !muted ? " unread" : "")}
        onClick={() => onSelect(r.roomId)}
        onContextMenu={(e) => roomMenu(r, e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onSelect(r.roomId)}
      >
        <RoomAvatar client={client} room={r} size={40} />
        <div className="room-main">
          <div className="room-top">
            <span className="room-name">{r.name}</span>
            {muted && <BellOff size={12} className="room-muted" />}
            <span className="room-time">{last ? listTime(last.ts) : ""}</span>
          </div>
          <div className="room-bottom">
            <span className="room-preview">{last?.text ?? "Нет сообщений"}</span>
            {inCall && (
              <span className="room-call" title="Сейчас идёт звонок">
                <Phone size={12} />
              </span>
            )}
            {unread > 0 && (
              <span className={"badge" + (mention ? " mention" : muted ? " quiet" : "")}>{unread > 99 ? "99+" : unread}</span>
            )}
          </div>
        </div>
        <button className="room-more" onClick={(e) => roomMenu(r, e)} aria-label="Действия с чатом">
          <MoreHorizontal size={16} />
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="list-head">
        <div className="list-title" title={title}>
          {title}
        </div>
        {space && (
          <button className="icon-btn small" onClick={() => onOpenInfo(space.roomId)} title="Пространство" aria-label="Страница пространства">
            <LayoutGrid size={15} />
          </button>
        )}
        <button className="icon-btn small" onClick={addMenu} title="Новый чат" aria-label="Новый чат">
          <Plus size={17} />
        </button>
      </div>

      <label className="search">
        <Search size={15} />
        <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")} aria-label="Очистить поиск">
            <X size={14} />
          </button>
        )}
      </label>

      <div className="chips">
        {(
          [
            ["all", "Все"],
            ["unread", "Непрочитанные"],
            ["fav", "Избранное"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      <nav className="room-list">
        {invites.length > 0 && <div className="list-heading">Приглашения</div>}
        {invites.map((r) => (
          <div key={r.roomId} className="room-item invite">
            <RoomAvatar client={client} room={r} size={40} />
            <div className="room-main">
              <div className="room-name">{r.name}</div>
              <div className="room-preview">{inviteText(r, me)}</div>
            </div>
            <div className="invite-actions">
              <button className="round-btn accept" onClick={() => accept(r)} title="Принять" aria-label="Принять">
                <Check size={16} />
              </button>
              <button className="round-btn" onClick={() => decline(r)} title="Отклонить" aria-label="Отклонить">
                <X size={16} />
              </button>
            </div>
          </div>
        ))}

        {favs.length > 0 && <div className="list-heading">Избранное</div>}
        {favs.map(row)}
        {(favs.length > 0 || invites.length > 0) && rest.length > 0 && <div className="list-heading">Чаты</div>}
        {rest.map(row)}

        {joined.length === 0 && invites.length === 0 && (
          <div className="list-empty">
            {f
              ? "Ничего не найдено"
              : filter === "unread"
                ? "Всё прочитано"
                : filter === "fav"
                  ? "Добавьте чаты в избранное через правый клик"
                  : scope.kind === "dm"
                    ? "Личных переписок пока нет. Нажмите «+», чтобы начать личный чат"
                    : scope.kind === "space"
                      ? "Вы не вступили ни в одну комнату этого пространства. Откройте страницу пространства, чтобы выбрать"
                      : "У вас пока нет чатов"}
          </div>
        )}
      </nav>

      {menu && <PopupMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

function inviteText(r: Room, me: string): string {
  const inviterId = r.getMember(me)?.events.member?.getSender();
  const inviter = inviterId ? (r.getMember(inviterId)?.name ?? inviterId) : null;
  if (r.getDMInviter()) return "Хочет начать личный чат";
  if (r.isSpaceRoom()) return inviter ? `${inviter} приглашает в пространство` : "Приглашение в пространство";
  return inviter ? `Приглашает ${inviter}` : "Вас пригласили";
}
