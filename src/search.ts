// Поиск по сообщениям: открытые чаты — на сервере, зашифрованные — среди загруженных у себя.
// Работает сразу по нескольким аккаунтам (общий список чатов).
import { KnownMembership, type EventTimeline, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { isVisibleMessage } from "./format";
import { plainText } from "./components/Message";

export interface Hit {
  ev: MatrixEvent;
  room: Room;
  client: MatrixClient;
}

/** Поиск по загруженным сообщениям — единственный способ для зашифрованных комнат. */
export function localSearch(client: MatrixClient, rooms: Room[], term: string): Hit[] {
  const t = term.toLowerCase();
  const out: Hit[] = [];
  for (const room of rooms) {
    const evs = [...room.getLiveTimeline().getEvents(), ...room.getThreads().flatMap((th) => th.events)];
    const seen = new Set<string>();
    for (const ev of evs) {
      const id = ev.getId();
      if (!id || seen.has(id) || !isVisibleMessage(ev) || ev.isRedacted() || ev.isDecryptionFailure()) continue;
      seen.add(id);
      if (plainText(ev).toLowerCase().includes(t)) out.push({ ev, room, client });
    }
  }
  return out;
}

/**
 * Поиск на сервере (только открытые чаты — зашифрованные сервер прочитать не может).
 * Сначала новые и постранично, до max результатов: по умолчанию сервер отдаёт лишь 10 «самых похожих»,
 * из-за чего старые сообщения не находились.
 */
async function serverSearch(client: MatrixClient, term: string, only?: Room, max = 150): Promise<Hit[]> {
  const map = client.getEventMapper();
  const out: Hit[] = [];
  let next: string | undefined;
  for (let page = 0; page < 10 && out.length < max; page++) {
    const res = await client.search({
      body: {
        search_categories: {
          room_events: {
            search_term: term,
            order_by: "recent" as never,
            filter: { limit: 50, ...(only ? { rooms: [only.roomId] } : {}) },
          },
        },
      },
      next_batch: next,
    });
    const cat = res.search_categories.room_events;
    for (const r of cat?.results ?? []) {
      const ev = map(r.result as never);
      const room = client.getRoom(ev.getRoomId() ?? "");
      if (room) out.push({ ev, room, client });
    }
    next = cat?.next_batch;
    if (!next) break;
  }
  return out;
}

/** Найти сообщения в комнатах rooms (по умолчанию — во всех чатах аккаунта). */
export async function searchMessages(client: MatrixClient, term: string, only?: Room): Promise<Hit[]> {
  const t = term.trim();
  if (!t) return [];
  const rooms = only ? [only] : client.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Join && !r.isSpaceRoom());
  const local = localSearch(client, rooms.filter((r) => r.hasEncryptionStateEvent()), t);
  const server = rooms.some((r) => !r.hasEncryptionStateEvent()) ? await serverSearch(client, t, only) : [];
  return [...server, ...local];
}

// ---------- поиск глубже: подгружаем историю зашифрованных чатов ----------
// Сервер не умеет искать в зашифрованном, поэтому старые сообщения таких чатов надо сначала
// скачать и расшифровать у себя. Делаем это по кнопке и до разумной глубины.

/** чаты, история которых уже подгружена до начала или до предела: чат → его лента на тот момент
 *  (после разрыва синхронизации лента новая и старое в ней пропадает — тогда грузим снова) */
const deepDone = new Map<string, EventTimeline>();
const isDeep = (c: MatrixClient, r: Room) => deepDone.get(c.getSafeUserId() + r.roomId) === r.getLiveTimeline();
const DEEP_MAX_EVENTS = 3000;

export interface DeepProgress {
  done: number;
  total: number;
}

/** Сколько зашифрованных чатов ещё не просмотрено глубоко. */
export function deepPending(clients: MatrixClient[]): number {
  return encryptedRooms(clients).filter(({ c, r }) => !isDeep(c, r)).length;
}

function encryptedRooms(clients: MatrixClient[]) {
  return clients.flatMap((c) =>
    c
      .getRooms()
      .filter((r) => r.getMyMembership() === KnownMembership.Join && !r.isSpaceRoom() && r.hasEncryptionStateEvent())
      .map((r) => ({ c, r })),
  );
}

/** Подгрузить историю зашифрованных чатов (до начала чата или DEEP_MAX_EVENTS сообщений в каждом). */
export async function deepLoad(clients: MatrixClient[], onProgress: (p: DeepProgress) => void, signal: { cancelled: boolean }) {
  const list = encryptedRooms(clients).filter(({ c, r }) => !isDeep(c, r));
  let done = 0;
  onProgress({ done, total: list.length });
  // по нескольку чатов параллельно — быстрее, но не заваливаем сервер
  const queue = [...list];
  const worker = async () => {
    for (let item = queue.shift(); item && !signal.cancelled; item = queue.shift()) {
      const { c, r } = item;
      try {
        const tl = r.getLiveTimeline();
        while (!signal.cancelled && tl.getEvents().length < DEEP_MAX_EVENTS) {
          const more = await c.paginateEventTimeline(tl, { backwards: true, limit: 100 });
          if (!more) break;
        }
        await Promise.all(tl.getEvents().map((e) => (e.isEncrypted() ? c.decryptEventIfNeeded(e).catch(() => {}) : undefined)));
        if (!signal.cancelled) deepDone.set(c.getSafeUserId() + r.roomId, tl);
      } catch {
        /* чат недоступен — пропускаем */
      }
      onProgress({ done: ++done, total: list.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** Поиск сразу по нескольким аккаунтам: новые сверху, без повторов. Ошибка одного аккаунта не мешает другим. */
export async function searchAll(clients: MatrixClient[], term: string, limit = 200): Promise<Hit[]> {
  const parts = await Promise.allSettled(clients.map((c) => searchMessages(c, term)));
  const failed = parts.find((p) => p.status === "rejected");
  const hits = parts.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
  if (!hits.length && failed) throw (failed as PromiseRejectedResult).reason;
  const uniq = new Map(hits.map((h) => [h.client.getSafeUserId() + h.ev.getId(), h]));
  return [...uniq.values()].sort((a, b) => b.ev.getTs() - a.ev.getTs()).slice(0, limit);
}

/** Совпадения среди уже загруженных сообщений зашифрованных чатов (после «искать глубже»). */
export function localAll(clients: MatrixClient[], term: string): Hit[] {
  return clients.flatMap((c) => localSearch(c, encryptedRooms([c]).map(({ r }) => r), term.trim()));
}

/** Объединить результаты: новые сверху, без повторов. */
export function mergeHits(a: Hit[], b: Hit[], limit = 200): Hit[] {
  const uniq = new Map([...a, ...b].map((h) => [h.client.getSafeUserId() + h.ev.getId(), h]));
  return [...uniq.values()].sort((x, y) => y.ev.getTs() - x.ev.getTs()).slice(0, limit);
}
