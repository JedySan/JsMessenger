// Название личного чата «только у себя»: общее название (m.room.name) видит и собеседник,
// поэтому для тет-а-тет чатов храним своё в данных аккаунта и подставляем вместо имени комнаты.
import { ClientEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export const ROOM_NAMES = "io.github.jedysan.jsm.room_names";
type Names = Record<string, string>;

function names(client: MatrixClient): Names {
  const c = client.getAccountData(ROOM_NAMES as never)?.getContent() as { names?: Names } | undefined;
  return c?.names ?? {};
}

/** Своё название чата, если задано. */
export function privateName(client: MatrixClient, roomId: string): string | undefined {
  return names(client)[roomId] || undefined;
}

/** Задать (или убрать — пустой строкой) своё название. */
export async function setPrivateName(client: MatrixClient, roomId: string, name: string) {
  const next = { ...names(client) };
  if (name.trim()) next[roomId] = name.trim();
  else delete next[roomId];
  await client.setAccountData(ROOM_NAMES as never, { names: next } as never);
  apply(client);
}

/** Подставить свои названия в комнаты (room.name читают список чатов, шапка, уведомления, поиск). */
function apply(client: MatrixClient, only?: Room) {
  const n = names(client);
  for (const room of only ? [only] : client.getRooms()) {
    const want = n[room.roomId];
    if (want && room.name !== want) {
      room.name = want;
      room.normalizedName = want.toLowerCase();
      room.emit(RoomEvent.Name, room);
    } else if (!want && (room as Room & { jsmPrivate?: boolean }).jsmPrivate) {
      room.recalculate(); // своё название убрали — вернуть обычное
    }
    (room as Room & { jsmPrivate?: boolean }).jsmPrivate = !!want;
  }
}

/** Подключить к клиенту: при старте, новых комнатах и пересчёте имени комнаты SDK. */
export function attachPrivateNames(client: MatrixClient) {
  apply(client);
  client.on(ClientEvent.AccountData, (ev: MatrixEvent) => ev.getType() === ROOM_NAMES && apply(client));
  client.on(ClientEvent.Room, (room: Room) => apply(client, room));
  client.on(RoomEvent.Name, (room: Room) => {
    const want = privateName(client, room.roomId);
    if (want && room.name !== want) queueMicrotask(() => apply(client, room));
  });
  client.on(ClientEvent.Sync, (state: string) => state === "PREPARED" && apply(client));
}
