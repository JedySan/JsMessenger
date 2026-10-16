// Звонки: MatrixRTC (сигналинг в комнате, m.call.member) + LiveKit (медиа).
// Совместимо с Element Call / Element X на том же lk-jwt-service.
import type { MatrixClient, Room } from "matrix-js-sdk";
import {
  MatrixRTCSessionEvent,
  type LivekitTransport,
  type MatrixRTCSession,
} from "matrix-js-sdk/lib/matrixrtc";
import {
  BaseKeyProvider,
  createKeyMaterialFromBuffer,
  isE2EESupported,
  Room as LkRoom,
  RoomEvent as LkEvent,
} from "livekit-client";
import E2EEWorker from "livekit-client/e2ee-worker?worker";

// Запасной адрес lk-jwt-service, если сервер не отдал транспорт ни через API, ни через .well-known.
// Задаётся при сборке: VITE_LIVEKIT_SERVICE_URL=https://livekit.example.com/livekit/jwt
const FALLBACK_SERVICE_URL: string = (import.meta.env.VITE_LIVEKIT_SERVICE_URL ?? "").trim();

/** Ключи участников звонка приходят из Matrix и передаются в LiveKit-шифрование. */
class MatrixKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ ratchetWindowSize: 10, keyringSize: 256 });
  }
  async setKey(key: Uint8Array<ArrayBuffer>, identity: string, index: number) {
    const material = await createKeyMaterialFromBuffer(key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength));
    this.onSetEncryptionKey(material, identity, index);
  }
}

export interface CallState {
  roomId: string;
  status: "connecting" | "connected" | "error";
  error?: string;
  encrypted: boolean;
  lk: LkRoom;
}

type Listener = () => void;

/** Один активный звонок на приложение. */
class CallController {
  state: CallState | null = null;
  private listeners = new Set<Listener>();
  private session: MatrixRTCSession | null = null;
  private keyListener: ((...a: any[]) => void) | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.state = this.state ? { ...this.state } : null;
    for (const fn of this.listeners) fn();
  }

  async join(client: MatrixClient, room: Room, withVideo: boolean) {
    if (this.state) {
      if (this.state.roomId === room.roomId) return;
      await this.leave();
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("WebView не даёт доступ к микрофону и камере (navigator.mediaDevices недоступен)");
    }
    const encrypted = room.hasEncryptionStateEvent();
    if (encrypted && !isE2EESupported()) {
      throw new Error("Эта система не поддерживает шифрование звонков (нужен macOS 13+ / свежий WebKit)");
    }

    const keyProvider = encrypted ? new MatrixKeyProvider() : null;
    const lk = new LkRoom({
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider ? { keyProvider, worker: new E2EEWorker() } : undefined,
    });
    this.state = { roomId: room.roomId, status: "connecting", encrypted, lk };
    this.emit();

    // любые изменения в LiveKit-комнате → перерисовка
    for (const ev of [
      LkEvent.ParticipantConnected,
      LkEvent.ParticipantDisconnected,
      LkEvent.TrackSubscribed,
      LkEvent.TrackUnsubscribed,
      LkEvent.TrackMuted,
      LkEvent.TrackUnmuted,
      LkEvent.LocalTrackPublished,
      LkEvent.LocalTrackUnpublished,
      LkEvent.ActiveSpeakersChanged,
      LkEvent.ConnectionStateChanged,
      LkEvent.ParticipantEncryptionStatusChanged,
    ]) {
      lk.on(ev as any, () => this.emit());
    }
    lk.on(LkEvent.Disconnected, () => {
      if (this.state?.lk === lk) this.leave();
    });

    try {
      const transport = await getTransport(client, room.roomId);
      const session = client.matrixRTC.getRoomSession(room);
      this.session = session;

      if (keyProvider) {
        this.keyListener = (key: Uint8Array<ArrayBuffer>, index: number, _m: unknown, identity: string) => {
          keyProvider.setKey(key, identity, index).catch((e) => console.error("call key", e));
        };
        session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, this.keyListener as any);
      }

      const jwt = await fetchJwt(client, transport.livekit_service_url, room.roomId);

      // Публикуем своё участие в комнате (m.call.member) — нас видят Element Call/X
      const isDm = room.getJoinedMemberCount() <= 2;
      session.join(
        { userId: client.getSafeUserId(), deviceId: client.getDeviceId()!, memberId: `${client.getSafeUserId()}:${client.getDeviceId()}` },
        [transport],
        {
          manageMediaKeys: encrypted,
          callIntent: withVideo ? "video" : "audio",
          notificationType: session.memberships.length === 0 ? (isDm ? "ring" : "notification") : undefined,
        },
      );
      if (keyProvider) session.reemitEncryptionKeys();

      await lk.connect(jwt.url, jwt.jwt);
      if (encrypted) await lk.setE2EEEnabled(true);
      await lk.startAudio().catch(() => {});

      if (this.state?.lk !== lk) return; // успели нажать «Выйти»
      this.state.status = "connected";
      this.emit();

      await lk.localParticipant.setMicrophoneEnabled(true).catch((e) => console.warn("mic", e));
      if (withVideo) await lk.localParticipant.setCameraEnabled(true).catch((e) => console.warn("cam", e));
      this.emit();
    } catch (e) {
      console.error("call join", e);
      if (this.state?.lk === lk) {
        this.state.status = "error";
        this.state.error = e instanceof Error ? e.message : String(e);
        this.emit();
      }
      await this.cleanup(lk);
    }
  }

  async leave() {
    const st = this.state;
    this.state = null;
    this.emit();
    if (st) await this.cleanup(st.lk);
  }

  /** Убрать сообщение об ошибке после неудачного подключения. */
  dismiss() {
    if (this.state?.status === "error") {
      this.state = null;
      this.emit();
    }
  }

  private async cleanup(lk: LkRoom) {
    try {
      await lk.disconnect();
    } catch {
      /* уже отключены */
    }
    const s = this.session;
    this.session = null;
    if (s) {
      if (this.keyListener) s.off(MatrixRTCSessionEvent.EncryptionKeyChanged, this.keyListener as any);
      this.keyListener = null;
      if (s.isJoined()) await s.leave(5000).catch(() => {});
    }
  }
}

