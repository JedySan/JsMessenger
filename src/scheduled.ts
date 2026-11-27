// Отложенные сообщения: сервер сам отправит сообщение в назначенное время, даже если приложение закрыто.
// Работает через «отложенные события» Matrix (MSC4140) — их включает тот же параметр Synapse, что нужен
// звонкам Element Call (max_event_delay_duration); он же ограничивает, на сколько вперёд можно запланировать.
// В зашифрованном чате шифруем сами при планировании: SDK отложенные события не шифрует.
import { EventType, MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk";
import { tr } from "./i18n";
import { hasPlus, plusApi, PlusError } from "./plus";

const FEATURE = "org.matrix.msc4140";
const KEY = "jsm.scheduled";

/** Кто отправит: Matrix-сервер пользователя (MSC4140) или сервер JsMessenger (Plus). */
export type ScheduleVia = "matrix" | "plus";

export interface Scheduled {
  delayId: string;
  via: ScheduleVia;
  /** Plus: сообщение не ушло (причина) */
  failed?: string;
  roomId: string;
  /** когда сервер отправит (мс) */
  at: number;
  /** текст — для показа в списке (сервер хранит зашифрованное) */
  text: string;
}

type Saved = Record<string, { roomId: string; userId: string; text: string; at: number; via?: ScheduleVia }>;

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
  if (e instanceof PlusError) {
    if (e.code === "plus") return tr("Отложенная отправка через сервер JsMessenger входит в Plus");
    if (e.code === "network") return tr("Нет связи с сервером JsMessenger");
    if (e.code === "limit") return tr("Слишком много запланированных сообщений");
    if (e.code === "homeserver") return tr("Сервер JsMessenger не смог связаться с вашим Matrix-сервером");
    if (e.code === "token" || e.code === "mxid") return tr("Сервер JsMessenger не смог проверить доступ к аккаунту");
    if (e.code === "openid") return tr("Не удалось войти в JsMessenger Plus");
    return tr("Ошибка сервера JsMessenger: {0}", e.code);
  }
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

/** Тип и содержимое события «как на проводе»: в зашифрованном чате — уже зашифрованные. */
async function wireEvent(client: MatrixClient, room: Room, content: Record<string, unknown>): Promise<{ type: string; wire: Record<string, unknown> }> {
  if (!room.hasEncryptionStateEvent()) return { type: EventType.RoomMessage, wire: content };
  const ev = new MatrixEvent({
    type: EventType.RoomMessage,
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
  return { type: ev.getWireType(), wire: ev.getWireContent() };
}

/** Какими способами можно запланировать: через свой Matrix-сервер и/или через Plus. */
export async function scheduleRoutes(client: MatrixClient): Promise<ScheduleVia[]> {
  const out: ScheduleVia[] = [];
  if (hasPlus(client)) out.push("plus");
  if (await canSchedule(client)) out.push("matrix");
  return out;
}

const VIA_KEY = "jsm.schedVia";
export function preferredVia(): ScheduleVia | null {
  try {
    const v = localStorage.getItem(VIA_KEY);
    return v === "plus" || v === "matrix" ? v : null;
  } catch {
    return null;
  }
}
export function setPreferredVia(v: ScheduleVia) {
  try {
    localStorage.setItem(VIA_KEY, v);
  } catch {
    /* не запомним */
  }
}

/** Запланировать сообщение (content — как для sendMessage) на время at. */
export async function scheduleMessage(client: MatrixClient, room: Room, content: Record<string, unknown>, at: Date, via: ScheduleVia = "matrix"): Promise<string> {
  const { type, wire } = await wireEvent(client, room, content);
  let id: string;
  if (via === "plus") {
    const r = await plusApi(client, "/api/plus/scheduled", {
      method: "POST",
      body: JSON.stringify({
        roomId: room.roomId,
        type,
        content: wire,
        at: at.getTime(),
        homeserver: client.getHomeserverUrl(),
        accessToken: client.getAccessToken(),
        txnId: client.makeTxnId(),
      }),
    });
    id = "plus:" + r.id;
  } else {
    const delay = Math.max(1000, at.getTime() - Date.now());
    const res = await client._unstable_sendDelayedEvent(room.roomId, { delay }, null, type as never, wire as never);
    id = res.delay_id;
  }
  const saved = loadSaved();
  saved[id] = { roomId: room.roomId, userId: client.getSafeUserId(), text: String(content.body ?? ""), at: at.getTime(), via };
  storeSaved(saved);
  changed();
  return id;
}

/** Запланированные через Plus (с сервера JsMessenger). Ушедшие забываем. */
async function listPlus(client: MatrixClient, roomId: string, saved: Saved): Promise<{ items: Scheduled[]; dirty: boolean }> {
  const me = client.getSafeUserId();
  const known = Object.entries(saved).some(([id, v]) => v.userId === me && id.startsWith("plus:"));
  if (!known && !hasPlus(client)) return { items: [], dirty: false };
  type Item = { id: string; roomId: string; at: number; status: "pending" | "sent" | "failed"; error?: string };
  let list: Item[];
  try {
    list = (await plusApi(client, "/api/plus/scheduled")).items ?? [];
  } catch {
    // нет связи — покажем то, что помним
    const items = Object.entries(saved)
      .filter(([id, v]) => id.startsWith("plus:") && v.userId === me && v.roomId === roomId)
      .map(([delayId, v]) => ({ delayId, via: "plus" as const, roomId, at: v.at, text: v.text }));
    return { items, dirty: false };
  }
  const byId = new Map(list.map((i) => [i.id, i]));
  let dirty = false;
  for (const [id, v] of Object.entries(saved))
    if (id.startsWith("plus:") && v.userId === me && (!byId.has(id.slice(5)) || byId.get(id.slice(5))!.status === "sent")) {
      delete saved[id];
      dirty = true;
    }
  const items = list
    .filter((i) => i.roomId === roomId && i.status !== "sent")
    .map((i) => ({
      delayId: "plus:" + i.id,
      via: "plus" as const,
      roomId,
      at: i.at,
      text: saved["plus:" + i.id]?.text ?? tr("Сообщение"),
      failed: i.status === "failed" ? (i.error ?? "failed") : undefined,
    }));
  return { items, dirty };
}

/** Запланированные сообщения в комнате (с сервера; текст — из сохранённого при планировании). */
export async function listScheduled(client: MatrixClient, roomId: string): Promise<Scheduled[]> {
  const saved = loadSaved();
  const plus = await listPlus(client, roomId, saved);
  if (plus.dirty) storeSaved(saved);
  const matrix = (await canSchedule(client)) || Object.entries(saved).some(([id, v]) => !id.startsWith("plus:") && v.userId === client.getSafeUserId())
    ? await listMatrix(client, roomId, saved)
    : [];
  return [...plus.items, ...matrix].sort((a, b) => a.at - b.at);
}

async function listMatrix(client: MatrixClient, roomId: string, saved: Saved): Promise<Scheduled[]> {
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
      if (v.userId === me && !id.startsWith("plus:") && !live.has(id)) {
        delete saved[id];
        dirty = true;
      }
    if (dirty) storeSaved(saved);
    items = all
      .filter((d) => d.room_id === roomId && (d.type === EventType.RoomMessage || d.type === EventType.RoomMessageEncrypted) && d.state_key === undefined)
      .map((d) => ({
        delayId: d.delay_id,
        via: "matrix" as const,
        roomId,
        at: saved[d.delay_id]?.at ?? (d.running_since ?? d.delayed_since_ts ?? Date.now()) + (d.delay ?? d.delay_ms ?? 0),
        text: saved[d.delay_id]?.text ?? (typeof d.content?.body === "string" ? d.content.body : tr("Сообщение")),
      }));
  } catch {
    // сервер не отдаёт список — показываем то, что помним сами
    items = Object.entries(saved)
      .filter(([id, v]) => !id.startsWith("plus:") && v.userId === me && v.roomId === roomId && v.at > Date.now() - 60_000)
      .map(([delayId, v]) => ({ delayId, via: "matrix" as const, roomId, at: v.at, text: v.text }));
  }
  return items;
}

function forget(delayId: string) {
  const saved = loadSaved();
  delete saved[delayId];
  storeSaved(saved);
  changed();
}

export async function sendScheduledNow(client: MatrixClient, delayId: string) {
  if (delayId.startsWith("plus:")) {
    const r = await plusApi(client, `/api/plus/scheduled/${delayId.slice(5)}/send`, { method: "POST" });
    if (r.status === "sent") forget(delayId);
    else changed();
    return;
  }
  await client._unstable_updateDelayedEvent(delayId, "send" as never);
  forget(delayId);
}

/** Отменить (или убрать из списка не ушедшее через Plus). */
export async function cancelScheduled(client: MatrixClient, delayId: string) {
  if (delayId.startsWith("plus:")) {
    try {
      await plusApi(client, `/api/plus/scheduled/${delayId.slice(5)}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof PlusError && e.code === "not found")) throw e;
    }
  } else await client._unstable_updateDelayedEvent(delayId, "cancel" as never);
  forget(delayId);
}

/** Почему сообщение через Plus не ушло — понятными словами. */
export function failedText(code: string): string {
  if (code === "token") return tr("не отправлено: вы вышли из аккаунта на этом устройстве");
  if (code === "forbidden") return tr("не отправлено: нет прав писать в этот чат");
  if (code === "unreachable") return tr("не отправлено: Matrix-сервер был недоступен");
  return tr("не отправлено ({0})", code);
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
