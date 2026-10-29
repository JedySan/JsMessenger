import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import {
  Ban,
  Check,
  CheckCheck,
  Circle,
  CircleAlert,
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Forward,
  Image as ImageIcon,
  Link2,
  Lock,
  Maximize2,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  TextSelect,
  Trash2,
} from "lucide-react";
import { listTime, stripReplyFallback, timeHM } from "../format";
import { htmlToText, linkify, sanitizeMessageHtml } from "../richtext";
import { openExternal } from "../widgets";
import { flashEvent, requestJump } from "../jump";
import Avatar from "./Avatar";
import type { SendStatus } from "../receipts";
import { openDialog } from "./DialogHost";
import { AudioMessage, FileMessage, ImageMessage, VideoMessage, VoiceMessage, openSaved, openViewer, revealSaved, saveContent } from "./Media";
import { PopupMenu, type MenuItem } from "./ui";
import { canForward } from "../forward";
import { isVoice } from "../voice";
import { isPollStart, pollPreview } from "../polls";
import { PollCard } from "./Poll";
import { canOpenFiles, canSaveAs, copyImage, useDownload } from "../downloads";
import { plural } from "../i18n";
import { captionOf, fileNameOf } from "../caption";
import { tr } from "../i18n";
import { ask, notice } from "./Ask";

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
  if (ev.isRedacted()) return tr("Сообщение удалено");
  if (isPollStart(ev)) return pollPreview(ev);
  const c = effectiveContent(ev);
  const cap = captionOf(c)?.text.replace(/\s+/g, " ");
  switch (c.msgtype) {
    case MsgType.Image:
      return cap ? `${tr("Фото")}: ${cap}` : tr("Фото");
    case MsgType.Video:
      return cap ? `${tr("Видео")}: ${cap}` : tr("Видео");
    case MsgType.Audio:
      return isVoice(c) ? tr("Голосовое сообщение") : cap ? `${tr("Аудио")}: ${cap}` : tr("Аудио");
    case MsgType.File:
      return cap ? `${fileNameOf(c)}: ${cap}` : tr("Файл: {0}", fileNameOf(c));
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
  const [menu, setMenu] = useState<{ x: number; y: number; link?: string; selection?: string } | null>(null);

  const redacted = ev.isRedacted();
  const canEdit = mine && !redacted && !ev.isSending() && (content.msgtype === MsgType.Text || content.msgtype === MsgType.Emote);
  const canDelete = !redacted && !ev.isSending() && room.currentState.maySendRedactionForEvent(ev, me);
  const encryptedUnreadable = ev.isDecryptionFailure() || ev.getType() === EventType.RoomMessageEncrypted;

  const react = (key: string) => toggleReaction(client, room, ev, key);
  const thread = actions.onThread ? ev.getThread() : undefined;
  const threadCount = thread && ev.isThreadRoot ? thread.length : 0;
  const pinned = pinnedIds(room).includes(ev.getId() ?? "");
  const canPin = !redacted && !ev.isSending() && room.currentState.maySendStateEvent(PINNED, me);
  const forwardable = canForward(ev);

  const pin = () => togglePin(client, room, ev.getId()!).catch((e) => notice(e?.message ?? String(e)));
  const del = () =>
    void ask(mine ? tr("Удалить сообщение у всех?") : tr("Удалить чужое сообщение у всех?"), {
      ok: tr("Удалить"),
      danger: true,
    }).then((ok): unknown => ok && client.redactEvent(room.roomId, ev.getId()!).catch((e) => notice(e?.message ?? String(e))));
  const forward = () => openDialog({ kind: "forward", ev });

  // правая кнопка (на телефоне — долгое нажатие): своё меню вместо системного
  const onContextMenu = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true], video, audio")) return;
    e.preventDefault();
    const sel = window.getSelection();
    const root = e.currentTarget as HTMLElement;
    const selection = sel && !sel.isCollapsed && root.contains(sel.anchorNode) ? sel.toString().trim() : "";
    const href = target.closest("a")?.getAttribute("href") ?? undefined;
    setMenu({ x: e.clientX, y: e.clientY, link: href && /^(https?|mailto):/i.test(href) ? href : undefined, selection: selection || undefined });
  };

  return (
    <div
      id={`ev-${ev.getId()}`}
      className={"msg" + (grouped ? " grouped" : "") + (mine ? " mine" : "") + (picker ? " menu-open" : "") + (menu ? " menu-target" : "")}
      tabIndex={-1}
      onContextMenu={onContextMenu}
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
              <Ban size={13} /> {tr("Сообщение удалено")}
            </span>
          ) : (
            <Body client={client} room={room} ev={ev} content={content} />
          )}
          {!redacted && ev.replacingEvent() && <span className="msg-meta"> {tr("(изменено)")}</span>}
          {status ? (
            <SendMark status={status} onRetry={() => client.resendEvent(ev, room).catch(() => {})} />
          ) : (
            ev.isSending() && (
              <span className="msg-status sending" title={tr("Отправляется")}>
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
                {tr("последний {0}, {1}", room.getMember(thread.lastReply()!.getSender() ?? "")?.name ?? "", listTime(thread.lastReply()!.getTs()))}
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
                <button key={k} className="act emoji" onClick={() => react(k)} title={tr("Реакция {0}", k)}>
                  {k}
                </button>
              ))}
              <button className="act" onClick={() => setPicker((v) => !v)} title={tr("Другая реакция")} aria-label={tr("Другая реакция")}>
                <SmilePlus size={16} />
              </button>
              <span className="act-sep" />
            </>
          )}
          <button className="act" onClick={() => actions.onReply(ev)} title={tr("Ответить")} aria-label={tr("Ответить")}>
            <Reply size={16} />
          </button>
          {actions.onThread && !ev.threadRootId && (
            <button className="act" onClick={() => actions.onThread!(ev)} title={tr("Ответить в треде")} aria-label={tr("Ответить в треде")}>
              <MessagesSquare size={15} />
            </button>
          )}
          {forwardable && (
            <button className="act" onClick={forward} title={tr("Переслать")} aria-label={tr("Переслать")}>
              <Forward size={15} />
            </button>
          )}
          {canPin && (
            <button
              className="act"
              onClick={pin}
              title={pinned ? tr("Открепить") : tr("Закрепить")}
              aria-label={pinned ? tr("Открепить") : tr("Закрепить")}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          {canEdit && (
            <button className="act" onClick={() => actions.onEdit(ev)} title={tr("Изменить")} aria-label={tr("Изменить")}>
              <Pencil size={15} />
            </button>
          )}
          {!encryptedUnreadable && (
            <button
              className="act"
              onClick={() => navigator.clipboard.writeText(plainText(ev)).catch(() => {})}
              title={tr("Скопировать текст")}
              aria-label={tr("Скопировать текст")}
            >
              <Copy size={15} />
            </button>
          )}
          {canDelete && (
            <button
              className="act danger"
              onClick={del}
              title={tr("Удалить")}
              aria-label={tr("Удалить")}
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
      {menu && (
        <MessageMenu
          client={client}
          room={room}
          ev={ev}
          content={content}
          at={menu}
          onClose={() => setMenu(null)}
          can={{ edit: canEdit, del: canDelete, pin: canPin, pinned, forward: forwardable, thread: !!actions.onThread && !ev.threadRootId, readable: !encryptedUnreadable && !redacted }}
          act={{
            react,
            more: () => setPicker(true),
            reply: () => actions.onReply(ev),
            thread: () => actions.onThread?.(ev),
            edit: () => actions.onEdit(ev),
            pin,
            del,
            forward,
          }}
        />
      )}
    </div>
  );
}

const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => notice(tr("Не удалось скопировать")));

/** Меню сообщения по правой кнопке: реакции, ответ, пересылка, копирование, вложение, правка, удаление. */
function MessageMenu({
  client,
  room,
  ev,
  content,
  at,
  onClose,
  can,
  act,
}: {
  client: MatrixClient;
  room: Room;
  ev: MatrixEvent;
  content: Record<string, any>;
  at: { x: number; y: number; link?: string; selection?: string };
  onClose: () => void;
  can: { edit: boolean; del: boolean; pin: boolean; pinned: boolean; forward: boolean; thread: boolean; readable: boolean };
  act: {
    react: (k: string) => void;
    more: () => void;
    reply: () => void;
    thread: () => void;
    edit: () => void;
    pin: () => void;
    del: () => void;
    forward: () => void;
  };
}) {
  const dl = useDownload(content);
  const t = content.msgtype as string | undefined;
  const isImage = t === MsgType.Image || ev.getType() === EventType.Sticker;
  const isVideo = t === MsgType.Video;
  const isFile = t === MsgType.File || t === MsgType.Audio;
  const hasMedia = can.readable && (isImage || isVideo || isFile) && !!(content.url || content.file);
  const isText = can.readable && !hasMedia && typeof content.body === "string";
  const cap = can.readable && hasMedia ? captionOf(content) : null;
  const saved = dl.status === "done" && !!dl.path && canOpenFiles();
  const sending = ev.isSending();

  const items: MenuItem[] = [
    { label: tr("Ответить"), icon: <Reply size={15} />, onClick: act.reply, hidden: sending || ev.isRedacted() },
    { label: tr("Ответить в треде"), icon: <MessagesSquare size={15} />, onClick: act.thread, hidden: !can.thread || sending || ev.isRedacted() },
    { label: tr("Переслать"), icon: <Forward size={15} />, onClick: act.forward, hidden: !can.forward },

    // копирование
    { sep: true, label: tr("Копировать выделенное"), icon: <TextSelect size={15} />, onClick: () => copy(at.selection!), hidden: !at.selection },
    { sep: !at.selection, label: tr("Копировать текст"), icon: <Copy size={15} />, onClick: () => copy(plainText(ev)), hidden: !isText },
    { sep: !at.selection, label: tr("Копировать подпись"), icon: <Copy size={15} />, onClick: () => copy(cap!.text), hidden: !cap },
    { label: tr("Копировать ссылку"), icon: <Link2 size={15} />, onClick: () => copy(at.link!), hidden: !at.link },
    { label: tr("Открыть ссылку"), icon: <ExternalLink size={15} />, onClick: () => openExternal(at.link!), hidden: !at.link },

    // вложение
    { sep: true, label: tr("Открыть"), icon: <Maximize2 size={15} />, onClick: () => openViewer(client, [content]), hidden: !hasMedia || !(isImage || isVideo) },
    {
      label: tr("Копировать изображение"),
      icon: <ImageIcon size={15} />,
      onClick: () => void copyImage(client, content).catch((e) => notice(tr("Не удалось скопировать: {0}", e instanceof Error ? e.message : String(e)))),
      hidden: !hasMedia || !isImage,
    },
    { label: tr("Открыть файл"), icon: <ExternalLink size={15} />, onClick: () => void openSaved(content), hidden: !hasMedia || !saved },
    { label: tr("Показать в папке"), icon: <FolderOpen size={15} />, onClick: () => void revealSaved(content), hidden: !hasMedia || !saved },
    {
      sep: !(isImage || isVideo) && !saved,
      label: tr("Скачать в «Загрузки»"),
      icon: <Download size={15} />,
      onClick: () => void saveContent(client, content),
      hidden: !hasMedia || saved || dl.status === "loading",
    },
    { label: tr("Сохранить как…"), icon: <FolderInput size={15} />, onClick: () => void saveContent(client, content, true), hidden: !hasMedia || !canSaveAs() },

    // управление
    { sep: true, label: tr("Изменить"), icon: <Pencil size={15} />, onClick: act.edit, hidden: !can.edit },
    { label: can.pinned ? tr("Открепить") : tr("Закрепить"), icon: can.pinned ? <PinOff size={15} /> : <Pin size={15} />, onClick: act.pin, hidden: !can.pin },
    {
      label: tr("Копировать ссылку на сообщение"),
      icon: <ClipboardCopy size={15} />,
      onClick: () => copy(`https://matrix.to/#/${encodeURIComponent(room.roomId)}/${encodeURIComponent(ev.getId()!)}`),
      hidden: sending,
    },
    { sep: true, label: tr("Удалить"), icon: <Trash2 size={15} />, danger: true, onClick: act.del, hidden: !can.del },
  ];
  // первая видимая черта не нужна; черты подряд — тоже
  let prevSep = true;
  for (const i of items) {
    if (i.hidden) continue;
    if (i.sep && prevSep) i.sep = false;
    prevSep = false;
  }

  const header =
    can.readable && !sending ? (
      <div className="popup-reacts">
        {QUICK_REACTIONS.map((k) => (
          <button
            key={k}
            onClick={() => {
              onClose();
              act.react(k);
            }}
            title={tr("Реакция {0}", k)}
          >
            {k}
          </button>
        ))}
        <button
          className="more"
          onClick={() => {
            onClose();
            act.more();
          }}
          title={tr("Другая реакция")}
          aria-label={tr("Другая реакция")}
        >
          <SmilePlus size={17} />
        </button>
      </div>
    ) : undefined;

  const empty = !header && items.every((i) => i.hidden);
  useEffect(() => {
    if (empty) onClose();
  }, [empty, onClose]);
  if (empty) return null;
  // в body — чтобы меню не обрезалось и не съезжало внутри прокручиваемой ленты
  return createPortal(<PopupMenu x={at.x} y={at.y} items={items} onClose={onClose} header={header} />, document.body);
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
    <button className="reply-quote" onClick={jump} title={tr("Перейти к сообщению")}>
      <span className="reply-author">{ev ? (room.getMember(sender)?.name ?? sender) : tr("Сообщение")}</span>
      <span className="reply-text">{ev ? plainText(ev) : tr("Загрузка…")}</span>
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

function Body({ client, room, ev, content }: { client: MatrixClient; room: Room; ev: MatrixEvent; content: Record<string, any> }) {
  if (ev.isDecryptionFailure()) {
    return (
      <span className="msg-locked">
        <Lock size={13} /> {tr("Не удалось расшифровать. Подтвердите этот сеанс")}
      </span>
    );
  }
  if (ev.getType() === EventType.RoomMessageEncrypted) {
    return (
      <span className="msg-locked">
        <Lock size={13} /> {tr("Расшифровка…")}
      </span>
    );
  }
  if (isPollStart(ev)) return <PollCard client={client} room={room} ev={ev} />;
  const media = mediaBody(client, content);
  if (media) {
    const cap = captionOf(content);
    return cap ? (
      <>
        {media}
        <Caption {...cap} />
      </>
    ) : (
      media
    );
  }
  if (ev.getType() === EventType.Sticker) {
    return <ImageMessage client={client} content={content} />;
  }
  return <TextBody content={content} />;
}

function mediaBody(client: MatrixClient, content: Record<string, any>) {
  switch (content.msgtype) {
    case MsgType.Image:
      return <ImageMessage client={client} content={content} />;
    case MsgType.Video:
      return <VideoMessage client={client} content={content} />;
    case MsgType.Audio:
      return isVoice(content) ? <VoiceMessage client={client} content={content} /> : <AudioMessage client={client} content={content} />;
    case MsgType.File:
      return <FileMessage client={client} content={content} />;
  }
  return null;
}

/** Подпись к файлу — обычный текст сообщения под вложением. */
function Caption({ text, html }: { text: string; html?: string }) {
  if (html)
    return <div className="msg-text rich msg-caption" onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(html) }} />;
  return (
    <span className="msg-text msg-caption">
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

function TextBody({ content }: { content: Record<string, any> }) {
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


/** У своих сообщений: кружок — отправляется, одна галочка — доставлено, две — прочитано. */
function SendMark({ status, onRetry }: { status: SendStatus; onRetry: () => void }) {
  if (status === "failed")
    return (
      <button className="msg-status failed" onClick={onRetry} title={tr("Не отправлено — нажмите, чтобы повторить")}>
        <CircleAlert size={13} /> {tr("Не отправлено")}
      </button>
    );
  const label = status === "sending" ? tr("Отправляется") : status === "sent" ? tr("Доставлено") : tr("Прочитано");
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
    <div className="msg-readers" title={tr("Прочитали: {0}", names.join(", "))}>
      {shown.map((u, i) => (
        <span key={u} className="reader">
          <Avatar client={client} mxc={room.getMember(u)?.getMxcAvatarUrl()} name={names[i]} seed={u} size={16} />
        </span>
      ))}
      {userIds.length > shown.length && <span className="reader-more">+{userIds.length - shown.length}</span>}
    </div>
  );
}
