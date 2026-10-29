import { useEffect, useReducer, useSyncExternalStore } from "react";
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  type MatrixClient,
} from "matrix-js-sdk";

/**
 * Перерисовывает компонент на любые изменения состояния клиента
 * (новые сообщения, расшифровка, комнаты, приглашения, имена).
 * Для MVP этого достаточно; позже можно сузить подписки по комнате.
 */
export function useClientUpdates(client: MatrixClient): void {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        bump();
      });
    };
    const events = [
      RoomEvent.Timeline,
      RoomEvent.Name,
      RoomEvent.MyMembership,
      RoomEvent.Receipt,
      RoomEvent.UnreadNotifications,
      RoomEvent.LocalEchoUpdated,
      RoomEvent.Redaction,
      MatrixEventEvent.Decrypted,
      RoomMemberEvent.Name,
      RoomMemberEvent.Typing,
      ClientEvent.Room,
      ClientEvent.DeleteRoom,
      ClientEvent.Sync,
      ClientEvent.AccountData,
      RoomEvent.Tags,
      RoomStateEvent.Events,
      RoomMemberEvent.PowerLevel,
      RoomMemberEvent.Membership,
    ] as const;
    for (const ev of events) (client as any).on(ev, schedule);
    return () => {
      for (const ev of events) (client as any).off(ev, schedule);
    };
  }, [client]);
}

// ---------- телефонная раскладка ----------
const narrowQuery = typeof matchMedia === "function" ? matchMedia("(max-width: 720px)") : null;
/** Узкий экран (телефон): одна колонка, пузыри сообщений, стеклянные панели. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (f) => {
      narrowQuery?.addEventListener("change", f);
      return () => narrowQuery?.removeEventListener("change", f);
    },
    () => !!narrowQuery?.matches,
  );
}
