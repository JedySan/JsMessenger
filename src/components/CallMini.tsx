import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Track, type Participant, type TrackPublication } from "livekit-client";
import { Maximize2, Mic, MicOff, MonitorUp, PhoneOff, PictureInPicture2, Shrink, Expand } from "lucide-react";
import { call, userIdFromIdentity } from "../call";
import { useCallState } from "./CallPanel";
import Avatar from "./Avatar";

// Мини-окно звонка: появляется, когда вы ушли из чата со звонком.
// Перетаскивается мышью в любое место окна; «Поверх всех окон» — системная «картинка в картинке».

const POS_KEY = "jsm.callmini";
type Size = "s" | "l";
const SIZES: Record<Size, { w: number; h: number }> = { s: { w: 300, h: 169 }, l: { w: 480, h: 270 } };
const MARGIN = 12;

function loadPrefs(): { x: number; y: number; size: Size } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" ? v : null;
  } catch {
    return null;
  }
}
function savePrefs(p: { x: number; y: number; size: Size }) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* не страшно */
  }
}

/** Что показывать: чужой экран → говорящий с камерой → любой с камерой → собеседник без видео. */
function pickView(local: Participant, remotes: Participant[]): { p: Participant; pub?: TrackPublication; screen: boolean } | null {
  const live = (p: Participant, s: Track.Source) => {
    const pub = p.getTrackPublication(s);
    return pub?.track && !pub.isMuted ? pub : undefined;
  };
  for (const p of remotes) {
    const pub = live(p, Track.Source.ScreenShare);
    if (pub) return { p, pub, screen: true };
  }
  const speaking = remotes.filter((p) => p.isSpeaking);
  for (const p of [...speaking, ...remotes]) {
    const pub = live(p, Track.Source.Camera);
    if (pub) return { p, pub, screen: false };
  }
  if (remotes.length) return { p: speaking[0] ?? remotes[0], screen: false };
  return { p: local, screen: false };
}

export default function CallMini({
  client,
  visible,
  onOpen,
}: {
  client: MatrixClient;
  /** показывать ли окно (false, когда открыт сам чат звонка) */
  visible: boolean;
  onOpen: (roomId: string) => void;
}) {
  const st = useCallState();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pip, setPip] = useState(false);
  const prefs = loadPrefs();
  const [size, setSize] = useState<Size>(prefs?.size ?? "s");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(prefs ? { x: prefs.x, y: prefs.y } : null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const connected = !!st && st.status === "connected";
  const lk = st?.lk;
  const room = st ? client.getRoom(st.roomId) : null;
  const view = connected && lk ? pickView(lk.localParticipant, [...lk.remoteParticipants.values()]) : null;
  const track = view?.pub?.track;

  // Видео: один и тот же <video>, меняется только дорожка — так «картинка в картинке» не закрывается
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  // Системная «картинка в картинке»: следим, когда пользователь закрыл её сам
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const on = () => setPip(true);
    const off = () => setPip(false);
    el.addEventListener("enterpictureinpicture", on);
    el.addEventListener("leavepictureinpicture", off);
    return () => {
      el.removeEventListener("enterpictureinpicture", on);
      el.removeEventListener("leavepictureinpicture", off);
    };
  }, [connected]);

  // Звонок закончился — закрываем и системное окно
  useEffect(() => {
    if (!connected && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }, [connected]);

  // Окно приложения уменьшили — не даём мини-окну уехать за край
  const { w, h } = SIZES[size];
  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(MARGIN, x), window.innerWidth - w - MARGIN),
    y: Math.min(Math.max(MARGIN, y), window.innerHeight - h - 44 - MARGIN),
  });
  const [, rerender] = useState(0);
  useEffect(() => {
    const onResize = () => rerender((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!connected || !lk || !room || !view) return null;

  const place = clamp(pos?.x ?? window.innerWidth - w - 24, pos?.y ?? window.innerHeight - h - 44 - 24);
  const canPip = !!document.pictureInPictureEnabled && !!view.pub;
  const micOn = lk.localParticipant.isMicrophoneEnabled;
  const member = room.getMember(userIdFromIdentity(view.p.identity));
  const name = member?.name ?? (view.p.name || userIdFromIdentity(view.p.identity));

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - place.x, dy: e.clientY - place.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) savePrefs({ ...place, size });
    else onOpen(room.roomId); // простой щелчок — вернуться в звонок
  };
  const toggleSize = () => {
    const next: Size = size === "s" ? "l" : "s";
    setSize(next);
    savePrefs({ ...place, size: next });
  };
  const togglePip = () => {
    const el = videoRef.current;
    if (!el) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else el.requestPictureInPicture().catch((e) => console.warn("pip", e));
  };

  // В чате звонка мини-окно не нужно, но если открыта «картинка в картинке» — держим <video> живым
  const hidden = !visible;
  if (hidden && !pip) return null;

  return (
    <div
      className={"call-mini" + (hidden ? " hidden" : "")}
      style={{ left: place.x, top: place.y, width: w }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title="Перетащите в удобное место; щелчок — вернуться в звонок"
    >
      <div className="call-mini-video" style={{ height: h }}>
        {view.pub ? (
          <video ref={videoRef} autoPlay playsInline muted className={view.screen ? "contain" : undefined} />
        ) : (
          <>
            <video ref={videoRef} hidden />
            <Avatar client={client} mxc={member?.getMxcAvatarUrl()} name={name} seed={userIdFromIdentity(view.p.identity)} size={size === "s" ? 56 : 80} />
          </>
        )}
        {pip && <div className="call-mini-pip">Звонок открыт в отдельном окне</div>}
        <div className="call-mini-name">
          {view.screen && <MonitorUp size={12} />}
          {view.screen ? `Экран: ${name}` : name}
        </div>
      </div>
      <div className="call-mini-bar">
        <span className="call-mini-room">{room.name}</span>
        <button
          className={"mini-btn" + (micOn ? "" : " off")}
          onClick={() => lk.localParticipant.setMicrophoneEnabled(!micOn).catch((e) => call.mediaFailed(lk, "mic", e))}
          title={micOn ? "Выключить микрофон" : "Включить микрофон"}
          aria-label={micOn ? "Выключить микрофон" : "Включить микрофон"}
        >
          {micOn ? <Mic size={15} /> : <MicOff size={15} />}
        </button>
        {canPip && (
          <button className={"mini-btn" + (pip ? " active" : "")} onClick={togglePip} title="Поверх всех окон" aria-label="Поверх всех окон">
            <PictureInPicture2 size={15} />
          </button>
        )}
        <button className="mini-btn" onClick={toggleSize} title={size === "s" ? "Крупнее" : "Мельче"} aria-label={size === "s" ? "Крупнее" : "Мельче"}>
          {size === "s" ? <Expand size={15} /> : <Shrink size={15} />}
        </button>
        <button className="mini-btn" onClick={() => onOpen(room.roomId)} title="Вернуться в звонок" aria-label="Вернуться в звонок">
          <Maximize2 size={15} />
        </button>
        <button className="mini-btn hangup" onClick={() => call.leave()} title="Завершить звонок" aria-label="Завершить звонок">
          <PhoneOff size={15} />
        </button>
      </div>
    </div>
  );
}
