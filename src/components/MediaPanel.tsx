// Панель «Медиа и файлы»: всё, что присылали в чат, по вкладкам — как в Telegram.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { CornerUpLeft, Download, FileText, Image as ImageIcon, LoaderCircle, Play } from "lucide-react";
import { MediaScanner, type MediaItem, type MediaKind } from "../roomMedia";
import { AudioMessage, loadBlobUrl, openViewer, saveContent } from "./Media";
import { PanelHead } from "./Panels";
import { thumbnailUrl } from "../media";
import { formatSize } from "../attachments";
import { listTime, timeHM } from "../format";
import { openExternal } from "../widgets";
import { htmlToText } from "../richtext";
import { locale, tr } from "../i18n";
import { notice } from "./Ask";

const TABS: Array<{ id: MediaKind; label: string; empty: string }> = [
  { id: "media", label: tr("Медиа"), empty: tr("Фото и видео в этом чате пока нет") },
  { id: "files", label: tr("Файлы"), empty: tr("Файлов в этом чате пока нет") },
  { id: "links", label: tr("Ссылки"), empty: tr("Ссылок в этом чате пока нет") },
  { id: "audio", label: tr("Аудио"), empty: tr("Аудио и голосовых в этом чате пока нет") },
];

/** «Октябрь 2026» — заголовки групп по месяцам. */
function monthLabel(ts: number): string {
  const d = new Date(ts);
  const m = d.toLocaleDateString(locale, { month: "long" }); // «октябрь» — в именительном падеже
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
}

function byMonth(items: MediaItem[]): Array<[string, MediaItem[]]> {
  const out: Array<[string, MediaItem[]]> = [];
  for (const it of items) {
    const m = monthLabel(it.ts);
    if (out.at(-1)?.[0] === m) out.at(-1)![1].push(it);
    else out.push([m, [it]]);
  }
  return out;
}

/** Загружать картинку, только когда плитка появилась на экране. */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}

/** Миниатюра: готовая из сообщения, серверная или (в шифрованных чатах) сама картинка. */
function Thumb({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const [ref, visible] = useVisible<HTMLSpanElement>();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const info = content.info ?? {};
    const image = content.msgtype === "m.image";
    const p = info.thumbnail_file
      ? loadBlobUrl(client, { file: info.thumbnail_file, info: { mimetype: info.thumbnail_info?.mimetype } })
      : info.thumbnail_url
        ? thumbnailUrl(client, info.thumbnail_url, 320)
        : image && content.url
          ? thumbnailUrl(client, content.url, 320)
          : image
            ? loadBlobUrl(client, content)
            : null;
    if (!p) setFailed(true);
    else
      p.then(
        (u) => alive && setSrc(u),
        () => alive && setFailed(true),
      );
    return () => {
      alive = false;
    };
  }, [visible, client, content]);
  return (
    <span ref={ref} className="tile-img">
      {src ? <img src={src} alt="" draggable={false} /> : failed ? <ImageIcon size={22} /> : null}
    </span>
  );
}

function duration(ms?: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "";
}

function JumpBtn({ onJump }: { onJump: () => void }) {
  return (
    <button
      className="icon-btn small media-jump"
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      title={tr("Показать в чате")}
      aria-label={tr("Показать в чате")}
    >
      <CornerUpLeft size={15} />
    </button>
  );
}

