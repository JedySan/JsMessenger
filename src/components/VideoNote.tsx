// Кружочки: запись (окно с круглым предпросмотром) и показ в ленте.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MatrixClient } from "matrix-js-sdk";
import { LoaderCircle, SendHorizontal, SwitchCamera, Trash2, Volume2 } from "lucide-react";
import { MAX_NOTE_SECONDS, VideoNoteRecorder, type NoteResult } from "../videonote";
import { formatDuration } from "../voice";
import { useBlobUrl } from "./Media";
import { isMobile } from "../platform";
import { tr } from "../i18n";

const R = 47; // радиус кольца прогресса в viewBox 0..100
const C = 2 * Math.PI * R;

/** Окно записи: сразу пишет; «Отправить» — готово, корзина или Esc — отмена. */
export function VideoNoteDialog({ onSend, onClose }: { onSend: (r: NoteResult) => Promise<void>; onClose: () => void }) {
  const [rec] = useState(() => new VideoNoteRecorder());
  const [sec, setSec] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirror, setMirror] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  const finish = async () => {
    if (done.current) return;
    done.current = true;
    setBusy(true);
    try {
      const r = await rec.stop();
      if (r.durationMs < 800) return onClose(); // случайное нажатие
      await onSend(r);
      onClose();
    } catch (e) {
      setError(tr("Не удалось отправить: {0}", String((e as Error)?.message ?? e)));
      setBusy(false);
    }
  };
  const cancel = () => {
    done.current = true;
    rec.cancel();
    onClose();
  };

  useEffect(() => {
    let timer = 0;
    rec.start().then(
      () => {
        if (done.current) return rec.cancel();
        if (videoRef.current) videoRef.current.srcObject = rec.preview;
        setReady(true);
        timer = window.setInterval(() => {
          const s = rec.seconds;
          setSec(s);
          if (s >= MAX_NOTE_SECONDS) void finish();
        }, 100);
      },
      (e) => setError(tr("Нет доступа к камере или микрофону: {0}", String(e?.message ?? e))),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter") void finish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
      if (!done.current) rec.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flip = async () => {
    await rec.flip().catch(() => {});
    if (videoRef.current) videoRef.current.srcObject = rec.preview;
    setMirror(rec.mirrored);
  };

  return createPortal(
    <div className="vn-overlay" role="dialog" aria-label={tr("Видеосообщение")}>
      <div className="vn-stage">
        <div className="vn-circle">
          <video ref={videoRef} autoPlay muted playsInline className={mirror ? "mirror" : ""} />
          {!ready && !error && <LoaderCircle size={30} className="spin vn-wait" />}
          <svg viewBox="0 0 100 100" className="vn-ring" aria-hidden>
            <circle cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, sec / MAX_NOTE_SECONDS))} />
          </svg>
        </div>
        {error ? (
          <p className="vn-error">{error}</p>
        ) : (
          <div className="vn-time">
            <span className="rec-dot" aria-hidden /> {formatDuration(sec)} / {formatDuration(MAX_NOTE_SECONDS)}
          </div>
        )}
        <div className="vn-actions">
          <button className="vn-btn" onClick={cancel} disabled={busy} aria-label={tr("Отменить")} title={tr("Отменить (Esc)")}>
            <Trash2 size={22} />
          </button>
          {isMobile() && (
            <button className="vn-btn" onClick={() => void flip()} disabled={busy || !ready} aria-label={tr("Сменить камеру")}>
              <SwitchCamera size={22} />
            </button>
          )}
          <button className="vn-btn send" onClick={() => void finish()} disabled={busy || !ready} aria-label={tr("Отправить")} title={tr("Отправить (Enter)")}>
            {busy ? <LoaderCircle size={22} className="spin" /> : <SendHorizontal size={22} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Кружок в ленте: беззвучно по кругу, нажатие — со звуком с начала, ещё нажатие — пауза. */
export function VideoNoteMessage({ client, content }: { client: MatrixClient; content: Record<string, any> }) {
  const box = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [sound, setSound] = useState(false);
  const [progress, setProgress] = useState(0);
  const { url, error } = useBlobUrl(client, content, visible);

  // грузим, только когда кружок на экране
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (!sound) {
      v.muted = false;
      v.loop = false;
      v.currentTime = 0;
      void v.play().catch(() => {});
      setSound(true);
    } else if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const backToLoop = () => {
    const v = video.current;
    if (!v) return;
    setSound(false);
    setProgress(0);
    v.muted = true;
    v.loop = true;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };

  const dur = Number(content.info?.duration) || 0;
  return (
    <button ref={box} className={"vn-msg" + (sound ? " playing" : "")} onClick={toggle} title={tr("Видеосообщение")}>
      {url && (
        <video
          ref={video}
          src={url}
          autoPlay
          muted
          loop
          playsInline
          onTimeUpdate={(e) => sound && setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
          onEnded={backToLoop}
        />
      )}
      {!url && !error && <LoaderCircle size={26} className="spin vn-wait" />}
      {error && <span className="vn-wait">{tr("Не удалось загрузить")}</span>}
      {sound && (
        <svg viewBox="0 0 100 100" className="vn-ring" aria-hidden>
          <circle cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
      )}
      <span className="vn-badge">
        {!sound && <Volume2 size={12} />}
        {formatDuration((sound ? progress * (dur / 1000 || 0) : dur / 1000) || 0)}
      </span>
    </button>
  );
}
