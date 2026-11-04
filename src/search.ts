// Поиск по сообщениям: открытые чаты — на сервере, зашифрованные — среди загруженных у себя.
// Работает сразу по нескольким аккаунтам (общий список чатов).
import { KnownMembership, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
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

/** Найти сообщения в комнатах rooms (по умолчанию — во всех чатах аккаунта). */
export async function searchMessages(client: MatrixClient, term: string, only?: Room): Promise<Hit[]> {
  const t = term.trim();
  if (!t) return [];
  const rooms = only ? [only] : client.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Join && !r.isSpaceRoom());
  const local = localSearch(client, rooms.filter((r) => r.hasEncryptionStateEvent()), t);
  let server: Hit[] = [];
  if (rooms.some((r) => !r.hasEncryptionStateEvent())) {
    const res = await client.searchRoomEvents({ term: t, filter: only ? { rooms: [only.roomId] } : undefined });
    server = res.results
      .map((r) => r.context.getEvent())
      .map((ev) => ({ ev, room: client.getRoom(ev.getRoomId() ?? "")!, client }))
      .filter((h) => h.room);
  }
  return [...server, ...local];
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
