// Входящие звонки. Звонящий клиент (JsMessenger, Element, Element X, Element Call) вместе с началом
// звонка отправляет в комнату событие-уведомление (MSC4075): «ring» — позвонить, «notification» — сообщить.
// Здесь мы ловим такие события, показываем окно вызова и звоним, пока звонок актуален.
import {
  EventType,
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { MatrixRTCSessionEvent, getCallNotificationExpiry, type MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc";
import { call } from "./call";
import { isDirect, isMuted } from "./rooms";
import { startRingtone, stopRingtone } from "./ringtone";
import { notifySystem, presentWindow } from "./notifications";

export interface IncomingCall {
  roomId: string;
  eventId: string;
  sender: string;
  video: boolean;
  /** звонят лично (личный чат или «ring»), а не просто сообщают о звонке в группе */
  ring: boolean;
  expiresAt: number;
}

let current: IncomingCall | null = null;
const listeners = new Set<() => void>();
function set(c: IncomingCall | null) {
  current = c;
  listeners.forEach((f) => f());
}
export function getIncoming() {
  return current;
}
export function subscribeIncoming(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

const LEGACY_LIFETIME = 30_000; // у старого call.notify нет срока — считаем 30 секунд

let active: { client: MatrixClient; session: MatrixRTCSession; stop: () => void } | null = null;

function finish() {
  stopRingtone();
  active?.stop();
  active = null;
  set(null);
}

/** Принять: входим в звонок этой комнаты. */
export async function acceptIncoming(withVideo: boolean) {
  const c = current;
  const a = active;
  finish();
  if (!c || !a) return;
  const room = a.client.getRoom(c.roomId);
  if (room) await call.join(a.client, room, withVideo);
}

/** Отклонить: в личном чате сообщаем звонящему (MSC4310), в группе просто скрываем. */
export async function declineIncoming() {
  const c = current;
  const a = active;
  finish();
  if (!c || !a) return;
  if (!c.ring) return;
  await a.client
    .sendEvent(c.roomId, EventType.RTCDecline as any, {
      "m.relates_to": { rel_type: "m.reference", event_id: c.eventId },
    } as any)
    .catch((e) => console.warn("decline", e));
}

/** Кто-то из участников звонка, кроме нас. */
function othersInCall(client: MatrixClient, session: MatrixRTCSession) {
  return session.memberships.filter((m) => m.sender !== client.getSafeUserId());
}
/** Мы уже в этом звонке — с этого или другого своего устройства. */
function meInCall(client: MatrixClient, session: MatrixRTCSession) {
  return session.memberships.some((m) => m.sender === client.getSafeUserId());
}

function present(client: MatrixClient, room: Room, c: IncomingCall) {
  const session = client.matrixRTC.getRoomSession(room);
  finish();

  const check = () => {
    // звонок закончился, мы ответили с другого устройства или время вышло
    if (Date.now() >= c.expiresAt || meInCall(client, session) || (seen && othersInCall(client, session).length === 0)) finish();
  };
  // участник звонящего может прийти чуть позже уведомления — до этого «пустой» звонок не считаем завершённым
  let seen = othersInCall(client, session).length > 0;
  const onMembers = () => {
    if (othersInCall(client, session).length > 0) seen = true;
    check();
  };
  session.on(MatrixRTCSessionEvent.MembershipsChanged, onMembers);
  const tick = window.setInterval(check, 1000);
  const grace = window.setTimeout(() => {
    seen = true; // через 10 секунд без участников — звонка нет
    check();
  }, 10_000);
  active = {
    client,
    session,
    stop: () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, onMembers);
      window.clearInterval(tick);
      window.clearTimeout(grace);
    },
  };
  set(c);

  const who = room.getMember(c.sender)?.name ?? c.sender;
  const kind = c.video ? "Видеозвонок" : "Аудиозвонок";
  if (c.ring) {
    startRingtone("ring");
    presentWindow();
    notifySystem(`${kind}: ${who}`, isDirect(client, room) ? "Входящий звонок" : `Звонок в «${room.name}»`, room.roomId);
  } else if (!document.hasFocus()) {
    notifySystem(`${who} начал звонок`, `«${room.name}» — откройте чат, чтобы присоединиться`, room.roomId);
  }
}

export function attachIncomingCalls(client: MatrixClient): () => void {
  const me = client.getSafeUserId();

  const onTimeline = (ev: MatrixEvent, room: Room | undefined, toStart: boolean | undefined, _r: boolean, data: { liveEvent?: boolean }) => {
    if (!room || toStart || !data?.liveEvent) return;
    const type = ev.getType();

    // Наш собственный отказ с другого устройства — перестаём звонить и здесь
    if (type === EventType.RTCDecline && ev.getSender() === me) {
      const ref = ev.getContent()["m.relates_to"]?.event_id;
      if (current && ref === current.eventId) finish();
      return;
    }

    if (type !== EventType.RTCNotification && type !== EventType.CallNotify) return;
    if (ev.getSender() === me) return;
    if (room.getMyMembership() !== KnownMembership.Join) return;
    const content = ev.getContent();
    const mentions = content["m.mentions"] ?? {};
    if (mentions.room !== true && !(mentions.user_ids ?? []).includes(me)) return;

    const expiresAt =
      type === EventType.RTCNotification && typeof content.sender_ts === "number" && typeof content.lifetime === "number"
        ? getCallNotificationExpiry(content as any, ev.getTs())
        : ev.getTs() + LEGACY_LIFETIME;
    if (Date.now() >= expiresAt) return;

    const session = client.matrixRTC.getRoomSession(room);
    if (meInCall(client, session) || call.state?.roomId === room.roomId) return;

    const direct = isDirect(client, room);
    const kind = content.notification_type ?? content.notify_type;
    const ring = direct || kind === "ring";
    if (isMuted(client, room) && !direct) return;
    // уже звонят — второе уведомление (групповое) не перебивает личный звонок
    if (current?.ring && !ring) return;

    const intent = content["m.call.intent"];
    present(client, room, {
      roomId: room.roomId,
      eventId: ev.getId()!,
      sender: ev.getSender()!,
      video: intent ? intent === "video" : true,
      ring,
      expiresAt,
    });
  };

  client.on(RoomEvent.Timeline, onTimeline as never);
  return () => {
    client.off(RoomEvent.Timeline, onTimeline as never);
    finish();
  };
}
