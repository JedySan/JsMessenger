// Звонок: выбор микрофона, камеры и динамиков; окно перед входом (выключить камеру и микрофон заранее).
import { useEffect, useRef, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { Mic, MicOff, Phone, Settings2, Video, VideoOff, X } from "lucide-react";
import { Modal, Toggle } from "./ui";
import { call } from "../call";
import { canPickSpeaker, deviceLabel, saveDevice, savedDevice, useDevices, type DeviceKind } from "../devices";
import { getPrefs, setPref, usePrefs } from "../prefs";
import { tr } from "../i18n";

/** Три списка: микрофон, камера, динамики. value — выбранные id; onChange — смена. */
export function DevicePickers({
  value,
  onChange,
  ready = true,
}: {
  value: Partial<Record<DeviceKind, string>>;
  onChange: (kind: DeviceKind, id: string) => void;
  /** устройства читаем после того, как система дала доступ (иначе нет названий) */
  ready?: boolean;
}) {
  const devs = useDevices(ready);
  const row = (kind: DeviceKind, label: string) => {
    const list = devs[kind];
    if (!list.length) return null;
    // «по умолчанию» у Chrome — отдельный пункт с id "default"; у Safari его нет
    const cur = value[kind] && list.some((d) => d.deviceId === value[kind]) ? value[kind] : list[0].deviceId;
    return (
      <label className="field compact">
        <span>{label}</span>
        <select className="text-input" value={cur} onChange={(e) => onChange(kind, e.target.value)}>
          {list.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceLabel(d, i, kind, tr)}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const none = !devs.audioinput.length && !devs.videoinput.length;
  return (
    <div className="device-pickers">
      {row("audioinput", tr("Микрофон"))}
      {row("videoinput", tr("Камера"))}
      {canPickSpeaker && row("audiooutput", tr("Динамики"))}
      {none && <p className="modal-text small-note">{tr("Устройства появятся после разрешения доступа к микрофону и камере.")}</p>}
    </div>
  );
}

/** Окошко настроек устройств прямо в звонке (кнопка с шестерёнкой). */
export function CallDeviceMenu({ onClose }: { onClose: () => void }) {
  const [, bump] = useState(0);
  const prefs = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.(".call-settings-btn")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const value = {
    audioinput: call.activeDevice("audioinput"),
    videoinput: call.activeDevice("videoinput"),
    audiooutput: call.activeDevice("audiooutput"),
  };
  return (
    <div className="call-device-menu" ref={ref} role="dialog" aria-label={tr("Настройки звонка")}>
      <div className="call-device-head">
        <b>{tr("Устройства")}</b>
        <button className="icon-btn small" onClick={onClose} aria-label={tr("Закрыть")}>
          <X size={16} />
        </button>
      </div>
      <DevicePickers value={value} onChange={(k, id) => void call.switchDevice(k, id).then(() => bump((x) => x + 1))} />
      <Toggle
        checked={prefs.callLobby}
        onChange={(v) => setPref("callLobby", v)}
        label={tr("Окно перед входом в звонок")}
        hint={tr("Проверить камеру и микрофон и выключить их до входа")}
      />
    </div>
  );
}

/** Кнопка шестерёнки для панели звонка. */
export function CallSettingsButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="call-settings-wrap">
      <button
        className={"ctrl call-settings-btn" + (open ? " active" : "")}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={tr("Микрофон, камера, динамики")}
        aria-label={tr("Микрофон, камера, динамики")}
      >
        <Settings2 size={20} />
      </button>
      {open && <CallDeviceMenu onClose={() => setOpen(false)} />}
    </span>
  );
}

/**
 * Перед входом в звонок: предпросмотр камеры, индикатор микрофона, выбор устройств,
 * и можно выключить камеру/микрофон заранее.
 */
export function CallLobby({
  client,
  room,
  video,
  joining,
  onClose,
}: {
  client: MatrixClient;
  room: Room;
  /** включить камеру по умолчанию (видеозвонок) */
  video: boolean;
  /** звонок уже идёт — «Присоединиться», иначе «Позвонить» */
  joining: boolean;
  onClose: () => void;
}) {
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(video);
  const [sel, setSel] = useState<Partial<Record<DeviceKind, string>>>({
    audioinput: savedDevice("audioinput"),
    videoinput: savedDevice("videoinput"),
    audiooutput: savedDevice("audiooutput"),
  });
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const videoEl = useRef<HTMLVideoElement>(null);
  const pick = (kind: DeviceKind, id: string) => {
    saveDevice(kind, id);
    setSel((s) => ({ ...s, [kind]: id || undefined }));
  };

  // Предпросмотр камеры
  useEffect(() => {
    if (!cam || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: sel.videoinput ? { deviceId: { exact: sel.videoinput } } : true })
      .then(
        (s) => {
          if (!alive) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          setGranted(true);
          setError(null);
          if (videoEl.current) videoEl.current.srcObject = s;
        },
        (e) => {
          if (!alive) return;
          // сохранённая камера отключена — берём системную
          if (sel.videoinput && (e as Error)?.name === "OverconstrainedError") return pick("videoinput", "");
          setError(mediaText(e, "cam"));
        },
      );
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoEl.current) videoEl.current.srcObject = null;
    };
  }, [cam, sel.videoinput]);

  // Индикатор громкости микрофона — видно, что выбран тот, что надо
  useEffect(() => {
    if (!mic || !navigator.mediaDevices?.getUserMedia) {
      setLevel(0);
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ audio: sel.audioinput ? { deviceId: { exact: sel.audioinput } } : true })
      .then(
        (s) => {
          if (!alive) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          setGranted(true);
          try {
            ctx = new AudioContext();
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            ctx.createMediaStreamSource(s).connect(an);
            const buf = new Uint8Array(an.fftSize);
            const tick = () => {
              an.getByteTimeDomainData(buf);
              let peak = 0;
              for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
              setLevel(Math.min(1, peak / 60));
              raf = requestAnimationFrame(tick);
            };
            tick();
          } catch {
            /* без индикатора */
          }
        },
        (e) => {
          if (!alive) return;
          if (sel.audioinput && (e as Error)?.name === "OverconstrainedError") return pick("audioinput", "");
          setError(mediaText(e, "mic"));
        },
      );
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mic, sel.audioinput]);


  const go = async () => {
    setBusy(true);
    onClose(); // окно закрываем сразу — предпросмотр освобождает камеру и микрофон для звонка
    try {
      await call.join(client, room, { mic, cam });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={joining ? tr("Присоединиться к звонку") : cam ? tr("Видеозвонок") : tr("Аудиозвонок")} icon={<Phone size={18} />} onClose={onClose} busy={busy}>
      <div className={"lobby-preview" + (cam ? "" : " off")}>
        {cam ? <video ref={videoEl} autoPlay playsInline muted className="mirror" /> : <VideoOff size={34} />}
        <span className="lobby-room">{room.name}</span>
      </div>
      <div className="lobby-toggles">
        <button className={"ctrl" + (mic ? "" : " off")} onClick={() => setMic((v) => !v)} aria-label={mic ? tr("Выключить микрофон") : tr("Включить микрофон")} title={mic ? tr("Выключить микрофон") : tr("Включить микрофон")}>
          {mic ? <Mic size={20} /> : <MicOff size={20} />}
          {mic && <span className="mic-level" style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />}
        </button>
        <button className={"ctrl" + (cam ? "" : " off")} onClick={() => setCam((v) => !v)} aria-label={cam ? tr("Выключить камеру") : tr("Включить камеру")} title={cam ? tr("Выключить камеру") : tr("Включить камеру")}>
          {cam ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
      </div>
      <p className="lobby-hint">
        {mic ? tr("Микрофон включён") : tr("Микрофон выключен")} · {cam ? tr("камера включена") : tr("камера выключена")}
      </p>
      {error && <p className="form-error left">{error}</p>}
      <DevicePickers value={sel} onChange={pick} ready={granted} />
      <div className="modal-actions">
        <button className="ghost" onClick={onClose}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={() => void go()} disabled={busy} autoFocus>
          <Phone size={15} /> {joining ? tr("Присоединиться") : tr("Позвонить")}
        </button>
      </div>
    </Modal>
  );
}

function mediaText(e: unknown, kind: "mic" | "cam"): string {
  const name = e instanceof Error ? e.name : "";
  const dev = kind === "mic" ? tr("микрофону") : tr("камере");
  if (name === "NotAllowedError" || name === "SecurityError") return tr("Нет доступа к {0}: разрешите его в настройках системы.", dev);
  if (name === "NotFoundError" || name === "OverconstrainedError") return kind === "mic" ? tr("Микрофон не найден") : tr("Камера не найдена");
  if (name === "NotReadableError") return tr("Устройство занято другой программой");
  return e instanceof Error ? e.message : String(e);
}

// ---------- откуда угодно: «позвонить» → окно перед входом (или сразу, если окно выключено) ----------
type LobbyReq = { client: MatrixClient; room: Room; video: boolean; joining: boolean };
let lobbyReq: LobbyReq | null = null;
const lobbyListeners = new Set<() => void>();

/** Начать звонок или войти в идущий: с окном проверки устройств, если оно включено в настройках. */
export async function startCall(client: MatrixClient, room: Room, video: boolean) {
  const joining = client.matrixRTC.getRoomSession(room).memberships.some(
    (m) => !(m.sender === client.getSafeUserId() && m.deviceId === client.getDeviceId()),
  );
  if (getPrefs().callLobby) {
    lobbyReq = { client, room, video, joining };
    lobbyListeners.forEach((f) => f());
    return;
  }
  await call.join(client, room, video);
}

/** Показывает окно перед входом в звонок — один на приложение (в Main). */
export function LobbyHost() {
  const [req, setReq] = useState<LobbyReq | null>(lobbyReq);
  useEffect(() => {
    const f = () => setReq(lobbyReq);
    lobbyListeners.add(f);
    return () => void lobbyListeners.delete(f);
  }, []);
  if (!req) return null;
  const close = () => {
    lobbyReq = null;
    setReq(null);
  };
  return <CallLobby key={req.room.roomId} client={req.client} room={req.room} video={req.video} joining={req.joining} onClose={close} />;
}
