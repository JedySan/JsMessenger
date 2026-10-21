import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Paperclip, Pencil, Reply, SendHorizontal, X } from "lucide-react";
import { errText } from "../App";
import { nameForPasted } from "../attachments";
import { textToContent } from "../richtext";
import { effectiveContent, plainText } from "./Message";
import { relationFor } from "./UploadDialog";
import { tr } from "../i18n";

const PASTE_KEY = window.jsmDesktop && window.jsmDesktop.platform !== "darwin" ? "Ctrl+V" : "⌘V";

export type ComposerMode = { kind: "normal" } | { kind: "reply"; ev: MatrixEvent } | { kind: "edit"; ev: MatrixEvent };

export default function Composer({
  client,
  room,
  mode,
  setMode,
  onFiles,
  onSent,
  onEditLast,
  threadId,
  placeholder,
}: {
  client: MatrixClient;
  room: Room;
  mode: ComposerMode;
  setMode: (m: ComposerMode) => void;
  onFiles: (files: File[]) => void;
  onSent: () => void;
  onEditLast: () => void;
  /** Если задан — сообщения уходят в этот тред */
  threadId?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const draftBeforeEdit = useRef("");

  useEffect(() => ref.current?.focus(), [room.roomId, mode]);

  // При входе в режим правки подставляем текст сообщения
  useEffect(() => {
    if (mode.kind === "edit") {
      draftBeforeEdit.current = text;
      setText(String(effectiveContent(mode.ev).body ?? ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stopTyping = () => {
    if (typingSent.current) {
      typingSent.current = 0;
      client.sendTyping(room.roomId, false, 0).catch(() => {});
    }
  };
  useEffect(() => stopTyping, [room.roomId]);

  const onChange = (v: string) => {
    setText(v);
    // «печатает…» — не чаще раза в 4 секунды
    const now = Date.now();
    if (v && now - typingSent.current > 4000) {
      typingSent.current = now;
      client.sendTyping(room.roomId, true, 6000).catch(() => {});
    } else if (!v) stopTyping();
  };

  const cancelMode = () => {
    if (mode.kind === "edit") setText(draftBeforeEdit.current);
    setMode({ kind: "normal" });
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const current = mode;
    setText(current.kind === "edit" ? draftBeforeEdit.current : "");
    setMode({ kind: "normal" });
    stopTyping();
    onSent();
    try {
      const formatted = textToContent(body);
      if (current.kind === "edit") {
        const old = effectiveContent(current.ev);
        if (old.body === body) return;
        const msgtype = old.msgtype ?? MsgType.Text;
        await client.sendMessage(room.roomId, {
          msgtype,
          body: `* ${body}`,
          ...(formatted.formatted_body
            ? { format: formatted.format, formatted_body: `* ${formatted.formatted_body}` }
            : {}),
          "m.new_content": { msgtype, ...formatted },
          "m.relates_to": { rel_type: "m.replace", event_id: current.ev.getId()! },
        } as any);
      } else {
        const content: Record<string, any> = { msgtype: MsgType.Text, ...formatted };
        const rel = relationFor(
          current.kind === "reply" ? current.ev.getId()! : undefined,
          threadId,
          threadId ? (room.getThread(threadId)?.lastReply()?.getId() ?? undefined) : undefined,
        );
        if (rel) content["m.relates_to"] = rel;
        await client.sendMessage(room.roomId, content as any);
      }
    } catch (e) {
      alert(tr("Сообщение не отправлено: ") + errText(e));
      setText(body);
      setMode(current);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // Enter — отправить, Shift+Enter — новая строка
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && mode.kind !== "normal") {
      e.preventDefault();
      cancelMode();
    } else if (e.key === "ArrowUp" && !text && mode.kind === "normal") {
      // Стрелка вверх в пустом поле — править своё последнее сообщение, как в Element
      e.preventDefault();
      onEditLast();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      onFiles(files.map(nameForPasted));
    }
  };

  const target = mode.kind !== "normal" ? mode.ev : null;
  const targetName = target ? (room.getMember(target.getSender() ?? "")?.name ?? target.getSender()) : "";

  return (
    <div className="composer">
      {target && (
        <div className="composer-context">
          {mode.kind === "reply" ? <Reply size={15} /> : <Pencil size={14} />}
          <div className="ctx-text">
            <div className="ctx-title">{mode.kind === "reply" ? tr("В ответ: {0}", targetName) : tr("Редактирование сообщения")}</div>
            <div className="ctx-body">{plainText(target)}</div>
          </div>
          <button className="icon-btn small" onClick={cancelMode} title={tr("Отменить (Esc)")} aria-label={tr("Отменить")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="composer-box">
        <button
          className="attach-btn"
          onClick={() => fileInput.current?.click()}
          title={tr("Прикрепить файл")}
          aria-label={tr("Прикрепить файл")}
          disabled={mode.kind === "edit"}
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={mode.kind === "edit" ? tr("Новый текст сообщения") : (placeholder ?? tr("Сообщение для «{0}»", room.name))}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={stopTyping}
        />
        <button className="send-btn" onClick={send} disabled={!text.trim()} title={tr("Отправить (Enter)")} aria-label={tr("Отправить")}>
          <SendHorizontal size={18} />
        </button>
      </div>
      <div className="composer-hint">
        {tr("**жирный**, _курсив_, `код`, Shift+Enter — новая строка,")} {PASTE_KEY} {tr("— вставить скриншот")}
      </div>
    </div>
  );
}
