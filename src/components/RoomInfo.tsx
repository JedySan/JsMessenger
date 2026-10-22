import { useEffect, useRef, useState } from "react";
import { EventType, KnownMembership, type MatrixClient, type Room, type RoomMember } from "matrix-js-sdk";
import {
  Ban,
  Camera,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  ShieldPlus,
  ShieldMinus,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { errText } from "../App";
import { leaveRoom, openDirectChat, powerLevelOf, requiredLevel, roleName } from "../rooms";
import Avatar, { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";
import { PopupMenu, Toggle, type MenuItem } from "./ui";
import { locale, tr } from "../i18n";
import { ask, notice } from "./Ask";

type Tab = "members" | "settings";

/** Информация о комнате/пространстве: участники и настройки. */
export default function RoomInfo({
  client,
  room,
  initialTab = "members",
  onClose,
  onOpenRoom,
}: {
  client: MatrixClient;
  room: Room;
  initialTab?: Tab;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="room-info">
      <div className="info-head">
        <div className="info-tabs">
          <button className={tab === "members" ? "on" : ""} onClick={() => setTab("members")}>
            {tr("Участники")}
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            {tr("Настройки")}
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={tr("Закрыть панель")}>
          <X size={18} />
        </button>
      </div>
      {tab === "members" ? (
        <Members client={client} room={room} onOpenRoom={onOpenRoom} />
      ) : (
        <Settings client={client} room={room} onLeft={onClose} />
      )}
    </div>
  );
}

// ---------- участники ----------
function Members({ client, room, onOpenRoom }: { client: MatrixClient; room: Room; onOpenRoom: (id: string) => void }) {
  const me = client.getSafeUserId();
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; m: RoomMember } | null>(null);
  const myLevel = powerLevelOf(room, me);
  const f = filter.trim().toLowerCase();
  const match = (m: RoomMember) => !f || m.name.toLowerCase().includes(f) || m.userId.toLowerCase().includes(f);
  const byLevel = (a: RoomMember, b: RoomMember) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name, locale);
  const all = room.getMembers();
  const joined = all.filter((m) => m.membership === KnownMembership.Join && match(m)).sort(byLevel);
  const invited = all.filter((m) => m.membership === KnownMembership.Invite && match(m)).sort(byLevel);
  const banned = all.filter((m) => m.membership === KnownMembership.Ban && match(m));
  const canInvite = myLevel >= requiredLevel(room, "invite");

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notice(errText(e));
    }
  };

  const menuItems = (m: RoomMember): MenuItem[] => {
    const other = m.userId !== me;
    const higher = myLevel > m.powerLevel;
    const canKick = other && higher && myLevel >= requiredLevel(room, "kick");
    const canBan = other && higher && myLevel >= requiredLevel(room, "ban");
    const canPower = other && higher && room.currentState.maySendStateEvent(EventType.RoomPowerLevels, me);
    const invitedM = m.membership === KnownMembership.Invite;
    const bannedM = m.membership === KnownMembership.Ban;
    return [
      {
        label: tr("Написать лично"),
        icon: <MessageSquare size={15} />,
        hidden: !other,
        onClick: () => act(async () => onOpenRoom(await openDirectChat(client, m.userId))),
      },
      {
        label: tr("Сделать модератором"),
        icon: <ShieldPlus size={15} />,
        hidden: !canPower || m.powerLevel >= 50 || bannedM || myLevel < 50,
        onClick: () => act(() => client.setPowerLevel(room.roomId, m.userId, 50)),
      },
      {
        label: tr("Сделать администратором"),
        icon: <ShieldCheck size={15} />,
        hidden: !canPower || m.powerLevel >= 100 || bannedM || myLevel < 100,
        onClick: () =>
          void ask(tr("{0} получит те же права, что и вы, и забрать их будет нельзя. Продолжить?", m.name)).then(
            (ok): unknown => ok && act(() => client.setPowerLevel(room.roomId, m.userId, 100)),
          ),
      },
      {
        label: tr("Снять роль"),
        icon: <ShieldMinus size={15} />,
        hidden: !canPower || m.powerLevel <= 0,
        onClick: () => act(() => client.setPowerLevel(room.roomId, m.userId, undefined)),
      },
      {
        label: invitedM ? tr("Отозвать приглашение") : tr("Удалить из комнаты"),
        icon: <UserMinus size={15} />,
        danger: true,
        hidden: !canKick || bannedM,
        onClick: () =>
          void ask(invitedM ? tr("Отозвать приглашение для {0}?", m.name) : tr("Удалить {0} из «{1}»?", m.name, room.name), {
            ok: invitedM ? tr("Отозвать") : tr("Удалить"),
            danger: true,
          }).then((ok): unknown => ok && act(() => client.kick(room.roomId, m.userId))),
      },
      {
        label: tr("Заблокировать"),
        icon: <Ban size={15} />,
        danger: true,
        hidden: !canBan || bannedM,
        onClick: () =>
          void ask(tr("Заблокировать {0}? Он не сможет вернуться, пока его не разблокируют.", m.name), {
            ok: tr("Заблокировать"),
            danger: true,
          }).then((ok): unknown => ok && act(() => client.ban(room.roomId, m.userId))),
      },
      {
        label: tr("Разблокировать"),
        icon: <ShieldCheck size={15} />,
        hidden: !bannedM || myLevel < requiredLevel(room, "ban"),
        onClick: () => act(() => client.unban(room.roomId, m.userId)),
      },
    ];
  };

  const row = (m: RoomMember) => {
    const role = roleName(m.powerLevel);
    const items = menuItems(m).filter((i) => !i.hidden);
    return (
      <div key={m.userId} className="member-row">
        <button className="member-open" onClick={() => openDialog({ kind: "user", userId: m.userId })} title={tr("Карточка")}>
          <Avatar client={client} mxc={m.getMxcAvatarUrl()} name={m.name} seed={m.userId} size={32} />
        </button>
        <div className="member-text member-open" role="button" tabIndex={0} onClick={() => openDialog({ kind: "user", userId: m.userId })}>
          <div className="member-name">
            {m.name}
            {m.userId === me && <span className="member-you"> {tr("(вы)")}</span>}
          </div>
          <div className="member-id">{m.userId}</div>
        </div>
        {role && <span className={"role-tag" + (m.powerLevel >= 100 ? " admin" : "")}>{role}</span>}
        {items.length > 0 && (
          <button
            className="icon-btn small"
            onClick={(e) => setMenu({ x: e.clientX - 200, y: e.clientY + 8, m })}
            aria-label={tr("Действия с {0}", m.name)}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="info-body">
      <div className="members-top">
        <label className="search">
          <Search size={15} />
          <input placeholder={tr("Найти участника")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {canInvite && (
          <button
            className="icon-btn"
            onClick={() => openDialog({ kind: "invite", roomId: room.roomId })}
            title={tr("Пригласить")}
            aria-label={tr("Пригласить")}
          >
            <UserPlus size={18} />
          </button>
        )}
      </div>
      <div className="info-section">{tr("Участники ({0})", joined.length)}</div>
      {joined.map(row)}
      {invited.length > 0 && <div className="info-section">{tr("Приглашены ({0})", invited.length)}</div>}
      {invited.map(row)}
      {banned.length > 0 && <div className="info-section">{tr("Заблокированы ({0})", banned.length)}</div>}
      {banned.map(row)}
      {menu && <PopupMenu x={menu.x} y={menu.y} items={menuItems(menu.m)} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ---------- настройки ----------
function Settings({ client, room, onLeft }: { client: MatrixClient; room: Room; onLeft: () => void }) {
  const me = client.getSafeUserId();
  const may = (type: string) => room.currentState.maySendStateEvent(type, me);
  const [name, setName] = useState(room.name);
  const [topic, setTopic] = useState(room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isSpace = room.isSpaceRoom();

  useEffect(() => setSaved(false), [name, topic]);

  const joinRuleEv = room.currentState.getStateEvents(EventType.RoomJoinRules, "")?.getContent() ?? {};
  const joinRule: string = joinRuleEv.join_rule ?? "invite";
  const parents = room.currentState.getStateEvents("m.space.parent").filter((e) => e.getContent().via);
  const parentId = parents[0]?.getStateKey();
  const history: string =
    room.currentState.getStateEvents(EventType.RoomHistoryVisibility, "")?.getContent().history_visibility ?? "shared";
  const encrypted = room.hasEncryptionStateEvent();

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notice(errText(e));
    }
  };

  const saveText = async () => {
    setSaving(true);
    try {
      if (name.trim() && name.trim() !== room.name) await client.setRoomName(room.roomId, name.trim());
      const oldTopic = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic ?? "";
      if (topic !== oldTopic) await client.setRoomTopic(room.roomId, topic);
      setSaved(true);
    } catch (e) {
      notice(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const setAvatar = async (file: File) => {
    await run(async () => {
      const up = await client.uploadContent(file, { type: file.type, name: file.name });
      await client.sendStateEvent(room.roomId, EventType.RoomAvatar, { url: up.content_uri } as never, "");
    });
  };

  const setJoinRule = (rule: string) =>
    run(() =>
      client.sendStateEvent(
        room.roomId,
        EventType.RoomJoinRules,
        (rule === "restricted" && parentId
          ? { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: parentId }] }
          : { join_rule: rule }) as never,
        "",
      ),
    );

  const changed = name.trim() !== room.name || topic !== (room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic ?? "");

  return (
    <div className="info-body settings">
      <div className="settings-avatar">
        <RoomAvatar client={client} room={room} size={72} />
        {may(EventType.RoomAvatar) && (
          <>
            <button className="pill" onClick={() => fileRef.current?.click()}>
              <Camera size={15} />
              {tr("Сменить аватар")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setAvatar(f);
              }}
            />
          </>
        )}
      </div>

      <label className="field">
        <span>{tr("Название")}</span>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!may(EventType.RoomName)} />
      </label>
      <label className="field">
        <span>{tr("Тема")}</span>
        <textarea
          className="text-input"
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={!may(EventType.RoomTopic)}
        />
      </label>
      {(may(EventType.RoomName) || may(EventType.RoomTopic)) && (
        <div className="row-end">
          {saved && <span className="saved-note">{tr("Сохранено")}</span>}
          <button className="primary" onClick={saveText} disabled={saving || !changed}>
            {saving ? tr("Сохраняю…") : tr("Сохранить")}
          </button>
        </div>
      )}

      <div className="field">
        <span>{tr("Кто может вступить")}</span>
        <select
          className="text-input"
          value={joinRule}
          onChange={(e) => setJoinRule(e.target.value)}
          disabled={!may(EventType.RoomJoinRules)}
        >
          <option value="invite">{tr("Только по приглашению")}</option>
          {parentId && <option value="restricted">{client.getRoom(parentId) ? tr("Участники пространства «{0}»", client.getRoom(parentId)!.name) : tr("Участники родительского пространства")}</option>}
          <option value="public">{tr("Все на сервере")}</option>
          {joinRule === "knock" && <option value="knock">{tr("По запросу")}</option>}
        </select>
      </div>

      {!isSpace && (
        <div className="field">
          <span>{tr("Кто видит историю")}</span>
          <select
            className="text-input"
            value={history}
            onChange={(e) =>
              run(() =>
                client.sendStateEvent(room.roomId, EventType.RoomHistoryVisibility, { history_visibility: e.target.value } as never, ""),
              )
            }
            disabled={!may(EventType.RoomHistoryVisibility)}
          >
            <option value="shared">{tr("Все участники, включая новых")}</option>
            <option value="invited">{tr("Участники с момента приглашения")}</option>
            <option value="joined">{tr("Участники с момента вступления")}</option>
            <option value="world_readable">{tr("Кто угодно")}</option>
          </select>
        </div>
      )}

      {!isSpace && (
        <Toggle
          checked={encrypted}
          onChange={(v) => {
            if (!v || encrypted) return;
            void ask(tr("Включить шифрование? Отключить его потом будет нельзя, а боты без поддержки шифрования перестанут видеть сообщения."), {
              ok: tr("Включить"),
            }).then(
              (ok): unknown =>
                ok &&
                run(() =>
                  client.sendStateEvent(room.roomId, EventType.RoomEncryption, { algorithm: "m.megolm.v1.aes-sha2" } as never, ""),
                ),
            );
          }}
          label={tr("Сквозное шифрование")}
          hint={encrypted ? tr("Включено. Отключить нельзя") : tr("Выключено")}
        />
      )}

      <div className="settings-meta">
        <span>ID: {room.roomId}</span>
        {room.getCanonicalAlias() && <span>{tr("Адрес:")} {room.getCanonicalAlias()}</span>}
      </div>

      <button
        className="leave-btn"
        onClick={() =>
          void ask(isSpace ? tr("Покинуть пространство «{0}»? Комнаты в нём останутся.", room.name) : tr("Покинуть «{0}»?", room.name), {
            ok: tr("Покинуть"),
            danger: true,
          }).then(
            (ok): unknown =>
              ok &&
              run(async () => {
                await leaveRoom(client, room);
                onLeft();
              }),
          )
        }
      >
        <LogOut size={15} />
        {isSpace ? tr("Покинуть пространство") : tr("Покинуть комнату")}
      </button>
    </div>
  );
}
