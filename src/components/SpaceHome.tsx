import { useCallback, useEffect, useState } from "react";
import { KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk";
import type { IHierarchyRoom } from "matrix-js-sdk/lib/@types/spaces";
import { ChevronLeft, FolderPlus, Hash, LayoutGrid, LoaderCircle, Plus, Settings, UserPlus, Users, X } from "lucide-react";
import { errText } from "../App";
import { removeFromSpace } from "../rooms";
import Avatar, { RoomAvatar } from "./Avatar";
import { openDialog } from "./DialogHost";
import { PopupMenu } from "./ui";
import { plural } from "../i18n";
import { tr } from "../i18n";
import { ask, notice } from "./Ask";

/** Главная страница пространства: описание, действия и каталог комнат. */
export default function SpaceHome({
  client,
  space,
  onOpenRoom,
  onOpenSpace,
  onBack,
}: {
  client: MatrixClient;
  space: Room;
  onOpenRoom: (roomId: string) => void;
  onOpenSpace: (spaceId: string) => void;
  /** телефон: назад к списку */
  onBack?: () => void;
}) {
  const me = client.getSafeUserId();
  const [rooms, setRooms] = useState<IHierarchyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  // меняется, когда в пространстве добавляют/убирают комнаты
  const childKey = space.currentState
    .getStateEvents("m.space.child")
    .map((e) => e.getStateKey() + JSON.stringify(e.getContent()))
    .join("|");

  const load = useCallback(async () => {
    setError(null);
    try {
      const all: IHierarchyRoom[] = [];
      let from: string | undefined;
      // каталог может быть большим — забираем постранично
      for (let i = 0; i < 10; i++) {
        const res = await client.getRoomHierarchy(space.roomId, 100, 3, false, from);
        all.push(...res.rooms);
        if (!res.next_batch) break;
        from = res.next_batch;
      }
      setRooms(all);
    } catch (e) {
      setError(errText(e));
    }
  }, [client, space.roomId]);

  useEffect(() => {
    load();
  }, [load, childKey]);

  const topic = space.currentState.getStateEvents("m.room.topic", "")?.getContent().topic as string | undefined;
  const canManage = space.currentState.maySendStateEvent("m.space.child", me);
  const canInvite = space.canInvite(me);

  const byId = new Map((rooms ?? []).map((r) => [r.room_id, r]));
  const childrenOf = (id: string) =>
    (byId.get(id)?.children_state ?? [])
      .map((c) => c.state_key)
      .filter((cid) => byId.has(cid));

  const join = async (r: IHierarchyRoom, parentId: string) => {
    setJoining(r.room_id);
    try {
      const parent = byId.get(parentId);
      const via = parent?.children_state.find((c) => c.state_key === r.room_id)?.content?.via as string[] | undefined;
      await client.joinRoom(r.room_id, { viaServers: via });
      if (r.room_type === "m.space") onOpenSpace(r.room_id);
      else onOpenRoom(r.room_id);
    } catch (e) {
      notice(errText(e));
    } finally {
      setJoining(null);
    }
  };

  const renderItem = (r: IHierarchyRoom, parentId: string) => {
    const local = client.getRoom(r.room_id);
    const joined = local?.getMyMembership() === KnownMembership.Join;
    const invited = local?.getMyMembership() === KnownMembership.Invite;
    const isSpace = r.room_type === "m.space";
    const name = r.name || r.canonical_alias || (local?.name ?? tr("Без названия"));
    return (
      <div key={r.room_id} className="dir-item">
        {local ? (
          <RoomAvatar client={client} room={local} size={38} />
        ) : (
          <Avatar client={client} mxc={r.avatar_url} name={name} seed={r.room_id} size={38} />
        )}
        <div className="dir-text">
          <div className="dir-name">
            {isSpace ? <LayoutGrid size={13} /> : <Hash size={13} />}
            {name}
          </div>
          <div className="dir-meta">
            {r.topic ? <span className="dir-topic">{r.topic}</span> : null}
            <span>
              {r.num_joined_members} {plural(r.num_joined_members, "участник", "участника", "участников")}
            </span>
          </div>
        </div>
        {joined ? (
          <button className="pill" onClick={() => (isSpace ? onOpenSpace(r.room_id) : onOpenRoom(r.room_id))}>
            {tr("Открыть")}
          </button>
        ) : (
          <button className="pill join" onClick={() => join(r, parentId)} disabled={joining === r.room_id}>
            {joining === r.room_id ? <LoaderCircle size={14} className="spin" /> : null}
            {invited ? tr("Принять") : tr("Вступить")}
          </button>
        )}
        {canManage && parentId === space.roomId && (
          <button
            className="icon-btn small"
            title={tr("Убрать из пространства")}
            aria-label={tr("Убрать из пространства")}
            onClick={() =>
              void ask(tr("Убрать «{0}» из пространства? Сама комната останется.", name), { ok: tr("Убрать") }).then(
                (ok): unknown => ok && removeFromSpace(client, space.roomId, r.room_id).catch((e) => notice(errText(e))),
              )
            }
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  };

  const top = childrenOf(space.roomId);
  const topRooms = top.filter((id) => byId.get(id)?.room_type !== "m.space");
  const subSpaces = top.filter((id) => byId.get(id)?.room_type === "m.space");

  return (
    <div className="space-home">
      <div className="titlebar" data-tauri-drag-region />
      {onBack && (
        <button className="icon-btn back-btn space-back" onClick={onBack} title={tr("К списку")} aria-label={tr("К списку")}>
          <ChevronLeft size={22} />
        </button>
      )}
      <div className="space-home-inner">
        <header className="space-hero">
          <RoomAvatar client={client} room={space} size={64} />
          <div className="space-hero-text">
            <h1>{space.name}</h1>
            {topic && <p>{topic}</p>}
            <div className="space-hero-meta">
              <Users size={13} />
              {space.getJoinedMemberCount()} {plural(space.getJoinedMemberCount(), "участник", "участника", "участников")}
            </div>
          </div>
        </header>

        <div className="space-actions">
          {canInvite && (
            <button className="pill" onClick={() => openDialog({ kind: "invite", roomId: space.roomId })}>
              <UserPlus size={15} />
              {tr("Пригласить")}
            </button>
          )}
          {canManage && (
            <button className="pill" onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY + 10 })}>
              <Plus size={15} />
              {tr("Добавить")}
            </button>
          )}
          <button className="pill" onClick={() => openDialog({ kind: "spaceSettings", spaceId: space.roomId, tab: "members" })}>
            <Users size={15} />
            {tr("Участники")}
          </button>
          <button className="pill" onClick={() => openDialog({ kind: "spaceSettings", spaceId: space.roomId, tab: "settings" })}>
            <Settings size={15} />
            {tr("Настройки")}
          </button>
        </div>

        {error && <p className="form-error left">{tr("Не удалось загрузить список комнат:")} {error}</p>}
        {!rooms && !error && (
          <div className="verify-wait">
            <LoaderCircle size={20} className="spin" /> {tr("Загружаю комнаты…")}
          </div>
        )}

        {rooms && (
          <>
            <h2 className="dir-heading">{tr("Комнаты")}</h2>
            {topRooms.length === 0 && (
              <p className="dir-empty">
                {tr("В пространстве пока нет комнат.")}
                {canManage && tr(" Нажмите «Добавить», чтобы создать новую или добавить существующую.")}
              </p>
            )}
            <div className="dir-list">{topRooms.map((id) => renderItem(byId.get(id)!, space.roomId))}</div>

            {subSpaces.map((sid) => {
              const sub = byId.get(sid)!;
              const kids = childrenOf(sid);
              return (
                <section key={sid} className="dir-sub">
                  <div className="dir-list">{renderItem(sub, space.roomId)}</div>
                  {kids.length > 0 && <div className="dir-list nested">{kids.map((id) => renderItem(byId.get(id)!, sid))}</div>}
                </section>
              );
            })}
          </>
        )}
      </div>

      {addMenu && (
        <PopupMenu
          x={addMenu.x}
          y={addMenu.y}
          onClose={() => setAddMenu(null)}
          items={[
            { label: tr("Новая комната"), icon: <Hash size={15} />, onClick: () => openDialog({ kind: "createRoom", spaceId: space.roomId }) },
            {
              label: tr("Существующие комнаты"),
              icon: <FolderPlus size={15} />,
              onClick: () => openDialog({ kind: "addExisting", spaceId: space.roomId }),
            },
            {
              label: tr("Вложенное пространство"),
              icon: <LayoutGrid size={15} />,
              onClick: () => openDialog({ kind: "createSpace", parentId: space.roomId }),
            },
          ]}
        />
      )}
    </div>
  );
}

