// Уведомления о новых сообщениях и счётчик непрочитанных на иконке в Dock.
// Учитываем правила push-уведомлений аккаунта (упоминания, «без звука», настройки из Element).
import {
  EventType,
  KnownMembership,
  NotificationCountType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { isMuted, isDirect } from "./rooms";
import { plainText } from "./components/Message";

const isTauri = () => "__TAURI_INTERNALS__" in window;

// ---------- всплывающие карточки внутри приложения ----------
// macOS не показывает баннеры активного приложения, поэтому, пока окно в фокусе,
// новые сообщения из других чатов показываем сами.
export interface Toast {
  id: number;
  roomId: string;
  title: string;
  body: string;
}
let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
function emitToasts() {
  toastListeners.forEach((f) => f());
}
export function subscribeToasts(f: () => void): () => void {
  toastListeners.add(f);
  return () => {
    toastListeners.delete(f);
  };
}
export function getToasts(): Toast[] {
  return toasts;
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}
function pushToast(roomId: string, title: string, body: string) {
  const id = ++toastSeq;
  // в одном чате — одна карточка, свежая заменяет старую; не больше трёх сразу
  toasts = [...toasts.filter((t) => t.roomId !== roomId), { id, roomId, title, body }].slice(-3);
  emitToasts();
  setTimeout(() => dismissToast(id), 6000);
}
let permission: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permission !== null) return permission;
  try {
    if (isTauri()) {
      const n = await import("@tauri-apps/plugin-notification");
      permission = (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
    } else if ("Notification" in window) {
      permission = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
    } else permission = false;
  } catch {
    permission = false;
  }
  return permission;
}

async function show(title: string, body: string, roomId = "") {
  try {
    if (isTauri()) {
      // 1) современные уведомления macOS (UNUserNotificationCenter) из Rust-части
      const { invoke } = await import("@tauri-apps/api/core");
      if (await invoke<boolean>("native_notify", { title, body, roomId })) return;
      // 2) запасной путь — плагин (режим разработки, другие ОС)
      if (!(await ensurePermission())) return;
      const n = await import("@tauri-apps/plugin-notification");
      n.sendNotification({ title, body, sound: "Default" });
    } else {
      if (!(await ensurePermission())) return;
      new Notification(title, { body });
    }
  } catch (e) {
    console.error("notification", e);
  }
}

/** Клик по системному уведомлению → открыть чат. */
export async function onNotificationClick(open: (roomId: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("notification-click", (e) => e.payload && open(e.payload));
}

/** Иконка в Dock подпрыгивает один раз — сигнал, даже если баннеры уведомлений отключены. */
async function bounceDock() {
  if (!isTauri() || document.hasFocus()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch {
    /* не критично */
  }
}

/** Проверка из меню: через 5 секунд отправляет системное уведомление. */
export async function testNotification(): Promise<string> {
  let native: [boolean, boolean | null] = [false, null];
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    native = await invoke<[boolean, boolean | null]>("native_notify_status").catch(() => [false, null] as [boolean, null]);
  }
  setTimeout(() => {
    show("JsMessenger", "Проверка уведомлений: если вы это видите, всё работает");
    bounceDock();
  }, 5000);
  if (native[0] && native[1] === false) {
    return "macOS запретила уведомления для JsMessenger. Откройте «Системные настройки → Уведомления → JsMessenger» и включите «Разрешить уведомления» (стиль «Баннеры»).";
  }
  if (native[0]) {
    return "Через 5 секунд придёт тестовое уведомление (можно не переключаться — баннер покажется и поверх окна). Если его нет: «Системные настройки → Уведомления → JsMessenger» — включите уведомления; проверьте режим «Не беспокоить».";
  }
  return import.meta.env.DEV
    ? "Через 5 секунд придёт тестовое уведомление. В режиме разработки оно приходит от имени «Терминала» и только когда окно неактивно — переключитесь в другое приложение."
    : "Через 5 секунд придёт тестовое уведомление — переключитесь в другое окно. Если баннера не будет, проверьте «Системные настройки → Уведомления».";
}

const NOTIFY_TYPES = new Set<string>([EventType.RoomMessage, EventType.Sticker]);

/**
 * Подписывается на новые события. currentRoom — какая комната сейчас открыта
 * (по ней не уведомляем, если окно активно).
 */
export function attachNotifications(client: MatrixClient, currentRoom: () => string | null): () => void {
  const me = client.getSafeUserId();
  // события первой синхронизации — это история, а не новые сообщения
  const startedAt = Date.now();

  const onTimeline = async (
    ev: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    _removed: boolean,
    data: { liveEvent?: boolean },
  ) => {
    if (!room || toStartOfTimeline || !data?.liveEvent) return;
    if (ev.getSender() === me || ev.getTs() < startedAt - 5_000) return;
    if (room.getMyMembership() !== KnownMembership.Join) return;
    if (isMuted(client, room)) return;
    if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev).catch(() => {});
    if (!NOTIFY_TYPES.has(ev.getType()) || ev.isRelation("m.replace")) return;
    const actions = client.getPushActionsForEvent(ev, true);
    if (!actions?.notify) return;
    if (document.hasFocus() && currentRoom() === room.roomId) return;

    const sender = room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "";
    const title = isDirect(client, room) ? sender : `${sender} в «${room.name}»`;
    const body = ev.isDecryptionFailure() ? "Новое зашифрованное сообщение" : plainText(ev).slice(0, 200);
    if (document.hasFocus()) pushToast(room.roomId, title, body);
    else {
      show(title, body, room.roomId);
      bounceDock();
    }
  };

  client.on(RoomEvent.Timeline, onTimeline as never);
  ensurePermission();
  return () => {
    client.off(RoomEvent.Timeline, onTimeline as never);
  };
}

let lastBadge = -1;
/** Число на иконке в Dock: непрочитанные во всех комнатах, кроме отключённых. */
export function updateBadge(client: MatrixClient) {
  let total = 0;
  for (const r of client.getRooms()) {
    if (r.getMyMembership() === KnownMembership.Invite) {
      total += 1;
      continue;
    }
    if (r.getMyMembership() !== KnownMembership.Join || isMuted(client, r)) continue;
    total += r.getUnreadNotificationCount(NotificationCountType.Total);
  }
  if (total === lastBadge) return;
  lastBadge = total;
  if (isTauri()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setBadgeCount(total > 0 ? total : undefined))
      .catch(() => {});
  } else {
    document.title = total > 0 ? `(${total}) JsMessenger` : "JsMessenger";
  }
}
