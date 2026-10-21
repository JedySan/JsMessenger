import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { FileText, LockKeyhole, X } from "lucide-react";
import { formatSize, sendFile } from "../attachments";
import { errText } from "../App";
import { tr } from "../i18n";

/** Предпросмотр и отправка выбранных, вставленных или перетащенных файлов. */
export default function UploadDialog({
  client,
  room,
  files,
  replyTo,
  threadId,
  onClose,
  onRemove,
}: {
  client: MatrixClient;
  room: Room;
  files: File[];
  replyTo?: MatrixEvent;
  threadId?: string;
  onClose: (sent: boolean) => void;
  onRemove: (i: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose(false);
      if (e.key === "Enter" && !busy) send();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = files.reduce((s, f) => s + f.size, 0);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress({ index: i, pct: 0 });
        await sendFile(
          client,
          room,
          files[i],
          (loaded, all) => setProgress({ index: i, pct: all ? Math.round((loaded / all) * 100) : 0 }),
          relationFor(i === 0 ? replyTo?.getId() : undefined, threadId, lastThreadEvent(room, threadId)),
        );
      }
      onClose(true);
    } catch (e) {
      setError(tr("Не удалось отправить «{0}»: {1}", files[progress?.index ?? 0]?.name, errText(e)));
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={busy ? undefined : () => onClose(false)}>
      <div className="card modal upload" onClick={(e) => e.stopPropagation()}>
        <h2>
          {files.length === 1 ? tr("Отправить файл") : tr("Отправить файлы: {0}", files.length)}
          <span className="upload-total">{formatSize(total)}</span>
        </h2>
        <div className="upload-list">
          {files.map((f, i) => (
            <div key={i} className="upload-item">
              {previews[i] ? (
                <img src={previews[i]!} alt="" />
              ) : (
                <span className="upload-icon">
                  <FileText size={20} />
                </span>
              )}
              <div className="upload-text">
                <div className="upload-name">{f.name}</div>
                <div className="upload-size">
                  {progress && progress.index === i
                    ? tr("Загружаю… {0}%", progress.pct)
                    : progress && progress.index > i
                      ? tr("Отправлено")
                      : formatSize(f.size)}
                </div>
                {progress?.index === i && (
                  <div className="progress">
                    <div style={{ width: `${progress.pct}%` }} />
                  </div>
                )}
              </div>
              {!busy && (
                <button className="icon-btn small" onClick={() => onRemove(i)} title={tr("Убрать")} aria-label={tr("Убрать")}>
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        {room.hasEncryptionStateEvent() && (
          <p className="modal-text small-note">
            <LockKeyhole size={12} /> {tr("Файлы будут зашифрованы перед отправкой")}
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="ghost" onClick={() => onClose(false)} disabled={busy}>
            {tr("Отмена")}
          </button>
          <button className="primary" onClick={send} disabled={busy || files.length === 0}>
            {busy ? tr("Отправляю…") : tr("Отправить")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** m.relates_to для вложения: ответ, тред или ничего. */
export function relationFor(replyTo?: string, threadId?: string, lastInThread?: string): Record<string, unknown> | undefined {
  if (threadId) {
    return {
      rel_type: "m.thread",
      event_id: threadId,
      is_falling_back: !replyTo,
      "m.in_reply_to": { event_id: replyTo ?? lastInThread ?? threadId },
    };
  }
  return replyTo ? { "m.in_reply_to": { event_id: replyTo } } : undefined;
}

function lastThreadEvent(room: Room, threadId?: string): string | undefined {
  if (!threadId) return undefined;
  return room.getThread(threadId)?.lastReply()?.getId() ?? undefined;
}
