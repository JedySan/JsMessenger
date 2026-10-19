import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Ban, Check, CheckCheck, Circle, CircleAlert, Copy, Lock, MessagesSquare, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from "lucide-react";
import { listTime, stripReplyFallback, timeHM } from "../format";
import { htmlToText, linkify, sanitizeMessageHtml } from "../richtext";
import { openExternal } from "../widgets";
import { flashEvent, requestJump } from "../jump";
import Avatar from "./Avatar";
import type { SendStatus } from "../receipts";
import { openDialog } from "./DialogHost";
import { AudioMessage, FileMessage, ImageMessage, VideoMessage } from "./Media";

export interface MessageActions {
  onReply: (ev: MatrixEvent) => void;
  onEdit: (ev: MatrixEvent) => void;
  /** Открыть тред с этим сообщением в корне; нет — значит, мы уже внутри треда */
  onThread?: (ev: MatrixEvent) => void;
}

export const PINNED = "m.room.pinned_events";
export function pinnedIds(room: Room): string[] {
  const ids = room.currentState.getStateEvents(PINNED, "")?.getContent().pinned;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}
export async function togglePin(client: MatrixClient, room: Room, eventId: string) {
  const ids = pinnedIds(room);
  const next = ids.includes(eventId) ? ids.filter((x) => x !== eventId) : [...ids, eventId];
  await client.sendStateEvent(room.roomId, PINNED as never, { pinned: next } as never, "");
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅"];
const MORE_REACTIONS = [
  "👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "😡", "🎉", "🙏", "👏", "💪",
  "✅", "❌", "⚠️", "👀", "🤝", "🚀", "💯", "🤔", "😅", "😎", "🙈", "🥳",
  "☕", "🍕", "📌", "📎", "🐛", "🛠️", "⏳", "🆗",
];

/** Текущее содержимое с учётом правок. */
export function effectiveContent(ev: MatrixEvent): Record<string, any> {
  return ev.replacingEvent()?.getContent()["m.new_content"] ?? ev.getContent();
}

/** Короткий текст сообщения — для цитат и копирования. */
export function plainText(ev: MatrixEvent): string {
  if (ev.isRedacted()) return "Сообщение удалено";
  const c = effectiveContent(ev);
  switch (c.msgtype) {
    case MsgType.Image:
      return "Фото";
    case MsgType.Video:
      return "Видео";
    case MsgType.Audio:
      return "Аудио";
    case MsgType.File:
      return `Файл: ${c.body ?? ""}`;
  }
  if (c.format === "org.matrix.custom.html" && c.formatted_body) return htmlToText(c.formatted_body);
  return stripReplyFallback(String(c.body ?? ""));
}

export default function Message({
  client,
  room,
  ev,
  prev,
  actions,
  status,
  readers,
}: {
  client: MatrixClient;
  room: Room;
  ev: MatrixEvent;
  prev?: MatrixEvent;
  actions: MessageActions;
  /** для своих сообщений: отправляется / доставлено / прочитано */
  status?: SendStatus;
  /** кто дочитал до этого сообщения (в группах — аватарки) */
  readers?: string[];
}) {
  const me = client.getSafeUserId();
  const sender = ev.getSender() ?? "";
  const mine = sender === me;
  const grouped = !!prev && prev.getSender() === sender && ev.getTs() - prev.getTs() < 5 * 60_000 && !prev.isRedacted();
  const content = effectiveContent(ev);
  const member = room.getMember(sender);
  const name = member?.name ?? sender;
  const time = timeHM(ev.getTs());
  const replyId: string | undefined = ev.getContent()["m.relates_to"]?.["m.in_reply_to"]?.event_id;
  const [picker, setPicker] = useState(false);

  const redacted = ev.isRedacted();
  const canEdit = mine && !redacted && !ev.isSending() && (content.msgtype === MsgType.Text || content.msgtype === MsgType.Emote);
  const canDelete = !redacted && !ev.isSending() && room.currentState.maySendRedactionForEvent(ev, me);
  const encryptedUnreadable = ev.isDecryptionFailure() || ev.getType() === EventType.RoomMessageEncrypted;

  const react = (key: string) => toggleReaction(client, room, ev, key);
  const thread = actions.onThread ? ev.getThread() : undefined;
  const threadCount = thread && ev.isThreadRoot ? thread.length : 0;
  const pinned = pinnedIds(room).includes(ev.getId() ?? "");
  const canPin = !redacted && !ev.isSending() && room.currentState.maySendStateEvent(PINNED, me);

  return (
    <div
      id={`ev-${ev.getId()}`}
      className={"msg" + (grouped ? " grouped" : "") + (mine ? " mine" : "") + (picker ? " menu-open" : "")}
      tabIndex={-1}
    >
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-hover-time">{time}</span>
        ) : (
          <button className="msg-avatar" onClick={() => openDialog({ kind: "user", userId: sender })} title={name} aria-label={name}>
            <Avatar client={client} mxc={member?.getMxcAvatarUrl()} name={name} seed={sender} size={34} />
          </button>
        )}
      </div>
      <div className="msg-main">
        {!grouped && (
          <div className="msg-head">
            <button className="msg-author" onClick={() => openDialog({ kind: "user", userId: sender })}>
              {name}
            </button>
            <span className="msg-time">{time}</span>
          </div>
        )}
        {replyId && !redacted && <ReplyQuote client={client} room={room} eventId={replyId} />}
        <div className="msg-body">
          {redacted ? (
            <span className="msg-locked">
              <Ban size={13} /> Сообщение удалено
            </span>
          ) : (
            <Body client={client} ev={ev} content={content} />
          )}
          {!redacted && ev.replacingEvent() && <span className="msg-meta"> (изменено)</span>}
          {status ? (
            <SendMark status={status} onRetry={() => client.resendEvent(ev, room).catch(() => {})} />
          ) : (
            ev.isSending() && (
              <span className="msg-status sending" title="Отправляется">
                <Circle size={10} strokeWidth={2.5} />
              </span>
            )
          )}
        </div>
        {!redacted && <Reactions client={client} room={room} ev={ev} />}
        {readers && readers.length > 0 && <Readers client={client} room={room} userIds={readers} />}
        {threadCount > 0 && thread && (
          <button className="thread-summary" onClick={() => actions.onThread!(ev)}>
            <MessagesSquare size={14} />
            <b>
              {threadCount} {plural(threadCount, "ответ", "ответа", "ответов")}
            </b>
            {thread.lastReply() && (
              <span>
                последний {room.getMember(thread.lastReply()!.getSender() ?? "")?.name ?? ""}, {listTime(thread.lastReply()!.getTs())}
              </span>
            )}
          </button>
        )}
      </div>

      {!redacted && !ev.isSending() && (
        <div className="msg-actions" onClick={(e) => e.stopPropagation()}>
          {!encryptedUnreadable && (
            <>
              {QUICK_REACTIONS.slice(0, 3).map((k) => (
                <button key={k} className="act emoji" onClick={() => react(k)} title={`Реакция ${k}`}>
                  {k}
                </button>
              ))}
              <button className="act" onClick={() => setPicker((v) => !v)} title="Другая реакция" aria-label="Другая реакция">
                <SmilePlus size={16} />
              </button>
              <span className="act-sep" />
            </>
          )}
          <button className="act" onClick={() => actions.onReply(ev)} title="Ответить" aria-label="Ответить">
            <Reply size={16} />
          </button>
          {actions.onThread && !ev.threadRootId && (
            <button className="act" onClick={() => actions.onThread!(ev)} title="Ответить в треде" aria-label="Ответить в треде">
              <MessagesSquare size={15} />
            </button>
          )}
          {canPin && (
            <button
              className="act"
              onClick={() => togglePin(client, room, ev.getId()!).catch((e) => alert(e?.message ?? String(e)))}
              title={pinned ? "Открепить" : "Закрепить"}
              aria-label={pinned ? "Открепить" : "Закрепить"}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          {canEdit && (
            <button className="act" onClick={() => actions.onEdit(ev)} title="Изменить" aria-label="Изменить">
              <Pencil size={15} />
            </button>
          )}
          {!encryptedUnreadable && (
            <button
              className="act"
              onClick={() => navigator.clipboard.writeText(plainText(ev)).catch(() => {})}
              title="Скопировать текст"
              aria-label="Скопировать текст"
            >
              <Copy size={15} />
            </button>
          )}
          {canDelete && (
            <button
              className="act danger"
              onClick={() => {
                if (confirm(mine ? "Удалить сообщение у всех?" : "Удалить чужое сообщение у всех?")) {
                  client.redactEvent(room.roomId, ev.getId()!).catch((e) => alert(e?.message ?? String(e)));
                }
              }}
              title="Удалить"
              aria-label="Удалить"
            >
              <Trash2 size={15} />
            </button>
          )}
          {picker && (
            <EmojiPicker
              onPick={(k) => {
                setPicker(false);
                react(k);
              }}
              onClose={() => setPicker(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (k: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="emoji-picker" ref={ref}>
      {MORE_REACTIONS.map((k) => (
        <button key={k} onClick={() => onPick(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

// ---------- реакции ----------
async function toggleReaction(client: MatrixClient, room: Room, ev: MatrixEvent, key: string) {
  const me = client.getSafeUserId();
  const rel = room.relations.getChildEventsForEvent(ev.getId()!, "m.annotation", EventType.Reaction);
  const existing = rel?.getSortedAnnotationsByKey()?.find(([k]) => k === key)?.[1];
  const mineEv = existing && [...existing].find((e) => e.getSender() === me && !e.isRedacted());
  try {
    if (mineEv) await client.redactEvent(room.roomId, mineEv.getId()!);
    else
      await client.sendEvent(room.roomId, EventType.Reaction, {
        "m.relates_to": { rel_type: "m.annotation", event_id: ev.getId()!, key },
      } as any);
  } catch (e) {
    console.error("reaction", e);
  }
}

function Reactions({ client, room, ev }: { client: MatrixClient; room: Room; ev: MatrixEvent }) {
  const rel = room.relations.getChildEventsForEvent(ev.getId()!, "m.annotation", EventType.Reaction);
  const groups = (rel?.getSortedAnnotationsByKey() ?? [])
    .map(([key, set]) => [key, [...set].filter((e) => !e.isRedacted())] as const)
    .filter(([, list]) => list.length > 0);
  if (!groups.length) return null;
  const me = client.getSafeUserId();
  return (
    <div className="reactions">
      {groups.map(([key, list]) => {
        const mine = list.some((e) => e.getSender() === me);
        const names = list.map((e) => room.getMember(e.getSender() ?? "")?.name ?? e.getSender()).join(", ");
        return (
          <button
            key={key}
            className={"reaction" + (mine ? " mine" : "")}
            onClick={() => toggleReaction(client, room, ev, key)}
            title={names}
          >
            <span className="reaction-key">{key}</span>
            <span className="reaction-count">{list.length}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- ответ ----------
function ReplyQuote({ client, room, eventId }: { client: MatrixClient; room: Room; eventId: string }) {
  const [ev, setEv] = useState<MatrixEvent | null>(() => room.findEventById(eventId) ?? null);
  useEffect(() => {
    if (ev) return;
    let alive = true;
    // Исходного сообщения нет в загруженной истории — запрашиваем с сервера
    client
      .fetchRoomEvent(room.roomId, eventId)
      .then(async (raw) => {
        const mapped = client.getEventMapper()(raw);
        if (mapped.isEncrypted()) await client.decryptEventIfNeeded(mapped).catch(() => {});
        if (alive) setEv(mapped);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, room, eventId, ev]);

  // в DOM (лента или тред) — просто прокрутить; иначе комната подгрузит историю
  const jump = () => {
    if (!flashEvent(eventId)) requestJump(room.roomId, eventId);
  };


  const sender = ev?.getSender() ?? "";
  return (
    <button className="reply-quote" onClick={jump} title="Перейти к сообщению">
      <span className="reply-author">{ev ? (room.getMember(sender)?.name ?? sender) : "Сообщение"}</span>
      <span className="reply-text">{ev ? plainText(ev) : "Загрузка…"}</span>
    </button>
  );
}

// ---------- тело ----------
function onLinkClick(e: ReactMouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href) openExternal(href);
}

function Body({ client, ev, content }: { client: MatrixClient; ev: MatrixEvent; content: Record<string, any> }) {
  if (ev.isDecryptionFailure()) {
    return (
      <span className="msg-locked">
        <Lock size={13} /> Не удалось расшифровать. Подтвердите этот сеанс
      </span>
    );
  }
  if (ev.getType() === EventType.RoomMessageEncrypted) {
    return (
      <span className="msg-locked">
        <Lock size={13} /> Расшифровка…
      </span>
    );
  }
  switch (content.msgtype) {
    case MsgType.Image:
      return <ImageMessage client={client} content={content} />;
    case MsgType.Video:
      return <VideoMessage client={client} content={content} />;
    case MsgType.Audio:
      return <AudioMessage client={client} content={content} />;
    case MsgType.File:
      return <FileMessage client={client} content={content} />;
  }
  if (ev.getType() === EventType.Sticker) {
    return <ImageMessage client={client} content={content} />;
  }

  const cls = content.msgtype === MsgType.Notice ? "msg-text notice" : content.msgtype === MsgType.Emote ? "msg-text emote" : "msg-text";
  if (content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string") {
    return (
      <div
        className={cls + " rich"}
        onClick={onLinkClick}
        dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(content.formatted_body) }}
      />
    );
  }
  const text = stripReplyFallback(String(content.body ?? ""));
  return (
    <span className={cls}>
      {linkify(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} onClick={onLinkClick}>
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** У своих сообщений: кружок — отправляется, одна галочка — доставлено, две — прочитано. */
function SendMark({ status, onRetry }: { status: SendStatus; onRetry: () => void }) {
  if (status === "failed")
    return (
      <button className="msg-status failed" onClick={onRetry} title="Не отправлено — нажмите, чтобы повторить">
        <CircleAlert size={13} /> Не отправлено
      </button>
    );
  const label = status === "sending" ? "Отправляется" : status === "sent" ? "Доставлено" : "Прочитано";
  return (
    <span className={"msg-status " + status} title={label} aria-label={label}>
      {status === "sending" ? <Circle size={10} strokeWidth={2.5} /> : status === "sent" ? <Check size={14} /> : <CheckCheck size={14} />}
    </span>
  );
}

/** Аватарки дочитавших до этого места; при наведении — имена. */
function Readers({ client, room, userIds }: { client: MatrixClient; room: Room; userIds: string[] }) {
  const names = userIds.map((u) => room.getMember(u)?.name ?? u);
  const shown = userIds.slice(0, 5);
  return (
    <div className="msg-readers" title={`Прочитали: ${names.join(", ")}`}>
      {shown.map((u, i) => (
        <span key={u} className="reader">
          <Avatar client={client} mxc={room.getMember(u)?.getMxcAvatarUrl()} name={names[i]} seed={u} size={16} />
        </span>
      ))}
      {userIds.length > shown.length && <span className="reader-more">+{userIds.length - shown.length}</span>}
    </div>
  );
}