export const call = new CallController();

// ---------- обнаружение LiveKit-транспорта ----------
async function getTransport(client: MatrixClient, roomId: string): Promise<LivekitTransport> {
  // 1) Synapse (matrix_rtc.transports в homeserver.yaml)
  try {
    const list = await client._unstable_getRTCTransports();
    const t = list.find((x) => x.type === "livekit" && typeof x.livekit_service_url === "string");
    if (t) return withAlias(t.livekit_service_url as string);
  } catch {
    /* старый Synapse — идём в .well-known */
  }
  // 2) .well-known/matrix/client → org.matrix.msc4143.rtc_foci
  try {
    const wk = (await client.waitForClientWellKnown()) as Record<string, any>;
    const foci = (wk?.["org.matrix.msc4143.rtc_foci"] ?? []) as Array<Record<string, any>>;
    const t = foci.find((x) => x.type === "livekit" && x.livekit_service_url);
    if (t) return withAlias(t.livekit_service_url);
  } catch {
    /* нет .well-known */
  }
  if (FALLBACK_SERVICE_URL) return withAlias(FALLBACK_SERVICE_URL);
  throw new Error(
    "Сервер не сообщил адрес LiveKit для звонков. Администратору: добавьте org.matrix.msc4143.rtc_foci в .well-known/matrix/client или matrix_rtc.transports в Synapse",
  );

  function withAlias(url: string): LivekitTransport {
    // livekit_alias = ID комнаты, как у Element Call: все попадают в одну LiveKit-комнату
    return { type: "livekit", livekit_service_url: url.replace(/\/+$/, ""), livekit_alias: roomId } as LivekitTransport;
  }
}

/** JWT для LiveKit от lk-jwt-service по OpenID-токену Matrix. */
async function fetchJwt(client: MatrixClient, serviceUrl: string, roomId: string): Promise<{ url: string; jwt: string }> {
  const openid = await client.getOpenIdToken();
  const res = await fetch(`${serviceUrl}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomId, openid_token: openid, device_id: client.getDeviceId() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`lk-jwt-service ответил ${res.status}${text ? ": " + text.slice(0, 200) : ""}`);
  }
  const data = (await res.json()) as { url?: string; jwt?: string };
  if (!data.url || !data.jwt) throw new Error("lk-jwt-service вернул неполный ответ");
  return { url: data.url, jwt: data.jwt };
}

/** Имя Matrix-пользователя из LiveKit identity вида "@user:server:DEVICE". */
export function userIdFromIdentity(identity: string): string {
  const i = identity.lastIndexOf(":");
  return i > 0 && identity.startsWith("@") ? identity.slice(0, i) : identity;
}
