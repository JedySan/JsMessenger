import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type React from "react";
import { canPlayOgg, formatDuration, oggToWav, waveFromContent } from "../voice";
import type { MatrixClient } from "matrix-js-sdk";
import { ChevronLeft, ChevronRight, CornerUpLeft, Download, FileText, FolderInput, FolderOpen, ImageOff, LoaderCircle, Pause, Play, X } from "lucide-react";
import { downloadMedia, formatSize } from "../attachments";
import { canOpenFiles, canSaveAs, download, fileName, openDownloaded, revealDownloaded, useDownload } from "../downloads";
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

/** Скачать в «Загрузки» (или выбрать место); ошибки — сообщением. */
export async function saveContent(client: MatrixClient, content: Record<string, any>, saveAs = false) {
  try {
    return await download(client, content, saveAs);
  } catch (e) {
    notice(tr("Не удалось скачать: {0}", e instanceof Error ? e.message : String(e)));
    return undefined;
  }
}

/** Открыть скачанный файл; если его уже нет — сказать об этом. */
export async function openSaved(content: Record<string, any>) {
  if (!(await openDownloaded(content))) notice(tr("Файл не найден — возможно, его удалили или переместили. Скачайте заново"));
}
export async function revealSaved(content: Record<string, any>) {
  if (!(await revealDownloaded(content))) notice(tr("Файл не найден — возможно, его удалили или переместили. Скачайте заново"));
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
  const save = async (saveAs = false) => {
    setSaving(true);
    try {
      await saveContent(v.client, content, saveAs);
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
        <LightboxSave client={v.client} content={content} busy={saving} onSave={save} />
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

/** Кнопки просмотрщика: сохранить → затем «Показать в папке»; «Сохранить как…». */
function LightboxSave({
  content,
  busy,
  onSave,
}: {
  client: MatrixClient;
  content: Record<string, any>;
  busy: boolean;
  onSave: (saveAs?: boolean) => void;
}) {
  const st = useDownload(content);
  const loading = busy || st.status === "loading";
  const saved = st.status === "done" && !!st.path && canOpenFiles();
  return (
    <>
      {saved ? (
        <button className="icon-btn light" onClick={() => void revealSaved(content)} title={tr("Показать в папке")} aria-label={tr("Показать в папке")}>
          <FolderOpen size={18} />
        </button>
      ) : (
        <button className="icon-btn light" onClick={() => onSave(false)} disabled={loading} title={tr("Сохранить в «Загрузки»")} aria-label={tr("Сохранить")}>
          {loading ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
        </button>
      )}
      {canSaveAs() && (
        <button className="icon-btn light" onClick={() => onSave(true)} disabled={loading} title={tr("Сохранить как…")} aria-label={tr("Сохранить как…")}>
          <FolderInput size={18} />
        </button>
      )}
    </>
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

/** Голосовое: кнопка, «волна» (нажать — перемотать), время, скорость 1×/1,5×/2×. */
export function VoiceMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const BARS = 40;
  const wave = useMemo(() => waveFromContent(content, BARS), [content]);
  const total = (Number(content["org.matrix.msc1767.audio"]?.duration ?? content.info?.duration) || 0) / 1000;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(total);
  const [rate, setRate] = useState(1);

  useEffect(() => () => audio.current?.pause(), []);

  const ensure = async (): Promise<HTMLAudioElement | null> => {
    if (audio.current) return audio.current;
    setState("loading");
    try {
      let url = await loadBlobUrl(client, content);
      const mime = String(content.info?.mimetype ?? content.file?.mimetype ?? "");
      // старый Safari (WebView macOS) не играет Ogg — раскодируем сами
      if (/ogg|opus/i.test(mime) && !canPlayOgg()) {
        const ogg = await (await fetch(url)).arrayBuffer();
        url = URL.createObjectURL(await oggToWav(ogg));
      }
      const a = new Audio(url);
      a.playbackRate = rate;
      a.ontimeupdate = () => setPos(a.currentTime);
      a.onloadedmetadata = () => Number.isFinite(a.duration) && a.duration > 0 && setDur(a.duration);
      a.onended = () => {
        setState("paused");
        setPos(0);
      };
      a.onpause = () => !a.ended && setState("paused");
      a.onplay = () => setState("playing");
      audio.current = a;
      return a;
    } catch (e) {
      console.error("voice", e);
      setState("error");
      return null;
    }
  };

  const toggle = async () => {
    const a = await ensure();
    if (!a) return;
    if (a.paused) {
      // одновременно играет только одно голосовое
      document.dispatchEvent(new CustomEvent("jsm-voice-play", { detail: a }));
      await a.play().catch(() => setState("error"));
    } else a.pause();
  };
  useEffect(() => {
    const other = (e: Event) => {
      const a = audio.current;
      if (a && (e as CustomEvent).detail !== a && !a.paused) a.pause();
    };
    document.addEventListener("jsm-voice-play", other);
    return () => document.removeEventListener("jsm-voice-play", other);
  }, []);

  const seek = async (e: React.MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const a = await ensure();
    if (!a) return;
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : dur;
    a.currentTime = frac * d;
    setPos(a.currentTime);
    if (a.paused) void toggle();
  };
  const nextRate = () => {
    const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(r);
    if (audio.current) audio.current.playbackRate = r;
  };

  const progress = dur ? pos / dur : 0;
  if (state === "error") return <FileMessage client={client} content={content} />;
  return (
    <div className={"voice-msg" + (state === "playing" ? " playing" : "")}>
      <button className="voice-play" onClick={() => void toggle()} aria-label={state === "playing" ? tr("Пауза") : tr("Слушать")}>
        {state === "loading" ? <LoaderCircle size={18} className="spin" /> : state === "playing" ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <span className="voice-wave" onClick={(e) => void seek(e)} role="slider" aria-label={tr("Перемотка")} aria-valuenow={Math.round(pos)} aria-valuemax={Math.round(dur)}>
        {wave.map((h, i) => (
          <i key={i} className={(i + 0.5) / wave.length <= progress ? "on" : ""} style={{ height: `${Math.round(h * 100)}%` }} />
        ))}
      </span>
      <span className="voice-time">{formatDuration(state === "playing" || pos > 0 ? pos : dur)}</span>
      <button className="voice-rate" onClick={nextRate} title={tr("Скорость")}>
        {rate === 1.5 ? "1,5×" : `${rate}×`}
      </button>
    </div>
  );
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

/** Расширение для значка: «PDF», «ZIP»… */
export function fileExt(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "";
}

/** Файл в сообщении: скачать (с прогрессом) → открыть, показать в папке. */
export function FileMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const st = useDownload(content);
  const name = fileName(content);
  const ext = fileExt(name);
  const size = formatSize(content.info?.size);
  const done = st.status === "done";
  const openable = done && canOpenFiles() && !!st.path;
  const main = () => {
    if (st.status === "loading") return;
    if (openable) void openSaved(content);
    else void saveContent(client, content);
  };
  const pct = st.status === "loading" && st.progress != null ? Math.round(st.progress * 100) : null;
  const note =
    st.status === "loading"
      ? pct != null
        ? tr("Скачиваю… {0}%", pct) + (size ? ` · ${size}` : "")
        : tr("Скачиваю…")
      : st.status === "error"
        ? tr("Не удалось скачать — нажмите, чтобы повторить")
        : done
          ? openable
            ? tr("Скачано · нажмите, чтобы открыть")
            : tr("Скачано")
          : size;
  return (
    <div className={"file-card file-box" + (done ? " done" : "")}>
      <button
        className="file-main"
        onClick={main}
        title={openable ? tr("Открыть") : tr("Скачать в «Загрузки»")}
        aria-busy={st.status === "loading"}
      >
        <span className="file-icon" style={pct != null ? ({ ["--p" as string]: `${pct}%` } as CSSProperties) : undefined}>
          {st.status === "loading" ? (
            <span className={"file-ring" + (pct == null ? " spin" : "")} />
          ) : ext ? (
            <span className="file-ext">{ext}</span>
          ) : (
            <FileText size={18} />
          )}
        </span>
        <span className="file-text">
          <span className="file-name">{name}</span>
          <span className={"file-size" + (st.status === "error" ? " err" : "")}>{note}</span>
        </span>
      </button>
      <span className="file-side">
        {openable ? (
          <button className="icon-btn small" onClick={() => void revealSaved(content)} title={tr("Показать в папке")} aria-label={tr("Показать в папке")}>
            <FolderOpen size={16} />
          </button>
        ) : st.status !== "loading" ? (
          <button className="icon-btn small" onClick={main} title={tr("Скачать в «Загрузки»")} aria-label={tr("Скачать")}>
            <Download size={16} />
          </button>
        ) : null}
        {canSaveAs() && st.status !== "loading" && (
          <button className="icon-btn small" onClick={() => void saveContent(client, content, true)} title={tr("Сохранить как…")} aria-label={tr("Сохранить как…")}>
            <FolderInput size={16} />
          </button>
        )}
      </span>
    </div>
  );
}