function FileRow({ client, room, item, onJump }: { client: MatrixClient; room: Room; item: MediaItem; onJump: () => void }) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const c = item.content;
  const name = String(c.filename ?? c.body ?? tr("Файл"));
  const who = room.getMember(item.sender)?.name ?? item.sender;
  const save = async () => {
    setState("saving");
    try {
      await saveContent(client, c);
      setState("done");
    } catch (e) {
      setState("idle");
      notice(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="media-row">
      <button className="media-row-main" onClick={save} disabled={state === "saving"} title={tr("Сохранить в «Загрузки»")}>
        <span className="file-badge">{state === "saving" ? <LoaderCircle size={18} className="spin" /> : extOf(name) || <FileText size={18} />}</span>
        <span className="media-row-text">
          <span className="media-row-title">{name}</span>
          <span className="media-row-meta">
            {state === "done" ? tr("Сохранено в «Загрузки»") : [formatSize(c.info?.size), who, listTime(item.ts)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <Download size={15} className="media-row-dl" />
      </button>
      <JumpBtn onJump={onJump} />
    </div>
  );
}

function LinkRow({ room, item, onJump }: { room: Room; item: MediaItem; onJump: () => void }) {
  const who = room.getMember(item.sender)?.name ?? item.sender;
  // текст сообщения без Markdown-разметки и без цитаты ответа
  const c = item.content;
  const text =
    c.format === "org.matrix.custom.html" && typeof c.formatted_body === "string"
      ? htmlToText(c.formatted_body)
      : String(c.body ?? "")
          .split("\n")
          .filter((l) => !l.startsWith("> "))
          .join(" ");
  return (
    <>
      {item.urls!.map((url) => {
        let host = url;
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          /* оставим как есть */
        }
        const rest = text.replace(url, "").replace(/\s+/g, " ").trim();
        return (
          <div className="media-row" key={url}>
            <button className="media-row-main" onClick={() => openExternal(url)} title={url}>
              <span className="link-badge">{host.charAt(0).toUpperCase()}</span>
              <span className="media-row-text">
                <span className="media-row-title">{host}</span>
                <span className="media-row-url">{url}</span>
                {rest && <span className="media-row-note">{rest}</span>}
                <span className="media-row-meta">{[who, listTime(item.ts)].join(" · ")}</span>
              </span>
            </button>
            <JumpBtn onJump={onJump} />
          </div>
        );
      })}
    </>
  );
}

export default function MediaPanel({
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
  const scanner = useMemo(() => new MediaScanner(client, room), [client, room]);
  const [tab, setTab] = useState<MediaKind>("media");
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = () => {
    if (scanner.done) return;
    setLoading(true);
    setError(null);
    scanner
      .more(tab)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setLoading(false);
        bump();
      });
  };

  // первая порция и догрузка при прокрутке к концу списка
  useEffect(() => {
    load();
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && load(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner, tab]);

  // новое и удалённое — пока панель открыта
  useEffect(() => {
    const onTimeline = (ev: MatrixEvent, r: Room | undefined, toStart: boolean | undefined) => {
      if (r?.roomId === room.roomId && !toStart && scanner.addLive(ev)) bump();
    };
    const onRedaction = (ev: MatrixEvent) => {
      const id = ev.event.redacts ?? ev.getContent().redacts;
      if (id && scanner.remove(id)) bump();
    };
    const onDecrypted = (ev: MatrixEvent) => ev.getRoomId() === room.roomId && scanner.addLive(ev) && bump();
    room.on(RoomEvent.Timeline, onTimeline);
    room.on(RoomEvent.Redaction, onRedaction);
    client.on("Event.decrypted" as never, onDecrypted as never);
    return () => {
      room.off(RoomEvent.Timeline, onTimeline);
      room.off(RoomEvent.Redaction, onRedaction);
      client.off("Event.decrypted" as never, onDecrypted as never);
    };
  }, [client, room, scanner]);

  const items = scanner.items.filter((i) => i.kind === tab);
  const media = tab === "media" ? items.map((i) => i.content) : [];
  const groups = byMonth(items);
  const empty = TABS.find((t) => t.id === tab)!.empty;

  return (
    <div className="room-info media-panel">
      <PanelHead title={tr("Медиа и файлы")} onClose={onClose} />
      <div className="media-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="info-body media-body">
        {groups.map(([month, list]) => (
          <section key={month} className="media-group">
            <h4 className="media-month">{month}</h4>
            {tab === "media" ? (
              <div className="media-grid">
                {list.map((it) => {
                  const video = it.content.msgtype === "m.video";
                  return (
                    <div key={it.id} className="media-tile">
                      <button
                        className="tile-open"
                        onClick={() => openViewer(client, media, media.indexOf(it.content), (i) => onJump(items[i].id))}
                        title={`${it.content.body ?? ""} · ${listTime(it.ts)} ${timeHM(it.ts)}`}
                      >
                        <Thumb client={client} content={it.content} />
                        {video && (
                          <span className="tile-video">
                            <Play size={12} fill="currentColor" />
                            {duration(it.content.info?.duration)}
                          </span>
                        )}
                      </button>
                      <JumpBtn onJump={() => onJump(it.id)} />
                    </div>
                  );
                })}
              </div>
            ) : tab === "files" ? (
              list.map((it) => <FileRow key={it.id} client={client} room={room} item={it} onJump={() => onJump(it.id)} />)
            ) : tab === "links" ? (
              list.map((it) => <LinkRow key={it.id} room={room} item={it} onJump={() => onJump(it.id)} />)
            ) : (
              list.map((it) => (
                <div key={it.id} className="media-audio-row">
                  <AudioMessage client={client} content={it.content} />
                  <div className="media-row-meta">
                    {[room.getMember(it.sender)?.name ?? it.sender, listTime(it.ts)].join(" · ")}
                    <JumpBtn onJump={() => onJump(it.id)} />
                  </div>
                </div>
              ))
            )}
          </section>
        ))}
        {!loading && !error && scanner.done && items.length === 0 && <div className="panel-empty">{empty}</div>}
        {error && (
          <div className="panel-empty">
            {tr("Не удалось загрузить историю: {0}", error)}{" "}
            <button className="link-btn" onClick={load}>
              {tr("Повторить")}
            </button>
          </div>
        )}
        {loading && (
          <div className="panel-empty">
            <LoaderCircle size={18} className="spin" />
          </div>
        )}
        {!loading && !error && !scanner.done && items.length > 0 && (
          <button className="load-more" onClick={load}>
            {tr("Показать ещё")}
          </button>
        )}
        {!loading && !error && !scanner.done && items.length === 0 && (
          <div className="panel-empty">
            {tr("В последних сообщениях ничего не нашлось.")}{" "}
            <button className="link-btn" onClick={load}>
              {tr("Искать дальше")}
            </button>
          </div>
        )}
        <div ref={sentinel} className="media-sentinel" />
      </div>
    </div>
  );
}
