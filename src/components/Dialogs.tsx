import { useState } from "react";
import { KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk";
import { Hash, LayoutGrid, MessageSquarePlus, UserPlus } from "lucide-react";
import { errText } from "../App";
import { addToSpace, createRoom, createSpace, openDirectChat, roomIdsInSpace, spaceChildren } from "../rooms";
import { RoomAvatar } from "./Avatar";
import { Modal, Toggle, UserPicker, type PickedUser } from "./ui";
import { locale, tr } from "../i18n";

// ---------- новая комната или пространство ----------
export function CreateRoomDialog({
  client,
  kind,
  spaceId,
  onClose,
  onCreated,
}: {
  client: MatrixClient;
  kind: "room" | "space";
  spaceId?: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const space = spaceId ? client.getRoom(spaceId) : null;
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [encrypted, setEncrypted] = useState(true);
  const [access, setAccess] = useState<"invite" | "space" | "public">(space ? "space" : "invite");
  const [invite, setInvite] = useState<PickedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSpace = kind === "space";

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let id: string;
      if (isSpace) {
        id = await createSpace(client, { name: name.trim(), topic, isPublic: access === "public", parentId: spaceId });
        for (const u of invite) await client.invite(id, u.userId).catch(() => {});
      } else {
        id = await createRoom(client, {
          name: name.trim(),
          topic,
          encrypted,
          access,
          spaceId,
          invite: invite.map((u) => u.userId),
        });
      }
      onCreated(id);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const title = isSpace ? (space ? tr("Новое пространство в «{0}»", space.name) : tr("Новое пространство")) : space ? tr("Новая комната в «{0}»", space.name) : tr("Новая комната");

  return (
    <Modal title={title} icon={isSpace ? <LayoutGrid size={18} /> : <Hash size={18} />} onClose={onClose} busy={busy}>
      <label className="field">
        <span>{tr("Название")}</span>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isSpace ? tr("Например, Отдел ИТ") : tr("Например, Инфраструктура")}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      <label className="field">
        <span>{tr("Тема (необязательно)")}</span>
        <input className="text-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={tr("О чём здесь общаются")} />
      </label>

      <div className="field">
        <span>{tr("Кто может вступить")}</span>
        <div className="segmented">
          <button className={access === "invite" ? "on" : ""} onClick={() => setAccess("invite")}>
            {tr("По приглашению")}
          </button>
          {space && (
            <button className={access === "space" ? "on" : ""} onClick={() => setAccess("space")} disabled={isSpace}>
              {tr("Участники пространства")}
            </button>
          )}
          <button className={access === "public" ? "on" : ""} onClick={() => setAccess("public")}>
            {tr("Все на сервере")}
          </button>
        </div>
      </div>

      {!isSpace && (
        <Toggle
          checked={encrypted}
          onChange={setEncrypted}
          label={tr("Сквозное шифрование")}
          hint={encrypted ? tr("Отключить потом будет нельзя") : tr("Сообщения хранятся на сервере в открытом виде")}
        />
      )}

      <div className="field">
        <span>{tr("Пригласить сразу (необязательно)")}</span>
        <UserPicker client={client} selected={invite} onChange={setInvite} autoFocus={false} />
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={submit} disabled={busy || !name.trim()}>
          {busy ? tr("Создаю…") : tr("Создать")}
        </button>
      </div>
    </Modal>
  );
}

// ---------- личный чат ----------
export function StartChatDialog({
  client,
  onClose,
  onOpened,
}: {
  client: MatrixClient;
  onClose: () => void;
  onOpened: (roomId: string) => void;
}) {
  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (u: PickedUser) => {
    setBusy(true);
    setError(null);
    try {
      onOpened(await openDirectChat(client, u.userId));
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={tr("Новый личный чат")} icon={<MessageSquarePlus size={18} />} onClose={onClose} busy={busy}>
      <UserPicker
        client={client}
        selected={picked}
        multiple={false}
        onChange={(u) => {
          setPicked(u);
          if (u[0]) start(u[0]);
        }}
      />
      {busy && <p className="modal-progress">{tr("Открываю чат…")}</p>}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

// ---------- приглашение ----------
export function InviteDialog({ client, room, onClose }: { client: MatrixClient; room: Room; onClose: () => void }) {
  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const already = room
    .getMembers()
    .filter((m) => m.membership === KnownMembership.Join || m.membership === KnownMembership.Invite)
    .map((m) => m.userId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const u of picked) {
      try {
        await client.invite(room.roomId, u.userId);
      } catch (e) {
        failed.push(`${u.name}: ${errText(e)}`);
      }
    }
    if (failed.length) {
      setError(failed.join("\n"));
      setBusy(false);
    } else onClose();
  };

  return (
    <Modal title={tr("Пригласить в «{0}»", room.name)} icon={<UserPlus size={18} />} onClose={onClose} busy={busy}>
      <UserPicker client={client} selected={picked} onChange={setPicked} exclude={already} />
      {error && <p className="form-error pre">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={submit} disabled={busy || picked.length === 0}>
          {busy ? tr("Приглашаю…") : picked.length > 1 ? tr("Пригласить ({0})", picked.length) : tr("Пригласить")}
        </button>
      </div>
    </Modal>
  );
}

// ---------- добавить существующие комнаты в пространство ----------
export function AddExistingDialog({ client, space, onClose }: { client: MatrixClient; space: Room; onClose: () => void }) {
  const inSpace = new Set([...spaceChildren(space), ...roomIdsInSpace(client, space.roomId)]);
  const candidates = client
    .getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Join && r.roomId !== space.roomId && !inSpace.has(r.roomId))
    .sort((a, b) => Number(b.isSpaceRoom()) - Number(a.isSpaceRoom()) || a.name.localeCompare(b.name, locale));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      for (const id of picked) await addToSpace(client, space.roomId, id);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const shown = candidates.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Modal title={tr("Добавить в «{0}»", space.name)} icon={<LayoutGrid size={18} />} onClose={onClose} busy={busy}>
      <input className="text-input" placeholder={tr("Фильтр по названию")} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      <div className="picker-results tall">
        {shown.length === 0 && <div className="picker-empty">{tr("Нет комнат, которые можно добавить")}</div>}
        {shown.map((r) => (
          <label key={r.roomId} className={"picker-row" + (picked.has(r.roomId) ? " on" : "")}>
            <RoomAvatar client={client} room={r} size={32} />
            <span className="picker-text">
              <span className="picker-name">{r.name}</span>
              <span className="picker-id">{r.isSpaceRoom() ? tr("Пространство") : tr("{0} участн.", r.getJoinedMemberCount())}</span>
            </span>
            <input
              type="checkbox"
              checked={picked.has(r.roomId)}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(r.roomId)) n.delete(r.roomId);
                  else n.add(r.roomId);
                  return n;
                })
              }
            />
          </label>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={submit} disabled={busy || picked.size === 0}>
          {busy ? tr("Добавляю…") : picked.size ? tr("Добавить ({0})", picked.size) : tr("Добавить")}
        </button>
      </div>
    </Modal>
  );
}
