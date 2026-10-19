import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Direction, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { ChevronLeft, LockKeyhole, MessagesSquare, PanelRight, Search, Upload } from "lucide-react";
import { dayLabel, isVisibleMessage, sameDay } from "../format";
import { RoomAvatar } from "./Avatar";
import CallPanel from "./CallPanel";
import CallButtons from "./CallButtons";
import Composer, { type ComposerMode } from "./Composer";
import Message, { effectiveContent } from "./Message";
import { readInfo } from "../receipts";
import UploadDialog from "./UploadDialog";
import RoomInfo from "./RoomInfo";
import { isDirect } from "../rooms";
import { flashEvent, loadUntil, onJump, takeJump } from "../jump";
import { PinnedBar, PinsPanel, SearchPanel, ThreadPanel, ThreadsPanel } from "./Panels";

type Panel =
  | { kind: "info" }
  | { kind: "thread"; rootId: string; fromList?: boolean }
  | { kind: "threads" }
  | { kind: "search" }
  | { kind: "pins" }
  | null;

export default function RoomView({
  client,
  room,
  infoOpen,
  onToggleInfo,
  onOpenRoom,
  onBack,
}: {
  client: MatrixClient;
  room: Room;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onOpenRoom: (roomId: string) => void;
  /** телефон: назад к списку чатов */
  onBack?: () => void;
}) {
  const allEvents = room.getLiveTimeline().getEvents();
  const events = allEvents.filter(isVisibleMessage);
  // Кто что прочитал: галочки у своих сообщений, в группах — аватарки дочитавших
  const reads = readInfo(client, room, allEvents, events);
  const isGroup = room.getJoinedMemberCount() > 2;
  const lastId = events.at(-1)?.getId();
  const me = client.getSafeUserId();

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(true);
  const [mode, setMode] = useState<ComposerMode>({ kind: "normal" });
  const [pending, setPending] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [panel, setPanel] = useState<Panel>(infoOpen ? { kind: "info" } : null);

  // Main просит открыть «Участники и настройки» (например, из меню списка чатов)
  useEffect(() => {
    if (infoOpen) setPanel({ kind: "info" });
    else setPanel((p) => (p?.kind === "info" ? null : p));
  }, [infoOpen]);
  const closePanel = () => {
    if (panel?.kind === "info") onToggleInfo();
    else setPanel(null);
  };
  const togglePanel = (kind: "search" | "threads") => {
    if (panel?.kind === "info") onToggleInfo();
    setPanel((p) => (p?.kind === kind ? null : { kind }));
  };

  /** Перейти к сообщению: подгружаем историю, если нужно, и подсвечиваем. */
  const jumpTo = async (eventId: string) => {
    stickToBottom.current = false;
    if (!flashEvent(eventId)) {
      const ok = await loadUntil(client, room, eventId);
      requestAnimationFrame(() => {
        if (!flashEvent(eventId) && !ok) alert("Сообщение не найдено в истории этого чата");
      });
    }
  };
  // переходы из поиска (в том числе из другой комнаты)
  useEffect(() => {
    const run = () => {
      const id = takeJump(room.roomId);
      if (id) setTimeout(() => jumpTo(id), 50);
    };
    run();
    return onJump(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId]);

  // Держим прокрутку внизу, если пользователь уже был внизу
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, events.length]);

  // Отметка о прочтении последнего сообщения — сразу, если окно активно, иначе когда к нему вернутся
  useEffect(() => {
    const send = () => {
      const last = room.getLiveTimeline().getEvents().at(-1);
      if (!last || last.isSending() || !document.hasFocus() || document.hidden) return;
      if (room.getEventReadUpTo(client.getSafeUserId()) === last.getId()) return; // уже отмечено
      client.sendReadReceipt(last).catch(() => {});
    };
    send();
    window.addEventListener("focus", send);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.removeEventListener("focus", send);
      document.removeEventListener("visibilitychange", send);
    };
  }, [client, room, lastId]);

  // Мало сообщений, чтобы появилась прокрутка, — подгружаем историю сразу
  useEffect(() => {
    const el = scroller.current;
    if (el && canLoadMore && !loadingMore && el.scrollHeight <= el.clientHeight + 40) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, canLoadMore]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 120 && canLoadMore && !loadingMore) loadMore();
  };

  const loadMore = async () => {
    const el = scroller.current;
    setLoadingMore(true);
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      await client.scrollback(room, 40);
      setCanLoadMore(!!room.getLiveTimeline().getPaginationToken(Direction.Backward));
    } catch {
      setCanLoadMore(false);
    } finally {
      setLoadingMore(false);
      // сохраняем позицию после подгрузки сверху
      requestAnimationFrame(() => {
        if (el && !stickToBottom.current) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    }
  };

  const editLast = () => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const c = effectiveContent(e);
      if (e.getSender() === me && !e.isRedacted() && (c.msgtype === MsgType.Text || c.msgtype === MsgType.Emote)) {
        setMode({ kind: "edit", ev: e });
        return;
      }
    }
  };

  const actions = {
    onReply: (ev: MatrixEvent) => setMode({ kind: "reply", ev }),
    onEdit: (ev: MatrixEvent) => setMode({ kind: "edit", ev }),
    onThread: (ev: MatrixEvent) => {
      if (panel?.kind === "info") onToggleInfo();
      setPanel({ kind: "thread", rootId: ev.getId()! });
    },
  };

  // ---------- перетаскивание файлов ----------
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) setPending((p) => [...p, ...files]);
  };

  const members = room.getJoinedMemberCount();
  const isDm = isDirect(client, room);
  const typing = room
    .getMembers()
    .filter((m) => m.typing && m.userId !== me)
    .map((m) => m.name);

  return (
    <div className="room-shell">
    <div
      className="room-view"
      onDragEnter={onDragEnter}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="room-head" data-tauri-drag-region>
        {onBack && (
          <button className="icon-btn back-btn" onClick={onBack} title="К списку чатов" aria-label="К списку чатов">
            <ChevronLeft size={22} />
          </button>
        )}
        <RoomAvatar client={client} room={room} size={34} />
        <div className="room-head-text" data-tauri-drag-region>
          <div className="room-title">{room.name}</div>
          <div className="room-sub">
            {room.hasEncryptionStateEvent() && <LockKeyhole size={11} />}
            {isDm ? "Личный чат" : `${members} ${plural(members, "участник", "участника", "участников")}`}
          </div>
        </div>
        <CallButtons client={client} room={room} />
        <button
          className={"icon-btn" + (panel?.kind === "search" ? " on" : "")}
          onClick={() => togglePanel("search")}
          title="Поиск по сообщениям"
          aria-label="Поиск по сообщениям"
        >
          <Search size={18} />
        </button>
        <button
          className={"icon-btn" + (panel?.kind === "threads" || panel?.kind === "thread" ? " on" : "")}
          onClick={() => togglePanel("threads")}
          title="Треды"
          aria-label="Треды"
        >
          <MessagesSquare size={18} />
        </button>
        <button
          className={"icon-btn" + (panel?.kind === "info" ? " on" : "")}
          onClick={() => {
            if (panel && panel.kind !== "info") setPanel(null);
            onToggleInfo();
          }}
          title="Участники и настройки"
          aria-label="Участники и настройки"
        >
          <PanelRight size={18} />
        </button>
      </header>

      <CallPanel client={client} room={room} />
      <PinnedBar client={client} room={room} onOpen={() => setPanel({ kind: "pins" })} />

      <div className="timeline" ref={scroller} onScroll={onScroll}>
        {loadingMore && <div className="timeline-loading">Загружаю историю…</div>}
        {!canLoadMore && <div className="timeline-start">Начало переписки</div>}
        {events.map((ev, i) => {
          const prev = events[i - 1];
          const newDay = !prev || !sameDay(prev.getTs(), ev.getTs());
          return (
            <div key={ev.getId() ?? i}>
              {newDay && (
                <div className="day-sep">
                  <span>{dayLabel(ev.getTs())}</span>
                </div>
              )}
              <Message
                client={client}
                room={room}
                ev={ev}
                prev={newDay ? undefined : prev}
                actions={actions}
                status={reads.status.get(ev.getId() ?? "")}
                readers={isGroup ? reads.readers.get(ev.getId() ?? "") : undefined}
              />
            </div>
          );
        })}
      </div>

      <div className="typing">{typing.length > 0 && typingText(typing)}</div>

      <Composer
        client={client}
        room={room}
        mode={mode}
        setMode={setMode}
        onFiles={(files) => setPending((p) => [...p, ...files])}
        onSent={() => (stickToBottom.current = true)}
        onEditLast={editLast}
      />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <Upload size={28} />
            <div>Отпустите, чтобы отправить в «{room.name}»</div>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <UploadDialog
          client={client}
          room={room}
          files={pending}
          replyTo={mode.kind === "reply" ? mode.ev : undefined}
          onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          onClose={(sent) => {
            setPending([]);
            if (sent) {
              stickToBottom.current = true;
              if (mode.kind === "reply") setMode({ kind: "normal" });
            }
          }}
        />
      )}
    </div>
    {panel?.kind === "info" && <RoomInfo client={client} room={room} onClose={closePanel} onOpenRoom={onOpenRoom} />}
    {panel?.kind === "thread" && (
      <ThreadPanel
        key={panel.rootId}
        client={client}
        room={room}
        rootId={panel.rootId}
        onClose={closePanel}
        onBack={panel.fromList ? () => setPanel({ kind: "threads" }) : undefined}
      />
    )}
    {panel?.kind === "threads" && (
      <ThreadsPanel client={client} room={room} onClose={closePanel} onOpen={(rootId) => setPanel({ kind: "thread", rootId, fromList: true })} />
    )}
    {panel?.kind === "search" && (
      <SearchPanel
        client={client}
        room={room}
        onClose={closePanel}
        onOpenThread={(rootId) => setPanel({ kind: "thread", rootId })}
        onOpenRoom={onOpenRoom}
      />
    )}
    {panel?.kind === "pins" && <PinsPanel client={client} room={room} onClose={closePanel} onJump={jumpTo} />}
    </div>
  );
}

function typingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} печатает…`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
  return `${names[0]} и ещё ${names.length - 1} печатают…`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
