import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import {
  LockKeyhole,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  TriangleAlert,
  Video as Video_,
  VideoOff,
} from "lucide-react";
import Avatar from "./Avatar";
import { Track, type Participant, type TrackPublication } from "livekit-client";
import { call, userIdFromIdentity } from "../call";

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

  const ready = st.status === "connected";
  const micOn = local.isMicrophoneEnabled;
  const camOn = local.isCameraEnabled;
  const shareOn = local.isScreenShareEnabled;

  return (
    <div className="call-panel">
      {!ready ? (
        <div className="call-connecting">Подключаюсь к звонку…</div>
      ) : st.calling ? (
        <div className="call-connecting calling">
          <Avatar client={client} mxc={otherOf(client, room)?.getMxcAvatarUrl()} name={otherOf(client, room)?.name ?? room.name} seed={otherOf(client, room)?.userId ?? room.roomId} size={72} />
          <span>Вызываю {otherOf(client, room)?.name ?? room.name}…</span>
        </div>
      ) : (
        <div className={"call-grid" + (screens.length ? " with-screen" : "") + ` n${Math.min(participants.length, 4)}`}>
          {screens.map(({ p, pub }) => (
            <div className="tile screen" key={p.identity + "-screen"}>
              <Video pub={pub} />
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
              />
            );
          })}
        </div>
      )}

      <div className="call-controls">
        <div className="call-info">
          {st.encrypted ? <LockKeyhole size={13} /> : null}
          {st.encrypted ? "Звонок зашифрован" : "Звонок без шифрования"}
        </div>
        <div className="call-buttons-row">
          <CtrlButton
            on={micOn}
            disabled={!ready}
            onClick={() => local.setMicrophoneEnabled(!micOn).catch(alertErr)}
            label={micOn ? "Выключить микрофон" : "Включить микрофон"}
            icon={micOn ? <Mic size={20} /> : <MicOff size={20} />}
          />
          <CtrlButton
            on={camOn}
            disabled={!ready}
            onClick={() => local.setCameraEnabled(!camOn).catch(alertErr)}
            label={camOn ? "Выключить камеру" : "Включить камеру"}
            icon={camOn ? <Video_ size={20} /> : <VideoOff size={20} />}
          />
          <CtrlButton
            on={!shareOn}
            active={shareOn}
            disabled={!ready}
            onClick={() => local.setScreenShareEnabled(!shareOn, { audio: false }).catch(alertErr)}
            label={shareOn ? "Остановить показ экрана" : "Показать экран"}
            icon={<MonitorUp size={20} />}
          />
          <button className="ctrl hangup" onClick={() => call.leave()} title="Завершить звонок" aria-label="Завершить звонок">
            <PhoneOff size={20} />
          </button>
        </div>
        <div className="call-info right">
          {participants.length} {participants.length === 1 ? "участник" : participants.length < 5 ? "участника" : "участников"}
        </div>
      </div>
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

function ParticipantTile({ p, name, isLocal, avatar }: { p: Participant; name: string; isLocal: boolean; avatar: ReactNode }) {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const hasVideo = !!cam?.track && !cam.isMuted;
  const micMuted = !p.isMicrophoneEnabled;
  return (
    <div className={"tile" + (p.isSpeaking ? " speaking" : "")}>
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

function Video({ pub, mirror }: { pub: TrackPublication; mirror?: boolean }) {
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
  return <video ref={ref} autoPlay playsInline muted className={mirror ? "mirror" : undefined} />;
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
