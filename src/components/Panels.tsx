import { useEffect, useReducer, useRef, useState } from "react";
import { Direction, RoomEvent, ThreadEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { ArrowLeft, LoaderCircle, MessagesSquare, Pin, PinOff, Search, X } from "lucide-react";
import { errText } from "../App";
import { dayLabel, isVisibleMessage, listTime, sameDay, timeHM } from "../format";
import { requestJump } from "../jump";
import Avatar from "./Avatar";
import Composer, { type ComposerMode } from "./Composer";
import Message, { pinnedIds, plainText, PINNED, togglePin, type MessageActions } from "./Message";
import UploadDialog from "./UploadDialog";
import { plural } from "../i18n";
import { tr } from "../i18n";

function PanelHead({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="info-head">
      <div className="panel-title">
        {onBack && (
          <button className="icon-btn small" onClick={onBack} aria-label={tr("Назад")}>
            <ArrowLeft size={16} />
          </button>
        )}
        {title}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label={tr("Закрыть панель")}>
        <X size={18} />
      </button>
    </div>
  );
}

// ---------- тред ----------
export function ThreadPanel({
  client,
  room,
  rootId,
  onClose,
  onBack,
}: {
  client: MatrixClient;
  room: Room;
  rootId: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [mode, setMode] = useState<ComposerMode>({ kind: "normal" });
  const [pending, setPending] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [rootFetched, setRootFetched] = useState<MatrixEvent | null>(null);

  const thread = room.getThread(rootId);
  const root = room.findEventById(rootId) ?? thread?.rootEvent ?? rootFetched;

  // Тред появляется после первого ответа — следим и за комнатой, и за самим тредом
  useEffect(() => {
    const onNew = () => bump();
    room.on(ThreadEvent.New, onNew);
    room.on(ThreadEvent.Update, onNew);
    room.on(ThreadEvent.NewReply, onNew);
    thread?.on(RoomEvent.Timeline, onNew);
    return () => {
      room.off(ThreadEvent.New, onNew);
      room.off(ThreadEvent.Update, onNew);
      room.off(ThreadEvent.NewReply, onNew);
      thread?.off(RoomEvent.Timeline, onNew);
    };
  }, [room, thread]);

  useEffect(() => {
    if (root) return;
    client
      .fetchRoomEvent(room.roomId, rootId)
      .then(async (raw) => {
        const ev = client.getEventMapper()(raw);
        if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev).catch(() => {});
        setRootFetched(ev);
      })
      .catch(() => {});
  }, [client, room, rootId, root]);

  const replies = (thread?.events ?? []).filter((e) => e.getId() !== rootId && isVisibleMessage(e));
  const last = replies.at(-1)?.getId();
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last, replies.length]);

  const canLoadMore = !!thread?.liveTimeline.getPaginationToken(Direction.Backward);
  const loadMore = async () => {
    if (!thread) return;
    setLoading(true);
    try {
      await client.paginateEventTimeline(thread.liveTimeline, { backwards: true, limit: 30 });
    } finally {
      setLoading(false);
    }
  };

  const actions: MessageActions = {
    onReply: (ev) => setMode({ kind: "reply", ev }),
    onEdit: (ev) => setMode({ kind: "edit", ev }),
  };

  return (
    <div className="room-info thread-panel">
      <PanelHead title={tr("Тред")} onClose={onClose} onBack={onBack} />
      <div className="thread-body" ref={scroller}>
        {root ? (
          <div className="thread-root">
            <Message client={client} room={room} ev={root} actions={actions} />
          </div>
        ) : (
          <div className="panel-empty">{tr("Загружаю сообщение…")}</div>
        )}
        <div className="thread-sep">
          {replies.length ? `${replies.length} ${plural(replies.length, "ответ", "ответа", "ответов")}` : tr("Ответов пока нет")}
        </div>
        {canLoadMore && (
          <button className="load-more" onClick={loadMore} disabled={loading}>
            {loading ? tr("Загружаю…") : tr("Показать ранние ответы")}
          </button>
        )}
        {replies.map((ev, i) => (
          <Message key={ev.getId() ?? i} client={client} room={room} ev={ev} prev={replies[i - 1]} actions={actions} />
        ))}
      </div>
      <Composer
        client={client}
        room={room}
        mode={mode}
        setMode={setMode}
        threadId={rootId}
        placeholder={tr("Ответить в треде")}
        onFiles={(f) => setPending((p) => [...p, ...f])}
        onSent={() => {}}
        onEditLast={() => {
          const mine = [...replies].reverse().find((e) => e.getSender() === client.getSafeUserId() && !e.isRedacted());
          if (mine) setMode({ kind: "edit", ev: mine });
        }}
      />
      {pending.length > 0 && (
        <UploadDialog
          client={client}
          room={room}
          files={pending}
          threadId={rootId}
          replyTo={mode.kind === "reply" ? mode.ev : undefined}
          onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          onClose={() => setPending([])}
        />
      )}
    </div>
  );
}

