import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import {
  LockKeyhole,
  Maximize2,
  Mic,
  Minimize2,
  MicOff,
  MonitorUp,
  PhoneOff,
  TriangleAlert,
  Video as Video_,
  VideoOff,
  X,
} from "lucide-react";
import Avatar from "./Avatar";
import { Track, type Participant, type TrackPublication } from "livekit-client";
import { call, userIdFromIdentity } from "../call";
import { setWindowFullscreen } from "../desktop";

export function useCallState() {
  return useSyncExternalStore(
    (fn) => call.subscribe(fn),
    () => call.state,
  );
}

/** Собеседник в личном чате. */
function otherOf(client: MatrixClient, room: Room) {
  return room.getJoinedMembers().find((m) => m.userId !== client.getSafeUserId()) ?? null;
}

/** Панель активного звонка: плитки участников и управление. */
export default function CallPanel({ client, room }: { client: MatrixClient; room: Room }) {
  const st = useCallState();
  // Что развёрнуто на весь экран: «identity|screen» или «identity|cam»
  const [full, setFull] = useState<string | null>(null);
  const open = (key: string) => {
    setFull(key);
    setWindowFullscreen(true);
  };
  const close = () => {
    setFull(null);
    setWindowFullscreen(false);
  };
  // Esc — выйти из полноэкранного режима
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  // Звонок закончился — вернуть окно из полноэкранного режима
  const live = !!st && st.roomId === room.roomId && st.status === "connected";
  useEffect(() => {
    if (!live && full) close();
  }, [live, full]);
  if (!st || st.roomId !== room.roomId) return null;

  if (st.status === "ended") {
    return (
      <div className="call-error ended">
        <PhoneOff size={16} />
        <span className="call-error-text">{st.error}</span>
        <button className="pill" onClick={() => call.dismiss()}>
          Закрыть
        </button>
      </div>
    );
  }

  if (st.status === "error") {
    return (
      <div className="call-error">
        <TriangleAlert size={16} />
        <span className="call-error-text">Не удалось подключиться к звонку. {st.error}</span>
        <button className="pill" onClick={() => call.dismiss()}>
          Закрыть
        </button>
      </div>
    );
  }

  const lk = st.lk;
  const local = lk.localParticipant;
  const participants: Participant[] = [local, ...lk.remoteParticipants.values()];
  const memberOf = (p: Participant) => room.getMember(userIdFromIdentity(p.identity));
  const nameOf = (p: Participant) => memberOf(p)?.name ?? (p.name || userIdFromIdentity(p.identity));

  // Демонстрации экрана показываем отдельными крупными плитками
  const screens = participants.flatMap((p) => {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    return pub?.track && !pub.isMuted ? [{ p, pub }] : [];
  });

  // Все «картинки» звонка: экраны и камеры — их можно развернуть
  const views: View[] = [
    ...screens.map(({ p, pub }) => ({ key: `${p.identity}|screen`, p, pub, label: `Экран: ${nameOf(p)}`, screen: true })),
    ...participants.map((p) => {
      const cam = p.getTrackPublication(Track.Source.Camera);
      return {
        key: `${p.identity}|cam`,
        p,
        pub: cam?.track && !cam.isMuted ? cam : undefined,
        label: nameOf(p) + (p === local ? " (вы)" : ""),
        screen: false,
      };
    }),
  ];
  const fullView = full ? views.find((v) => v.key === full) : undefined;
  const avatarOf = (p: Participant, size: number) => (
    <Avatar client={client} mxc={memberOf(p)?.getMxcAvatarUrl()} name={nameOf(p)} seed={userIdFromIdentity(p.identity)} size={size} />
  );
  const expandBtn = (key: string) => (
    <button
      className="tile-expand"
      onClick={(e) => {
        e.stopPropagation();
        open(key);
      }}
      title="На весь экран"
      aria-label="На весь экран"
    >
      <Maximize2 size={15} />
    </button>
  );

  const ready = st.status === "connected";
  // показ экрана есть не везде (например, в Android WebView его нет)
  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const micOn = local.isMicrophoneEnabled;
  const camOn = local.isCameraEnabled;
  const shareOn = local.isScreenShareEnabled;

  const controls = (
      <div className="call-controls">
      <div className="call-info">
        {st.encrypted ? <LockKeyhole size={13} /> : null}
        {st.encrypted ? "Звонок зашифрован" : "Звонок без шифрования"}
      </div>
      <div className="call-buttons-row">
        <CtrlButton
          on={micOn}
          disabled={!ready}
          onClick={() => local.setMicrophoneEnabled(!micOn).then(() => call.clearMediaError(), (e) => call.mediaFailed(lk, "mic", e))}
          label={micOn ? "Выключить микрофон" : "Включить микрофон"}
          icon={micOn ? <Mic size={20} /> : <MicOff size={20} />}
        />
        <CtrlButton
          on={camOn}
          disabled={!ready}
          onClick={() => local.setCameraEnabled(!camOn).then(() => call.clearMediaError(), (e) => call.mediaFailed(lk, "cam", e))}
          label={camOn ? "Выключить камеру" : "Включить камеру"}
          icon={camOn ? <Video_ size={20} /> : <VideoOff size={20} />}
        />
        {canShare && (
        <CtrlButton
          on={!shareOn}
          active={shareOn}
          disabled={!ready}
          onClick={() => local.setScreenShareEnabled(!shareOn, { audio: false }).catch(alertErr)}
          label={shareOn ? "Остановить показ экрана" : "Показать экран"}
          icon={<MonitorUp size={20} />}
        />
        )}
        <button className="ctrl hangup" onClick={() => call.leave()} title="Завершить звонок" aria-label="Завершить звонок">
          <PhoneOff size={20} />
        </button>
      </div>
      <div className="call-info right">
        {participants.length} {participants.length === 1 ? "участник" : participants.length < 5 ? "участника" : "участников"}
      </div>
    </div>
  );

  const mediaBanner = st.mediaError ? (
    <div className="call-media-error">
      <MicOff size={15} />
      <span>{st.mediaError}</span>
      <button className="call-full-btn" onClick={() => call.clearMediaError()} aria-label="Скрыть">
        <X size={15} />
      </button>
    </div>
  ) : null;

  return (
    <div className="call-panel">
      {mediaBanner}
      {!ready ? (
        <div className="call-connecting">Подключаюсь к звонку…</div>
      ) : st.calling ? (
        <div className="call-connecting calling">
          <Avatar client={client} mxc={otherOf(client, room)?.getMxcAvatarUrl()} name={otherOf(client, room)?.name ?? room.name} seed={otherOf(client, room)?.userId ?? room.roomId} size={72} />
          <span className="calling-name">{otherOf(client, room)?.name ?? room.name}</span>
          <span className="calling-hint">Вызов…</span>
        </div>
      ) : (
        <div className={"call-grid" + (screens.length ? " with-screen" : "") + ` n${Math.min(participants.length, 4)}`}>
          {screens.map(({ p, pub }) => (
            <div className="tile screen" key={p.identity + "-screen"} onDoubleClick={() => open(`${p.identity}|screen`)}>
              <Video pub={pub} />
              {expandBtn(`${p.identity}|screen`)}
              <div className="tile-name">
                <MonitorUp size={13} /> Экран: {nameOf(p)}
              </div>
            </div>
          ))}
          {participants.map((p) => {
            const m = memberOf(p);
            return (
              <ParticipantTile
                key={p.identity}
                p={p}
                name={nameOf(p)}
                isLocal={p === local}
                avatar={
                  <Avatar client={client} mxc={m?.getMxcAvatarUrl()} name={nameOf(p)} seed={userIdFromIdentity(p.identity)} size={64} />
                }
                onExpand={() => open(`${p.identity}|cam`)}
              />
            );
          })}
        </div>
      )}

      {controls}
      {full && !fullView && <AutoClose onClose={close} />}
      {fullView && (
        <div className="call-full">
          <div className="call-full-stage" onDoubleClick={close}>
            {fullView.pub ? (
              <Video pub={fullView.pub} mirror={!fullView.screen && fullView.p === local} contain />
            ) : (
              <div className="tile-avatar">{avatarOf(fullView.p, 120)}</div>
            )}
            <div className="call-full-top">
              <span className="call-full-title">
                {fullView.screen && <MonitorUp size={15} />}
                {fullView.label}
              </span>
              <button className="call-full-btn" onClick={close} title="Свернуть (Esc)" aria-label="Свернуть">
                <Minimize2 size={18} />
              </button>
            </div>
          </div>
          {views.length > 1 && (
            <div className="call-full-strip">
              {views
                .filter((v) => v.key !== fullView.key)
                .map((v) => (
                  <button key={v.key} className="strip-tile" onClick={() => setFull(v.key)} title={v.label}>
                    {v.pub ? <Video pub={v.pub} mirror={!v.screen && v.p === local} contain={v.screen} /> : <span className="tile-avatar">{avatarOf(v.p, 36)}</span>}
                    <span className="strip-name">{v.label}</span>
                  </button>
                ))}
            </div>
          )}
          {controls}
        </div>
      )}
    </div>
  );
}

