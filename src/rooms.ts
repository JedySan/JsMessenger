// Пространства, личные чаты, создание комнат, теги, отключение звука.
import {
  EventType,
  KnownMembership,
  Preset,
  PushRuleKind,
  Visibility,
  type MatrixClient,
  type Room,
} from "matrix-js-sdk";
import { locale, tr } from "./i18n";

export type Scope = { kind: "all" } | { kind: "dm" } | { kind: "space"; id: string };

const SPACE_CHILD = "m.space.child";
const SPACE_PARENT = "m.space.parent";

// ---------- пространства ----------
export function joinedSpaces(client: MatrixClient): Room[] {
  return client.getRooms().filter((r) => r.isSpaceRoom() && r.getMyMembership() === KnownMembership.Join);
}

/** ID дочерних комнат и пространств (по событиям m.space.child с непустым via). */
export function spaceChildren(space: Room): string[] {
  return space.currentState
    .getStateEvents(SPACE_CHILD)
    .filter((e) => Array.isArray(e.getContent().via) && e.getContent().via.length > 0)
    .sort((a, b) => {
      const oa = String(a.getContent().order ?? "￿");
      const ob = String(b.getContent().order ?? "￿");
      return oa < ob ? -1 : oa > ob ? 1 : (a.getStateKey() ?? "").localeCompare(b.getStateKey() ?? "");
    })
    .map((e) => e.getStateKey()!)
    .filter(Boolean);
}

/** Пространства верхнего уровня — те, что не вложены в другие ваши пространства. */
export function topLevelSpaces(client: MatrixClient): Room[] {
  const spaces = joinedSpaces(client);
  const nested = new Set(spaces.flatMap(spaceChildren));
  return spaces.filter((s) => !nested.has(s.roomId)).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Все комнаты пространства, включая вложенные пространства. */
export function roomIdsInSpace(client: MatrixClient, spaceId: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(spaceId)) return out;
  seen.add(spaceId);
  const space = client.getRoom(spaceId);
  if (!space) return out;
  for (const id of spaceChildren(space)) {
    const child = client.getRoom(id);
    if (child?.isSpaceRoom()) roomIdsInSpace(client, id, seen).forEach((x) => out.add(x));
    else out.add(id);
  }
  return out;
}

export function serverOf(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}

// ---------- личные чаты ----------
export function directRoomIds(client: MatrixClient): Set<string> {
  const content = (client.getAccountData(EventType.Direct as never)?.getContent() ?? {}) as Record<string, string[]>;
  return new Set(Object.values(content).flat());
}

export function isDirect(client: MatrixClient, room: Room, directs = directRoomIds(client)): boolean {
  return directs.has(room.roomId) || !!room.getDMInviter();
}

/** Находит существующий личный чат с пользователем или создаёт новый. */
export async function openDirectChat(client: MatrixClient, userId: string): Promise<string> {
  const content = { ...((client.getAccountData(EventType.Direct as never)?.getContent() ?? {}) as Record<string, string[]>) };
  for (const id of content[userId] ?? []) {
    const r = client.getRoom(id);
    if (r && (r.getMyMembership() === KnownMembership.Join || r.getMyMembership() === KnownMembership.Invite)) return id;
  }
  const { room_id } = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    initial_state: [{ type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
  });
  content[userId] = [...(content[userId] ?? []), room_id];
  await client.setAccountData(EventType.Direct as never, content as never);
  return room_id;
}

// ---------- создание ----------
export interface CreateRoomOptions {
  name: string;
  topic?: string;
  encrypted: boolean;
  /** invite — по приглашению; space — все участники пространства; public — любой на сервере */
  access: "invite" | "space" | "public";
  spaceId?: string;
  invite?: string[];
}

export async function createRoom(client: MatrixClient, o: CreateRoomOptions): Promise<string> {
  const initial_state: Array<{ type: string; state_key: string; content: Record<string, unknown> }> = [];
  if (o.encrypted) initial_state.push({ type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } });
  if (o.spaceId) {
    initial_state.push({ type: SPACE_PARENT, state_key: o.spaceId, content: { via: [serverOf(o.spaceId)], canonical: true } });
    if (o.access === "space") {
      initial_state.push({
        type: EventType.RoomJoinRules,
        state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: o.spaceId }] },
      });
    }
  }
  if (o.access === "public") {
    initial_state.push({ type: EventType.RoomHistoryVisibility, state_key: "", content: { history_visibility: "shared" } });
  }
  const { room_id } = await client.createRoom({
    name: o.name,
    topic: o.topic || undefined,
    preset: o.access === "public" ? Preset.PublicChat : Preset.PrivateChat,
    visibility: Visibility.Private,
    invite: o.invite,
    initial_state,
  });
  if (o.spaceId) await addToSpace(client, o.spaceId, room_id);
  return room_id;
}