// ---------- список тредов ----------
export function ThreadsPanel({
  client,
  room,
  onOpen,
  onClose,
}: {
  client: MatrixClient;
  room: Room;
  onOpen: (rootId: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await room.createThreadsTimelineSets();
        await room.fetchRoomThreads();
      } catch {
        /* сервер без поддержки списка тредов — покажем то, что есть локально */
      }
      if (alive) setLoading(false);
    })();
    room.on(ThreadEvent.New, bump);
    room.on(ThreadEvent.Update, bump);
    return () => {
      alive = false;
      room.off(ThreadEvent.New, bump);
      room.off(ThreadEvent.Update, bump);
    };
  }, [room]);

  const threads = room
    .getThreads()
    .filter((t) => t.length > 0)
    .sort((a, b) => (b.lastReply()?.getTs() ?? 0) - (a.lastReply()?.getTs() ?? 0));

  return (
    <div className="room-info">
      <PanelHead title={tr("Треды")} onClose={onClose} />
      <div className="info-body">
        {loading && threads.length === 0 && (
          <div className="panel-empty">
            <LoaderCircle size={18} className="spin" />
          </div>
        )}
        {!loading && threads.length === 0 && (
          <div className="panel-empty">
            {tr("В этой комнате нет тредов. Наведите на сообщение и нажмите «Ответить в треде», чтобы начать обсуждение")}
          </div>
        )}
        {threads.map((t) => {
          const root = t.rootEvent ?? room.findEventById(t.id);
          const sender = root?.getSender() ?? "";
          const member = room.getMember(sender);
          return (
            <button key={t.id} className="thread-item" onClick={() => onOpen(t.id)}>
              <Avatar client={client} mxc={member?.getMxcAvatarUrl()} name={member?.name ?? sender} seed={sender} size={30} />
              <span className="thread-item-main">
                <span className="thread-item-head">
                  <b>{member?.name ?? sender}</b>
                  <span>{t.lastReply() ? listTime(t.lastReply()!.getTs()) : ""}</span>
                </span>
                <span className="thread-item-text">{root ? plainText(root) : tr("Сообщение")}</span>
                <span className="thread-item-count">
                  <MessagesSquare size={12} />
                  {t.length} {plural(t.length, "ответ", "ответа", "ответов")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- поиск ----------
interface Hit {
  ev: MatrixEvent;
  room: Room;
}

/** Поиск по загруженным сообщениям — единственный способ для зашифрованных комнат. */
function localSearch(rooms: Room[], term: string): Hit[] {
  const t = term.toLowerCase();
  const out: Hit[] = [];
  for (const room of rooms) {
    const evs = [
      ...room.getLiveTimeline().getEvents(),
      ...room.getThreads().flatMap((th) => th.events),
    ];
    const seen = new Set<string>();
    for (const ev of evs) {
      const id = ev.getId();
      if (!id || seen.has(id) || !isVisibleMessage(ev) || ev.isRedacted() || ev.isDecryptionFailure()) continue;
      seen.add(id);
      if (plainText(ev).toLowerCase().includes(t)) out.push({ ev, room });
    }
  }
  return out;
}

export function SearchPanel({
  client,
  room,
  onClose,
  onOpenThread,
  onOpenRoom,
}: {
  client: MatrixClient;
  room: Room;
  onClose: () => void;
  onOpenThread: (rootId: string) => void;
  onOpenRoom: (roomId: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<"room" | "all">("room");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deepening, setDeepening] = useState(false);
  const encrypted = room.hasEncryptionStateEvent();

  const run = async (q = term) => {
    const t = q.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const rooms = scope === "room" ? [room] : client.getRooms().filter((r) => r.getMyMembership() === "join");
      // зашифрованные — ищем у себя, остальные — на сервере
      const local = localSearch(rooms.filter((r) => r.hasEncryptionStateEvent()), t);
      let server: Hit[] = [];
      const plainRooms = rooms.filter((r) => !r.hasEncryptionStateEvent());
      if (plainRooms.length) {
        const res = await client.searchRoomEvents({
          term: t,
          filter: scope === "room" ? { rooms: [room.roomId] } : undefined,
        });
        server = res.results
          .map((r) => r.context.getEvent())
          .map((ev) => ({ ev, room: client.getRoom(ev.getRoomId() ?? "")! }))
          .filter((h) => h.room);
      }
      const all = [...server, ...local];
      const uniq = new Map(all.map((h) => [h.ev.getId(), h]));
      setHits([...uniq.values()].sort((a, b) => b.ev.getTs() - a.ev.getTs()).slice(0, 200));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (hits) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const deeper = async () => {
    setDeepening(true);
    try {
      for (let i = 0; i < 4; i++) {
        if (!room.getLiveTimeline().getPaginationToken(Direction.Backward)) break;
        await client.scrollback(room, 100);
      }
      await run();
    } finally {
      setDeepening(false);
    }
  };

  const open = (h: Hit) => {
    if (h.ev.threadRootId && h.ev.threadRootId !== h.ev.getId()) {
      if (h.room.roomId === room.roomId) onOpenThread(h.ev.threadRootId);
      return;
    }
    requestJump(h.room.roomId, h.ev.getId()!);
    if (h.room.roomId !== room.roomId) onOpenRoom(h.room.roomId);
  };

  return (
    <div className="room-info">
      <PanelHead title={tr("Поиск")} onClose={onClose} />
      <div className="info-body">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label className="search">
            <Search size={15} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr("Слово или фраза")} autoFocus />
          </label>
          <div className="segmented">
            <button type="button" className={scope === "room" ? "on" : ""} onClick={() => setScope("room")}>
              {tr("В этом чате")}
            </button>
            <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
              {tr("Во всех чатах")}
            </button>
          </div>
        </form>

        {encrypted && scope === "room" && (
          <p className="panel-note">
            {tr("Чат зашифрован: сервер не видит текст, поэтому ищу только среди загруженных сообщений.")}
          </p>
        )}
        {error && <p className="form-error left">{error}</p>}
        {busy && (
          <div className="panel-empty">
            <LoaderCircle size={18} className="spin" />
          </div>
        )}
        {!busy && hits && hits.length === 0 && <div className="panel-empty">{tr("Ничего не найдено")}</div>}
        {!busy &&
          hits?.map((h, i) => {
            const prev = hits[i - 1];
            const newDay = !prev || !sameDay(prev.ev.getTs(), h.ev.getTs());
            const sender = h.room.getMember(h.ev.getSender() ?? "")?.name ?? h.ev.getSender();
            return (
              <div key={h.ev.getId()}>
                {newDay && <div className="info-section">{dayLabel(h.ev.getTs())}</div>}
                <button className="hit" onClick={() => open(h)}>
                  <span className="hit-head">
                    <b>{sender}</b>
                    {scope === "all" && <span className="hit-room">{h.room.name}</span>}
                    <span className="hit-time">{timeHM(h.ev.getTs())}</span>
                  </span>
                  <span className="hit-text">{highlight(plainText(h.ev), term.trim())}</span>
                </button>
              </div>
            );
          })}
        {hits && encrypted && scope === "room" && room.getLiveTimeline().getPaginationToken(Direction.Backward) && (
          <button className="load-more" onClick={deeper} disabled={deepening}>
            {deepening ? tr("Загружаю историю…") : tr("Искать глубже в истории")}
          </button>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, term: string) {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text.length > 160 ? text.slice(0, 160) + "…" : text;
  const start = Math.max(0, i - 50);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length, i + term.length + 110)}
      {i + term.length + 110 < text.length && "…"}
    </>
  );
}

// ---------- закреплённые ----------
export function PinsPanel({
  client,
  room,
  onClose,
  onJump,
}: {
  client: MatrixClient;
  room: Room;
  onClose: () => void;
  onJump: (eventId: string) => void;
}) {
  const ids = pinnedIds(room).slice().reverse();
  const [events, setEvents] = useState<Record<string, MatrixEvent | "missing">>({});
  const canPin = room.currentState.maySendStateEvent(PINNED, client.getSafeUserId());

  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      if (events[id]) continue;
      const local = room.findEventById(id);
      if (local) {
        setEvents((m) => ({ ...m, [id]: local }));
        continue;
      }
      client
        .fetchRoomEvent(room.roomId, id)
        .then(async (raw) => {
          const ev = client.getEventMapper()(raw);
          if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev).catch(() => {});
          if (alive) setEvents((m) => ({ ...m, [id]: ev }));
        })
        .catch(() => alive && setEvents((m) => ({ ...m, [id]: "missing" })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return (
    <div className="room-info">
      <PanelHead title={tr("Закреплённые")} onClose={onClose} />
      <div className="info-body">
        {ids.length === 0 && (
          <div className="panel-empty">{tr("Закреплённых сообщений нет. Наведите на сообщение и нажмите на значок булавки")}</div>
        )}
        {ids.map((id) => {
          const ev = events[id];
          const sender = ev && ev !== "missing" ? (room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender()) : "";
          return (
            <div key={id} className="pin-item">
              <button className="hit" onClick={() => onJump(id)} disabled={!ev || ev === "missing"}>
                <span className="hit-head">
                  <Pin size={12} />
                  <b>{ev === "missing" ? tr("Сообщение недоступно") : ev ? sender : tr("Загружаю…")}</b>
                  {ev && ev !== "missing" && <span className="hit-time">{listTime(ev.getTs())}</span>}
                </span>
                {ev && ev !== "missing" && <span className="hit-text">{plainText(ev)}</span>}
              </button>
              {canPin && (
                <button
                  className="icon-btn small"
                  onClick={() => togglePin(client, room, id).catch((e) => alert(errText(e)))}
                  title={tr("Открепить")}
                  aria-label={tr("Открепить")}
                >
                  <PinOff size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Полоса под шапкой: последнее закреплённое сообщение. */
export function PinnedBar({ client, room, onOpen }: { client: MatrixClient; room: Room; onOpen: () => void }) {
  const ids = pinnedIds(room);
  const lastId = ids.at(-1);
  const [ev, setEv] = useState<MatrixEvent | null>(null);
  useEffect(() => {
    setEv(null);
    if (!lastId) return;
    const local = room.findEventById(lastId);
    if (local) return setEv(local);
    let alive = true;
    client
      .fetchRoomEvent(room.roomId, lastId)
      .then(async (raw) => {
        const e = client.getEventMapper()(raw);
        if (e.isEncrypted()) await client.decryptEventIfNeeded(e).catch(() => {});
        if (alive) setEv(e);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, room, lastId]);
  if (!lastId) return null;
  return (
    <button className="pinned-bar" onClick={onOpen}>
      <Pin size={14} />
      <span className="pinned-label">{ids.length > 1 ? tr("Закреплено: {0}", ids.length) : tr("Закреплено")}</span>
      <span className="pinned-text">{ev ? plainText(ev) : "…"}</span>
    </button>
  );
}

