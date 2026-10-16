// Единая точка открытия диалогов из любого места интерфейса.
import { useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { AddExistingDialog, CreateRoomDialog, InviteDialog, StartChatDialog } from "./Dialogs";
import RoomInfo from "./RoomInfo";
import { Modal } from "./ui";

export type DialogState =
  | { kind: "createRoom"; spaceId?: string }
  | { kind: "createSpace"; parentId?: string }
  | { kind: "startChat" }
  | { kind: "invite"; roomId: string }
  | { kind: "addExisting"; spaceId: string }
  | { kind: "spaceSettings"; spaceId: string; tab?: "members" | "settings" };

let current: DialogState | null = null;
const listeners = new Set<() => void>();

export function openDialog(d: DialogState) {
  current = d;
  listeners.forEach((f) => f());
}
function closeDialog() {
  current = null;
  listeners.forEach((f) => f());
}

export default function DialogHost({ client, onOpenRoom }: { client: MatrixClient; onOpenRoom: (roomId: string) => void }) {
  const d = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
  if (!d) return null;
  switch (d.kind) {
    case "createRoom":
      return <CreateRoomDialog client={client} kind="room" spaceId={d.spaceId} onClose={closeDialog} onCreated={onOpenRoom} />;
    case "createSpace":
      return <CreateRoomDialog client={client} kind="space" spaceId={d.parentId} onClose={closeDialog} onCreated={onOpenRoom} />;
    case "startChat":
      return <StartChatDialog client={client} onClose={closeDialog} onOpened={onOpenRoom} />;
    case "invite": {
      const room = client.getRoom(d.roomId);
      return room ? <InviteDialog client={client} room={room} onClose={closeDialog} /> : null;
    }
    case "addExisting": {
      const space = client.getRoom(d.spaceId);
      return space ? <AddExistingDialog client={client} space={space} onClose={closeDialog} /> : null;
    }
    case "spaceSettings": {
      const space = client.getRoom(d.spaceId);
      return space ? (
        <Modal title={space.name} onClose={closeDialog} wide>
          <RoomInfo
            client={client}
            room={space}
            initialTab={d.tab ?? "settings"}
            onClose={closeDialog}
            onOpenRoom={(id) => {
              closeDialog();
              onOpenRoom(id);
            }}
          />
        </Modal>
      ) : null;
    }
  }
}
