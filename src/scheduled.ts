// Отложенные сообщения: сервер сам отправит сообщение в назначенное время, даже если приложение закрыто.
// Работает через «отложенные события» Matrix (MSC4140) — их включает тот же параметр Synapse, что нужен
// звонкам Element Call (max_event_delay_duration); он же ограничивает, на сколько вперёд можно запланировать.
// В зашифрованном чате шифруем сами при планировании: SDK отложенные события не шифрует.
import { EventType, MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk";
import { tr } from "./i18n";

const FEATURE = "org.matrix.msc4140";
const KEY = "jsm.scheduled";

export interface Scheduled {
  delayId: string;
  roomId: string;
  /** когда сервер отправит (мс) */
  at: number;
  /** текст — для показа в списке (сервер хранит зашифрованное) */
  text: string;
}

type Saved = Record<string, { roomId: string; userId: string; text: string; at: number }>;

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
function storeSaved(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* без хранилища — список покажет «сообщение» без текста */
  }
}

const listeners = new Set<() => void>();
export function onScheduledChange(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}
const changed = () => listeners.forEach((f) => f());

/** Умеет ли сервер отложенные сообщения. */
export async function canSchedule(client: MatrixClient): Promise<boolean> {
  try {
    return await client.doesServerSupportUnstableFeature(FEATURE);
  } catch {
    return false;
  }
}

/** Понятный текст ошибки сервера (чаще всего — слишком далеко вперёд). */
export function scheduleError(e: unknown): string {
  const err = e as { errcode?: string; data?: { errcode?: string; max_delay?: number }; message?: string };
  const code = err?.errcode ?? err?.data?.errcode;
  if (code === "M_MAX_DELAY_EXCEEDED") {
    const h = err.data?.max_delay ? Math.floor(err.data.max_delay / 3_600_000) : 0;
    return h
      ? tr("Сервер разрешает планировать не больше чем на {0} ч вперёд", h)
      : tr("Сервер не разрешает планировать так далеко вперёд");
  }
  if (code === "M_UNRECOGNIZED" || /does not support/i.test(err?.message ?? "")) return tr("Сервер не поддерживает отложенные сообщения");
  return err?.message ?? String(e);
}

/** Запланировать сообщение (content — как для sendMessage) на время at. */
export async function scheduleMessage(client: MatrixClient, room: Room, content: Record<string, unknown>, at: Date): Promise<string> {
  const delay = Math.max(1000, at.getTime() - Date.now());
  let type: string = EventType.RoomMessage;
  let wire: Record<string, unknown> = content;
  if (room.hasEncryptionStateEvent()) {
    const ev = new MatrixEvent({
      type,
      content,
      room_id: room.roomId,
      sender: client.getSafeUserId(),
      event_id: "~" + Math.random().toString(36).slice(2),
      origin_server_ts: Date.now(),
    });
    // шифруем тем же модулем, что и обычные сообщения (encryptEventIfNeeded здесь не годится:
    // он меняет статус «локального эха», а это событие в ленту не попадает)
    const backend = (client as unknown as { cryptoBackend?: { encryptEvent(e: MatrixEvent, r: Room): Promise<void> } }).cryptoBackend;
    if (!backend) throw new Error(tr("Не удалось зашифровать сообщение"));
    await backend.encryptEvent(ev, room);
    if (!ev.isEncrypted()) throw new Error(tr("Не удалось зашифровать сообщение"));
    type = ev.getWireType();
    wire = ev.getWireContent();
  }
  const res = await client._unstable_sendDelayedEvent(room.roomId, { delay }, null, type as never, wire as never);
  const saved = loadSaved();
  saved[res.delay_id] = { roomId: room.roomId, userId: client.getSafeUserId(), text: String(content.body ?? ""), at: at.getTime() };
  storeSaved(saved);
  changed();
  return res.delay_id;
}

/** Запланированные сообщения в комнате (с сервера; текст — из сохранённого при планировании). */
export async function listScheduled(client: MatrixClient, roomId: string): Promise<Scheduled[]> {
  const saved = loadSaved();
  const me = client.getSafeUserId();
  let items: Scheduled[];
  try {
    // ответ бывает в двух видах: новый (scheduled, running_since, delay) и тот, что сейчас отдаёт Synapse
    // (delayed_events, delayed_since_ts, delay_ms)
    type Raw = { delay_id: string; room_id: string; type: string; state_key?: string; content?: Record<string, unknown>;
      delay?: number; delay_ms?: number; running_since?: number; delayed_since_ts?: number };
    const all: Raw[] = [];
    let from: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = (await client._unstable_getDelayedEvents("scheduled", undefined, from)) as unknown as {
        scheduled?: Raw[]; delayed_events?: Raw[]; next_batch?: string };
      all.push(...(r.scheduled ?? r.delayed_events ?? []));
      from = r.next_batch;
      if (!from) break;
    }
    // забываем те, что уже ушли или отменены
    const live = new Set(all.map((d) => d.delay_id));
    let dirty = false;
    for (const [id, v] of Object.entries(saved))
      if (v.userId === me && !live.has(id)) {
        delete saved[id];
        dirty = true;
      }
    if (dirty) storeSaved(saved);
    items = all
      .filter((d) => d.room_id === roomId && (d.type === EventType.RoomMessage || d.type === EventType.RoomMessageEncrypted) && d.state_key === undefined)
      .map((d) => ({
        delayId: d.delay_id,
        roomId,
        at: saved[d.delay_id]?.at ?? (d.running_since ?? d.delayed_since_ts ?? Date.now()) + (d.delay ?? d.delay_ms ?? 0),
        text: saved[d.delay_id]?.text ?? (typeof d.content?.body === "string" ? d.content.body : tr("Сообщение")),
      }));
  } catch {
    // сервер не отдаёт список — показываем то, что помним сами
    items = Object.entries(saved)
      .filter(([, v]) => v.userId === me && v.roomId === roomId && v.at > Date.now() - 60_000)
      .map(([delayId, v]) => ({ delayId, roomId, at: v.at, text: v.text }));
  }
  return items.sort((a, b) => a.at - b.at);
}

function forget(delayId: string) {
  const saved = loadSaved();
  delete saved[delayId];
  storeSaved(saved);
  changed();
}

export async function sendScheduledNow(client: MatrixClient, delayId: string) {
  await client._unstable_updateDelayedEvent(delayId, "send" as never);
  forget(delayId);
}

export async function cancelScheduled(client: MatrixClient, delayId: string) {
  await client._unstable_updateDelayedEvent(delayId, "cancel" as never);
  forget(delayId);
}

/** Готовые варианты времени, как в Telegram. */
export function schedulePresets(now = new Date()): { label: string; at: Date }[] {
  const at = (d: number, h: number, m = 0) => {
    const x = new Date(now);
    x.setDate(x.getDate() + d);
    x.setHours(h, m, 0, 0);
    return x;
  };
  const out: { label: string; at: Date }[] = [{ label: tr("Через час"), at: new Date(now.getTime() + 3_600_000) }];
  if (now.getHours() < 18) out.push({ label: tr("Сегодня в 19:00"), at: at(0, 19) });
  out.push({ label: tr("Завтра в 9:00"), at: at(1, 9) });
  if (now.getDay() >= 5 || now.getDay() === 0) {
    const toMon = (8 - now.getDay()) % 7 || 7;
    out.push({ label: tr("В понедельник в 9:00"), at: at(toMon, 9) });
  }
  return out;
}
