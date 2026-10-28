// Окно «Переслать»: выбрать один или несколько чатов, по желанию добавить комментарий.
import { useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { Forward, LockKeyholeOpen } from "lucide-react";
import { forwardTargets, forwardTo } from "../forward";
import { matchesText } from "../people";
import { errText } from "../App";
import { RoomAvatar } from "./Avatar";
import { plainText } from "./Message";
import { Modal } from "./ui";
import { tr } from "../i18n";

export default function ForwardDialog({
  client,
  ev,
  onClose,
  onOpenRoom,
}: {
  client: MatrixClient;
  ev: MatrixEvent;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
}) {
  const rooms = useMemo(() => forwardTargets(client), [client]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = client.getRoom(ev.getRoomId() ?? "");
  const sender = src?.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "";
  const shown = rooms.filter((r) => matchesText(r.name, filter));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // зашифрованный файл в открытый чат: ключ файла окажется в открытом сообщении
  const encFile = !!ev.getContent().file || !!ev.replacingEvent()?.getContent()["m.new_content"]?.file;
  const leaks = encFile && picked.some((id) => !client.getRoom(id)?.hasEncryptionStateEvent());

  const submit = async () => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const id of picked) {
      const room = client.getRoom(id);
      if (!room) continue;
      try {
        await forwardTo(client, ev, room, comment);
      } catch (e) {
        failed.push(`${room.name}: ${errText(e)}`);
      }
    }
    if (failed.length) {
      setError(failed.join("\n"));
      setBusy(false);
      return;
    }
    onClose();
    // в один чат — сразу туда, как в Telegram
    if (picked.length === 1) onOpenRoom(picked[0]);
  };

  return (
    <Modal title={tr("Переслать")} icon={<Forward size={18} />} onClose={onClose} busy={busy}>
      <div className="fwd-preview">
        <b>{sender}</b>
        <span>{plainText(ev)}</span>
      </div>
      <input
        className="text-input"
        placeholder={tr("Найти чат")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          // Enter в поиске: единственный найденный чат — сразу выбрать
          if (e.key === "Enter" && shown.length === 1 && !picked.includes(shown[0].roomId)) toggle(shown[0].roomId);
        }}
      />
      <div className="picker-results tall">
        {shown.length === 0 && <div className="picker-empty">{tr("Чатов не найдено")}</div>}
        {shown.map((r) => (
          <label key={r.roomId} className={"picker-row" + (picked.includes(r.roomId) ? " on" : "")}>
            <RoomAvatar client={client} room={r} size={32} />
            <span className="picker-text">
              <span className="picker-name">{r.name}</span>
              <span className="picker-id">
                {r.roomId === src?.roomId ? tr("этот чат") : r.hasEncryptionStateEvent() ? tr("зашифрован") : tr("без шифрования")}
              </span>
            </span>
            <input type="checkbox" checked={picked.includes(r.roomId)} onChange={() => toggle(r.roomId)} />
          </label>
        ))}
      </div>
      {picked.length > 0 && (
        <input
          className="text-input"
          placeholder={tr("Комментарий (необязательно)")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
        />
      )}
      {leaks && (
        <p className="panel-note">
          <LockKeyholeOpen size={13} /> {tr("Файл из зашифрованного чата попадёт в чат без шифрования — сервер сможет его прочитать.")}
        </p>
      )}
      {error && <p className="form-error pre">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={submit} disabled={busy || picked.length === 0}>
          {busy ? tr("Пересылаю…") : picked.length > 1 ? tr("Переслать ({0})", picked.length) : tr("Переслать")}
        </button>
      </div>
    </Modal>
  );
}
