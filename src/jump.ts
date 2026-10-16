// Переход к сообщению по ID: прокрутка, при необходимости — подгрузка истории назад.
import { Direction, type MatrixClient, type Room } from "matrix-js-sdk";

/** Запрос «перейти к сообщению», который выполнит открытая комната (в том числе после переключения). */
let pending: { roomId: string; eventId: string } | null = null;
const listeners = new Set<() => void>();

export function requestJump(roomId: string, eventId: string) {
  pending = { roomId, eventId };
  listeners.forEach((f) => f());
}
export function takeJump(roomId: string): string | null {
  if (pending?.roomId !== roomId) return null;
  const id = pending.eventId;
  pending = null;
  return id;
}
export function onJump(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Подгружает историю, пока сообщение не окажется в ленте (до ~2000 событий назад). */
export async function loadUntil(client: MatrixClient, room: Room, eventId: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (room.getLiveTimeline().getEvents().some((e) => e.getId() === eventId)) return true;
    if (!room.getLiveTimeline().getPaginationToken(Direction.Backward)) return false;
    await client.scrollback(room, 50);
  }
  return room.getLiveTimeline().getEvents().some((e) => e.getId() === eventId);
}

export function flashEvent(eventId: string): boolean {
  const el = document.getElementById(`ev-${eventId}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth; // перезапуск анимации
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1400);
  return true;
}