function CtrlButton({
  on,
  active,
  disabled,
  onClick,
  label,
  icon,
}: {
  on: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      className={"ctrl" + (on ? "" : " off") + (active ? " active" : "")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

/** Звук удалённых участников. Живёт в Main, чтобы слышать звонок из любого чата. */
export function CallAudio() {
  const st = useCallState();
  if (!st || st.status !== "connected") return null;
  return (
    <>
      {[...st.lk.remoteParticipants.values()].map((p) =>
        [...p.audioTrackPublications.values()].map((pub) =>
          pub.track ? <Audio key={pub.trackSid} pub={pub} /> : null,
        ),
      )}
    </>
  );
}

/** Развёрнутая картинка пропала (показ экрана остановлен, участник вышел) — выходим из полноэкранного режима. */
function AutoClose({ onClose }: { onClose: () => void }) {
  useEffect(() => onClose(), []);
  return null;
}

interface View {
  key: string;
  p: Participant;
  pub?: TrackPublication;
  label: string;
  screen: boolean;
}

function ParticipantTile({
  p,
  name,
  isLocal,
  avatar,
  onExpand,
}: {
  p: Participant;
  name: string;
  isLocal: boolean;
  avatar: ReactNode;
  onExpand: () => void;
}) {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const hasVideo = !!cam?.track && !cam.isMuted;
  const micMuted = !p.isMicrophoneEnabled;
  return (
    <div className={"tile" + (p.isSpeaking ? " speaking" : "")} onDoubleClick={hasVideo ? onExpand : undefined}>
      {hasVideo && (
        <button
          className="tile-expand"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="На весь экран"
          aria-label="На весь экран"
        >
          <Maximize2 size={15} />
        </button>
      )}
      {hasVideo ? (
        <Video pub={cam!} mirror={isLocal} />
      ) : (
        <div className="tile-avatar">{avatar}</div>
      )}
      <div className="tile-name">
        {micMuted && <MicOff size={12} />}
        {name}
        {isLocal ? " (вы)" : ""}
      </div>
    </div>
  );
}

function Video({ pub, mirror, contain }: { pub: TrackPublication; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = pub.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  const cls = [mirror && "mirror", contain && "contain"].filter(Boolean).join(" ");
  return <video ref={ref} autoPlay playsInline muted className={cls || undefined} />;
}

function Audio({ pub }: { pub: TrackPublication }) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = pub.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function alertErr(e: unknown) {
  alert(e instanceof Error ? e.message : String(e));
}
