// Отметки о прочтении: до какого сообщения дочитал каждый участник (кроме нас).
import { EventStatus, KnownMembership, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export type SendStatus = "sending" | "failed" | "sent" | "read";

export interface ReadInfo {
  /** статус наших сообщений по id */
  status: Map<string, SendStatus>;
  /** кто из участников дочитал ровно до этого (видимого) сообщения — для аватарок */
  readers: Map<string, string[]>;
}

/**
 * all — все события живой ленты (в порядке времени), visible — те, что показываем.
 * Сообщение считается прочитанным, если хоть один другой участник дочитал до него или дальше.
 */
export function readInfo(client: MatrixClient, room: Room, all: MatrixEvent[], visible: MatrixEvent[]): ReadInfo {
  const me = client.getSafeUserId();
  const index = new Map<string, number>();
  all.forEach((e, i) => {
    const id = e.getId();
    if (id) index.set(id, i);
  });

  // позиция «дочитал до» каждого участника
  let furthest = -1;
  const positions: Array<[string, number]> = [];
  for (const m of room.getMembers()) {
    if (m.userId === me || m.membership !== KnownMembership.Join) continue;
    const upTo = room.getEventReadUpTo(m.userId);
    const i = upTo ? index.get(upTo) : undefined;
    if (i === undefined) continue; // читал раньше загруженной истории — не показываем
    positions.push([m.userId, i]);
    if (i > furthest) furthest = i;
  }

  // аватарка участника — у последнего видимого сообщения не позже его отметки
  const readers = new Map<string, string[]>();
  const visIdx = visible.map((e) => index.get(e.getId() ?? "") ?? -1);
  for (const [userId, pos] of positions) {
    let at: string | undefined;
    for (let k = visible.length - 1; k >= 0; k--) {
      if (visIdx[k] !== -1 && visIdx[k] <= pos) {
        at = visible[k].getId();
        break;
      }
    }
    if (!at) continue;
    readers.set(at, [...(readers.get(at) ?? []), userId]);
  }

  const status = new Map<string, SendStatus>();
  for (const e of visible) {
    if (e.getSender() !== me) continue;
    const id = e.getId();
    if (!id) continue;
    if (e.status === EventStatus.NOT_SENT) status.set(id, "failed");
    else if (e.isSending()) status.set(id, "sending");
    else status.set(id, (index.get(id) ?? Infinity) <= furthest ? "read" : "sent");
  }
  return { status, readers };
}