export async function createSpace(
  client: MatrixClient,
  o: { name: string; topic?: string; isPublic: boolean; parentId?: string },
): Promise<string> {
  const { room_id } = await client.createRoom({
    name: o.name,
    topic: o.topic || undefined,
    preset: o.isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: { type: "m.space" },
    // как в Element: писать «сообщения» в пространство могут только админы, приглашать — все
    power_level_content_override: { events_default: 100, invite: o.isPublic ? 0 : 50 },
    initial_state: [
      { type: EventType.RoomHistoryVisibility, state_key: "", content: { history_visibility: o.isPublic ? "world_readable" : "invited" } },
    ],
  });
  if (o.parentId) await addToSpace(client, o.parentId, room_id);
  return room_id;
}

export async function addToSpace(client: MatrixClient, spaceId: string, roomId: string): Promise<void> {
  await client.sendStateEvent(spaceId, SPACE_CHILD as never, { via: [serverOf(roomId)], suggested: false } as never, roomId);
  // родителя прописываем, только если есть права в самой комнате
  const room = client.getRoom(roomId);
  if (room?.currentState.maySendStateEvent(SPACE_PARENT, client.getSafeUserId())) {
    await client
      .sendStateEvent(roomId, SPACE_PARENT as never, { via: [serverOf(spaceId)], canonical: true } as never, spaceId)
      .catch(() => {});
  }
}

export async function removeFromSpace(client: MatrixClient, spaceId: string, roomId: string): Promise<void> {
  await client.sendStateEvent(spaceId, SPACE_CHILD as never, {} as never, roomId);
  const room = client.getRoom(roomId);
  if (room?.currentState.getStateEvents(SPACE_PARENT, spaceId) && room.currentState.maySendStateEvent(SPACE_PARENT, client.getSafeUserId())) {
    await client.sendStateEvent(roomId, SPACE_PARENT as never, {} as never, spaceId).catch(() => {});
  }
}

// ---------- теги и уведомления ----------
export const FAVOURITE = "m.favourite";
export const LOW_PRIORITY = "m.lowpriority";

export function isFavourite(room: Room): boolean {
  return FAVOURITE in room.tags;
}

export async function toggleFavourite(client: MatrixClient, room: Room): Promise<void> {
  if (isFavourite(room)) await client.deleteRoomTag(room.roomId, FAVOURITE);
  else {
    await client.setRoomTag(room.roomId, FAVOURITE, { order: 0.5 });
    if (LOW_PRIORITY in room.tags) await client.deleteRoomTag(room.roomId, LOW_PRIORITY).catch(() => {});
  }
}

/** Комната без звука — правило override с пустыми действиями (так делает Element). */
export function isMuted(client: MatrixClient, room: Room): boolean {
  const rules = client.pushRules?.global?.override ?? [];
  return rules.some((r) => r.rule_id === room.roomId && r.enabled !== false && (r.actions?.length ?? 0) === 0);
}

export async function toggleMute(client: MatrixClient, room: Room): Promise<void> {
  if (isMuted(client, room)) {
    await client.deletePushRule("global", PushRuleKind.Override, room.roomId);
  } else {
    await client.addPushRule("global", PushRuleKind.Override, room.roomId, {
      actions: [],
      conditions: [{ kind: "event_match", key: "room_id", pattern: room.roomId } as never],
    });
  }
  // обновляем локальную копию правил, чтобы значок сменился сразу
  client.pushRules = await client.getPushRules();
}

export async function leaveRoom(client: MatrixClient, room: Room): Promise<void> {
  await client.leave(room.roomId);
  await client.forget(room.roomId).catch(() => {});
}

// ---------- роли ----------
export function powerLevelOf(room: Room, userId: string): number {
  return room.getMember(userId)?.powerLevel ?? 0;
}

export function roleName(level: number): string | null {
  if (level >= 100) return tr("Администратор");
  if (level >= 50) return tr("Модератор");
  if (level > 0) return tr("Уровень {0}", level);
  return null;
}

/** Уровень, нужный для действия (kick, ban, invite, redact, state_default…). */
export function requiredLevel(room: Room, action: "kick" | "ban" | "invite" | "redact"): number {
  const pl = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {};
  const defaults = { kick: 50, ban: 50, invite: 0, redact: 50 };
  return typeof pl[action] === "number" ? pl[action] : defaults[action];
}
