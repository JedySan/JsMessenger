// Стикеры Matrix (MSC2545 — формат Element, Cinny, FluffyChat):
//  • свой набор — в данных аккаунта im.ponies.user_emotes;
//  • наборы комнат — состояние im.ponies.room_emotes (в текущей комнате и в тех, что указаны в im.ponies.emote_rooms).
// Отправка — событие m.sticker. Любую картинку из чата можно добавить в свой набор.
import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import { fetchMedia } from "./downloads";
import { tr } from "./i18n";

export interface Sticker {
  /** shortcode в наборе */
  key: string;
  url: string;
  body: string;
  info?: Record<string, unknown>;
}
export interface StickerPack {
  id: string;
  title: string;
  stickers: Sticker[];
  /** свой набор — из него можно удалять */
  mine: boolean;
}

const USER = "im.ponies.user_emotes";
const ROOM = "im.ponies.room_emotes";
const ROOMS = "im.ponies.emote_rooms";

type PackContent = {
  images?: Record<string, { url?: string; body?: string; info?: Record<string, unknown>; usage?: string[] }>;
  pack?: { display_name?: string; usage?: string[] };
};

function toStickers(c: PackContent | undefined): Sticker[] {
  const packUsage = c?.pack?.usage;
  return Object.entries(c?.images ?? {})
    .filter(([, im]) => typeof im.url === "string" && im.url.startsWith("mxc://"))
    // только стикеры: у картинки или у набора usage содержит «sticker» (пусто — значит и то, и другое)
    .filter(([, im]) => {
      const u = im.usage ?? packUsage;
      return !u?.length || u.includes("sticker");
    })
    .map(([key, im]) => ({ key, url: im.url!, body: im.body || key, info: im.info }));
}

function roomPacks(room: Room, only?: Set<string>): StickerPack[] {
  return room.currentState
    .getStateEvents(ROOM)
    .filter((e) => !only || only.has(e.getStateKey() ?? ""))
    .map((e) => {
      const c = e.getContent() as PackContent;
      return {
        id: `${room.roomId}/${e.getStateKey()}`,
        title: c.pack?.display_name || room.name,
        stickers: toStickers(c),
        mine: false,
      };
    })
    .filter((p) => p.stickers.length);
}

/** Все доступные наборы: свой, текущей комнаты и подключённые из других комнат. */
export function stickerPacks(client: MatrixClient, room?: Room): StickerPack[] {
  const packs: StickerPack[] = [];
  const own = client.getAccountData(USER as never)?.getContent() as PackContent | undefined;
  packs.push({ id: "mine", title: tr("Мои стикеры"), stickers: toStickers(own), mine: true });
  const seen = new Set<string>();
  if (room) for (const p of roomPacks(room)) (seen.add(p.id), packs.push(p));
  const linked = (client.getAccountData(ROOMS as never)?.getContent() as { rooms?: Record<string, Record<string, unknown>> } | undefined)?.rooms;
  for (const [roomId, keys] of Object.entries(linked ?? {})) {
    const r = client.getRoom(roomId);
    if (!r) continue;
    for (const p of roomPacks(r, new Set(Object.keys(keys)))) if (!seen.has(p.id)) (seen.add(p.id), packs.push(p));
  }
  return packs;
}

export async function sendSticker(client: MatrixClient, room: Room, s: Sticker, relatesTo?: Record<string, unknown>) {
  const content: Record<string, unknown> = { body: s.body, url: s.url, info: s.info ?? {} };
  if (relatesTo) content["m.relates_to"] = relatesTo;
  await client.sendEvent(room.roomId, EventType.Sticker, content as never);
}

/** Добавить картинку (или чужой стикер) в свой набор. Зашифрованную — расшифровываем и загружаем заново. */
export async function addToMyStickers(client: MatrixClient, content: Record<string, any>): Promise<void> {
  let url: string | undefined = content.url;
  const info: Record<string, unknown> = { ...(content.info ?? {}) };
  delete info.thumbnail_file;
  delete info.thumbnail_url;
  delete info.thumbnail_info;
  if (!url && content.file) {
    const blob = await fetchMedia(client, content);
    const up = await client.uploadContent(blob, { type: String(info.mimetype ?? blob.type ?? "image/png"), name: "sticker" });
    url = up.content_uri;
  }
  if (!url) throw new Error(tr("Не удалось добавить стикер"));
  const cur = (client.getAccountData(USER as never)?.getContent() as PackContent | undefined) ?? {};
  const images = { ...(cur.images ?? {}) };
  if (Object.values(images).some((im) => im.url === url)) return; // уже есть
  images[`sticker_${Date.now().toString(36)}`] = { url, body: tr("Стикер"), info, usage: ["sticker"] };
  await client.setAccountData(USER as never, { ...cur, pack: { display_name: tr("Мои стикеры"), ...(cur.pack ?? {}) }, images } as never);
}

export async function removeMySticker(client: MatrixClient, key: string): Promise<void> {
  const cur = (client.getAccountData(USER as never)?.getContent() as PackContent | undefined) ?? {};
  const images = { ...(cur.images ?? {}) };
  delete images[key];
  await client.setAccountData(USER as never, { ...cur, images } as never);
}
