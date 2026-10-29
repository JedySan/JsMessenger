// Телефон: нижняя стеклянная панель вкладок (как в Telegram) и экраны «Пространства» и «Настройки».
import type { ReactNode } from "react";
import { NotificationCountType, type MatrixClient } from "matrix-js-sdk";
import { ChevronRight, LayoutGrid, MessagesSquare, Plus, Settings, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { directRoomIds, roomIdsInSpace, topLevelSpaces } from "../rooms";
import Avatar, { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";
import type { MenuItem } from "./ui";
import { plural, tr } from "../i18n";

export type Tab = "chats" | "dms" | "spaces" | "settings";

function unreadIn(client: MatrixClient, ids: Iterable<string>) {
  let total = 0;
  let mention = false;
  for (const id of ids) {
    const r = client.getRoom(id);
    if (!r || r.isSpaceRoom()) continue;
    total += r.getUnreadNotificationCount(NotificationCountType.Total);
    mention ||= r.getUnreadNotificationCount(NotificationCountType.Highlight) > 0;
  }
  return { total, mention };
}

export function TabBar({ client, tab, onTab }: { client: MatrixClient; tab: Tab; onTab: (t: Tab) => void }) {
  const all = unreadIn(client, client.getRooms().map((r) => r.roomId));
  const dms = unreadIn(client, directRoomIds(client));
  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; badge?: number }> = [
    { id: "chats", label: tr("Чаты"), icon: <MessagesSquare size={22} />, badge: all.total },
    { id: "dms", label: tr("Личные"), icon: <User size={22} />, badge: dms.total },
    { id: "spaces", label: tr("Пространства"), icon: <LayoutGrid size={22} /> },
    { id: "settings", label: tr("Настройки"), icon: <Settings size={22} /> },
  ];
  return (
    <nav className="tab-bar" aria-label={tr("Разделы")}>
      {tabs.map((t) => (
        <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => onTab(t.id)} aria-current={tab === t.id}>
          <span className="tab-icon">
            {t.icon}
            {!!t.badge && <span className="tab-badge">{t.badge > 99 ? "99+" : t.badge}</span>}
          </span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Список пространств — вместо колонки значков слева. */
export function SpacesPage({ client, onOpen }: { client: MatrixClient; onOpen: (id: string) => void }) {
  const spaces = topLevelSpaces(client);
  return (
    <div className="m-page">
      <div className="list-head">
        <div className="list-title">{tr("Пространства")}</div>
        <button className="icon-btn small" onClick={() => openDialog({ kind: "createSpace" })} title={tr("Создать пространство")} aria-label={tr("Создать пространство")}>
          <Plus size={17} />
        </button>
      </div>
      {spaces.length === 0 ? (
        <div className="m-empty">
          <LayoutGrid size={34} />
          <p>{tr("Пространства собирают чаты команды или сообщества в одном месте.")}</p>
          <button className="primary" onClick={() => openDialog({ kind: "createSpace" })}>
            {tr("Создать пространство")}
          </button>
        </div>
      ) : (
        <div className="m-group">
          {spaces.map((s) => {
            const ids = roomIdsInSpace(client, s.roomId);
            const u = unreadIn(client, ids);
            const rooms = [...ids].filter((id) => !client.getRoom(id)?.isSpaceRoom()).length;
            return (
              <button key={s.roomId} className="m-row" onClick={() => onOpen(s.roomId)}>
                <RoomAvatar client={client} room={s} size={44} />
                <span className="m-row-text">
                  <span className="m-row-title">{s.name}</span>
                  <span className="m-row-sub">
                    {rooms} {plural(rooms, "чат", "чата", "чатов")}
                  </span>
                </span>
                {u.total > 0 && <span className={"badge" + (u.mention ? " mention" : "")}>{u.total > 99 ? "99+" : u.total}</span>}
                <ChevronRight size={18} className="m-row-go" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Настройки: профиль сверху, дальше — те же пункты, что в меню «…» на компьютере. */
export function SettingsPage({
  client,
  name,
  avatar,
  verified,
  onProfile,
  onVerify,
  items,
}: {
  client: MatrixClient;
  name: string;
  avatar?: string | null;
  verified: boolean | null;
  onProfile: () => void;
  onVerify: () => void;
  items: MenuItem[];
}) {
  const visible = items.filter((i) => !i.hidden);
  // группы — по разделителям (sep), как в меню
  const groups: MenuItem[][] = [];
  for (const i of visible) {
    if (i.sep || !groups.length) groups.push([]);
    groups[groups.length - 1].push(i);
  }
  return (
    <div className="m-page">
      <div className="list-head">
        <div className="list-title">{tr("Настройки")}</div>
      </div>
      <button className="m-profile" onClick={onProfile}>
        <Avatar client={client} mxc={avatar ?? undefined} name={name} seed={client.getSafeUserId()} size={64} />
        <span className="m-row-text">
          <span className="m-profile-name">{name}</span>
          <span className="m-row-sub">{client.getSafeUserId()}</span>
        </span>
        <ChevronRight size={18} className="m-row-go" />
      </button>
      <div className="m-group">
        <button className="m-row" onClick={onVerify} disabled={verified !== false}>
          <span className={"m-row-icon" + (verified === false ? " warn" : " ok")}>
            {verified === false ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
          </span>
          <span className="m-row-text">
            <span className="m-row-title">{verified === false ? tr("Сеанс не подтверждён") : tr("Сеанс подтверждён")}</span>
            {verified === false && <span className="m-row-sub">{tr("Подтвердите его, чтобы видеть историю зашифрованных чатов")}</span>}
          </span>
          {verified === false && <ChevronRight size={18} className="m-row-go" />}
        </button>
      </div>
      {groups.map((g, n) => (
        <div key={n} className="m-group">
          {g.map((i, k) => (
            <button key={k} className={"m-row" + (i.danger ? " danger" : "")} onClick={i.onClick}>
              <span className="m-row-icon">{i.icon}</span>
              <span className="m-row-text">
                <span className="m-row-title">{i.label}</span>
              </span>
              {!i.danger && <ChevronRight size={18} className="m-row-go" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
