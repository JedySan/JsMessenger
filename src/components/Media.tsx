import { useEffect, useState, useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { ChevronLeft, ChevronRight, CornerUpLeft, Download, FileText, ImageOff, LoaderCircle, Play, X } from "lucide-react";
import { downloadMedia, formatSize, saveToDownloads } from "../attachments";
import { tr } from "../i18n";
import { notice } from "./Ask";

// ---------- общая загрузка с кэшем ----------
const blobCache = new Map<string, Promise<string>>();

function cacheKey(content: Record<string, any>): string {
  return content.file?.url ?? content.url ?? "";
}

export function loadBlobUrl(client: MatrixClient, content: Record<string, any>): Promise<string> {
  const key = cacheKey(content);
  let p = blobCache.get(key);
  if (!p) {
    p = downloadMedia(client, content).then((b) => URL.createObjectURL(b));
    p.catch(() => blobCache.delete(key));
    blobCache.set(key, p);
  }
  return p;
}

export function useBlobUrl(client: MatrixClient, content: Record<string, any>, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setUrl(null);
    setError(false);
    if (!enabled) return;
    let alive = true;
    loadBlobUrl(client, content).then(
      (u) => alive && setUrl(u),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [client, cacheKey(content), enabled]);
  return { url, error };
}

export async function saveContent(client: MatrixClient, content: Record<string, any>) {
  const blob = await downloadMedia(client, content);
  await saveToDownloads(content.filename ?? content.body ?? "file", blob);
}

// ---------- просмотр фото и видео на всё окно (с листанием, как в Telegram) ----------
type Viewing = { client: MatrixClient; items: Record<string, any>[]; index: number; onJump?: (index: number) => void } | null;
let viewing: Viewing = null;
const viewers = new Set<() => void>();
function setViewing(v: Viewing) {
  viewing = v;
  viewers.forEach((f) => f());
}

/** Открыть просмотр: список фото/видео и с какого начать. */
export function openViewer(client: MatrixClient, items: Record<string, any>[], index = 0, onJump?: (index: number) => void) {
  setViewing({ client, items, index, onJump });
}

export function Lightbox() {
  const v = useSyncExternalStore(
    (f) => {
      viewers.add(f);
      return () => viewers.delete(f);
    },
    () => viewing,
  );
  const [saving, setSaving] = useState(false);
  const content = v ? v.items[v.index] : null;
  const isVideo = content?.msgtype === "m.video";
  const { url, error } = useBlobUrl(v?.client as MatrixClient, content ?? {}, !!v);
  const go = (d: number) => {
    if (!v) return;
    const i = v.index + d;
    if (i >= 0 && i < v.items.length) setViewing({ ...v, index: i });
  };

  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewing(null);
      // список идёт от новых к старым: «влево» — более старое
      else if (e.key === "ArrowLeft") go(1);
      else if (e.key === "ArrowRight") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!v || !content) return null;
  const save = async () => {
    setSaving(true);
    try {
      await saveContent(v.client, content);
    } catch (e) {
      notice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const many = v.items.length > 1;
  return (
    <div className="lightbox" onClick={() => setViewing(null)}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{content.body}</span>
        {many && <span className="lightbox-count">{tr("{0} из {1}", v.items.length - v.index, v.items.length)}</span>}
        {v.onJump && (
          <button
            className="icon-btn light"
            onClick={() => {
              const i = v.index;
              setViewing(null);
              v.onJump!(i);
            }}
            title={tr("Показать в чате")}
            aria-label={tr("Показать в чате")}
          >
            <CornerUpLeft size={18} />
          </button>
        )}
        <button className="icon-btn light" onClick={save} disabled={saving} title={tr("Сохранить в «Загрузки»")} aria-label={tr("Сохранить")}>
          {saving ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
        </button>
        <button className="icon-btn light" onClick={() => setViewing(null)} title={tr("Закрыть (Esc)")} aria-label={tr("Закрыть")}>
          <X size={20} />
        </button>
      </div>
      {many && v.index < v.items.length - 1 && (
        <button className="lightbox-nav prev" onClick={(e) => (e.stopPropagation(), go(1))} aria-label={tr("Предыдущее")}>
          <ChevronLeft size={28} />
        </button>
      )}
      {many && v.index > 0 && (
        <button className="lightbox-nav next" onClick={(e) => (e.stopPropagation(), go(-1))} aria-label={tr("Следующее")}>
          <ChevronRight size={28} />
        </button>
      )}
      {error ? (
        <span className="lightbox-msg">
          <ImageOff size={18} /> {tr("Не удалось загрузить")}
        </span>
      ) : !url ? (
        <LoaderCircle size={32} className="spin lightbox-msg" />
      ) : isVideo ? (
        <video key={url} src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url} alt={content.body ?? ""} onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

// ---------- типы сообщений ----------
function boxFor(content: Record<string, any>, max = 360) {
  const w = content.info?.w as number | undefined;
  const h = content.info?.h as number | undefined;
  if (!w || !h) return { width: 260, height: 180 };
  const scale = Math.min(1, max / w, 320 / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function ImageMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const { url, error } = useBlobUrl(client, content);
  const box = boxFor(content);
  if (error)
    return (
      <span className="msg-locked">
        <ImageOff size={14} /> {tr("Не удалось загрузить изображение")}
      </span>
    );
  if (!url) return <span className="media-box loading" style={box} />;
  return (
    <button className="media-box" style={box} onClick={() => openViewer(client, [content])} title={tr("Открыть")}>
      <img src={url} alt={content.body ?? ""} />
    </button>
  );
}

/** Видео грузим только по нажатию — файлы бывают большими. */
export function VideoMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const [start, setStart] = useState(false);
  const { url, error } = useBlobUrl(client, content, start);
  const box = boxFor(content);
  if (error) return <FileMessage client={client} content={content} />;
  if (!start || !url)
    return (
      <button className="media-box video-poster" style={box} onClick={() => setStart(true)}>
        <span className="play">{start ? <LoaderCircle size={24} className="spin" /> : <Play size={24} />}</span>
        <span className="video-meta">
          {content.body}
          {content.info?.size ? `, ${formatSize(content.info.size)}` : ""}
        </span>
      </button>
    );
  return <video className="media-video" style={box} src={url} controls autoPlay />;
}

export function AudioMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const [start, setStart] = useState(false);
  const { url, error } = useBlobUrl(client, content, start);
  if (error) return <FileMessage client={client} content={content} />;
  if (!start || !url)
    return (
      <button className="file-card" onClick={() => setStart(true)}>
        <span className="file-icon">{start ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}</span>
        <span className="file-text">
          <span className="file-name">{content.body}</span>
          <span className="file-size">{tr("Аудио")}{content.info?.size ? `, ${formatSize(content.info.size)}` : ""}</span>
        </span>
      </button>
    );
  return <audio className="media-audio" src={url} controls autoPlay />;
}

export function FileMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const save = async () => {
    setState("saving");
    try {
      await saveContent(client, content);
      setState("done");
    } catch (e) {
      console.error(e);
      setState("error");
    }
  };
  const name = content.filename ?? content.body ?? tr("Файл");
  const note =
    state === "saving"
      ? tr("Скачиваю…")
      : state === "done"
        ? tr("Сохранено в «Загрузки»")
        : state === "error"
          ? tr("Не удалось скачать, попробуйте ещё раз")
          : formatSize(content.info?.size);
  return (
    <button className="file-card" onClick={save} disabled={state === "saving"} title={tr("Сохранить в «Загрузки»")}>
      <span className="file-icon">
        <FileText size={18} />
      </span>
      <span className="file-text">
        <span className="file-name">{name}</span>
        <span className={"file-size" + (state === "error" ? " err" : "")}>{note}</span>
      </span>
      <span className="file-dl">{state === "saving" ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}</span>
    </button>
  );
}
