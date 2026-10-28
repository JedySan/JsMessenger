// Пересылка: копия содержимого сообщения без привязок к исходному чату (ответ, тред, правка, упоминания).
import { EventType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { stripReplyFallback } from "./format";

/** Что можно переслать: обычные сообщения и стикеры (не удалённые и расшифрованные). */
export function canForward(ev: MatrixEvent): boolean {
  if (ev.isRedacted() || ev.isDecryptionFailure() || ev.isSending()) return false;
  const t = ev.getType();
  return t === EventType.RoomMessage || t === EventType.Sticker;
}

/** Содержимое для пересылки: актуальная версия (с учётом правок) без связей с исходным чатом. */
export function forwardContent(ev: MatrixEvent): Record<string, any> {
  const replaced = ev.replacingEvent()?.getContent()["m.new_content"];
  const c: Record<string, any> = structuredClone(replaced ?? ev.getContent());
  delete c["m.relates_to"];
  delete c["m.new_content"];
  // цитата-«фоллбек» ответа относится к исходной переписке
  if (typeof c.body === "string") c.body = stripReplyFallback(c.body);
  if (typeof c.formatted_body === "string") c.formatted_body = c.formatted_body.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "");
  // упоминания не переносим — иначе пересылка заново позовёт людей
  c["m.mentions"] = {};
  return c;
}

/** Переслать сообщение в комнату (сначала необязательный комментарий, как в Telegram). */
export async function forwardTo(client: MatrixClient, ev: MatrixEvent, room: Room, comment?: string) {
  const text = comment?.trim();
  if (text) await client.sendMessage(room.roomId, { msgtype: "m.text", body: text } as never);
  await client.sendEvent(room.roomId, ev.getType() as never, forwardContent(ev) as never);
}

/** Чаты, куда можно переслать: где мы состоим и можем писать; сверху недавние. */
export function forwardTargets(client: MatrixClient): Room[] {
  const me = client.getSafeUserId();
  return client
    .getRooms()
    .filter((r) => r.getMyMembership() === "join" && !r.isSpaceRoom() && r.maySendMessage() && r.currentState.maySendMessage(me))
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
}
