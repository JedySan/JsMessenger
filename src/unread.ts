// «Отметить непрочитанным», как в Telegram: m.marked_unread (Matrix 1.12) в данных комнаты.
// Пишем и старое название com.famedly.marked_unread — так отметку видят и другие клиенты (Element, FluffyChat).
import type { MatrixClient, Room } from "matrix-js-sdk";

const TYPES = ["m.marked_unread", "com.famedly.marked_unread"] as const;

export function isMarkedUnread(room: Room): boolean {
  return TYPES.some((t) => room.getAccountData(t as never)?.getContent()?.unread === true);
}

export async function setMarkedUnread(client: MatrixClient, room: Room, unread: boolean) {
  await Promise.all(TYPES.map((t) => client.setRoomAccountData(room.roomId, t as never, { unread } as never).catch(() => {})));
}

/** «Отметить прочитанным»: отметка о прочтении последнего сообщения (сервер обнулит счётчик) и снятие пометки. */
export async function markRoomRead(client: MatrixClient, room: Room) {
  const last = room.getLiveTimeline().getEvents().filter((e) => !e.isSending() && e.getId()?.startsWith("$")).at(-1);
  if (last) await client.setRoomReadMarkers(room.roomId, last.getId()!, last).catch(() => {});
  if (isMarkedUnread(room)) await setMarkedUnread(client, room, false);
}
