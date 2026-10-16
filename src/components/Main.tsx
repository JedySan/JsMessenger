import { useEffect, useRef, useState } from "react";
import { KnownMembership, type MatrixClient } from "matrix-js-sdk";
import { Bell, Check, Download, Info, LogOut, MonitorSmartphone, MoreHorizontal, PhoneCall, Power, ShieldAlert } from "lucide-react";
import { useClientUpdates } from "../hooks";
import { isThisDeviceVerified } from "../matrix";
import { call } from "../call";
import { roomIdsInSpace, type Scope } from "../rooms";
import RoomList from "./RoomList";
import RoomView from "./RoomView";
import VerifyDialog from "./VerifyDialog";
import Avatar from "./Avatar";
import { Lightbox } from "./Media";
import VerificationDialog from "./VerificationDialog";
import SessionsDialog from "./SessionsDialog";
import SpaceBar from "./SpaceBar";
import SpaceHome from "./SpaceHome";
import DialogHost from "./DialogHost";
import { CallAudio, useCallState } from "./CallPanel";
import AboutDialog from "./AboutDialog";
import Toasts from "./Toasts";
import UpdateBanner from "./UpdateBanner";
import {
  checkForUpdate,
  initAutostartOnce,
  isAutostartEnabled,
  quitApp,
  setAutostart,
  startUpdateChecks,
  updaterEnabled,
} from "../desktop";
import { PopupMenu } from "./ui";
import { isDesktop } from "../platform";
import { attachNotifications, onNotificationClick, testNotification, updateBadge } from "../notifications";

export default function Main({ client, onLogout }: { client: MatrixClient; onLogout: () => void }) {
  useClientUpdates(client);
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [roomId, setRoomId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [verifyTick, setVerifyTick] = useState(0);
  const [showAbout, setShowAbout] = useState(false);
  const [meMenu, setMeMenu] = useState<{ x: number; y: number } | null>(null);
  const [autostart, setAutostartState] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);

  // Настольные возможности: автообновление и автозапуск
  useEffect(() => {
    startUpdateChecks();
    updaterEnabled().then(setCanUpdate);
    initAutostartOnce().then(() => isAutostartEnabled().then(setAutostartState));
  }, []);

  // Уведомления: не показываем по открытой комнате, если окно активно
  const currentRoom = useRef<string | null>(null);
  currentRoom.current = roomId;
  useEffect(() => attachNotifications(client, () => currentRoom.current), [client]);
  // Клик по системному уведомлению открывает чат
  const openRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    let off = () => {};
    onNotificationClick((id) => openRef.current(id)).then((f) => (off = f));
    return () => off();
  }, []);
  // Счётчик на иконке в Dock — после каждого обновления данных
  useEffect(() => updateBadge(client));

  useEffect(() => {
    isThisDeviceVerified(client).then(setVerified, () => setVerified(false));
  }, [client, showVerify, showSessions, verifyTick]);

  const callState = useCallState();
  const room = roomId ? client.getRoom(roomId) : null;
  const callRoom = callState ? client.getRoom(callState.roomId) : null;
  const me = client.getUser(client.getSafeUserId());
  const myName = me?.displayName ?? client.getSafeUserId();
  const space = scope.kind === "space" ? client.getRoom(scope.id) : null;

  // Покинули комнату или пространство (или нас удалили) — закрываем.
  // Только «leave»/«ban»: сразу после вступления членство ещё может быть «invite» до синхронизации.
  const gone = (m?: string) => m === KnownMembership.Leave || m === KnownMembership.Ban;
  useEffect(() => {
    if (room && gone(room.getMyMembership())) setRoomId(null);
    if (scope.kind === "space" && space && gone(space.getMyMembership())) setScope({ kind: "all" });
  });

  /** Открыть комнату; для пространства — его страницу. */
  const openRoom = (id: string) => {
    const r = client.getRoom(id);
    if (r?.isSpaceRoom()) {
      setScope({ kind: "space", id });
      setRoomId(null);
      return;
    }
    // если комната вне текущего пространства — переключаемся на «Все чаты»
    if (scope.kind === "space" && !roomIdsInSpace(client, scope.id).has(id)) setScope({ kind: "all" });
    setRoomId(id);
  };

  openRef.current = openRoom;

  const changeScope = (s: Scope) => {
    setScope(s);
    // в пространстве сначала показываем его страницу
    if (s.kind === "space") setRoomId(null);
  };

  return (
    <div className="layout">
      <SpaceBar client={client} scope={scope} onScope={changeScope} />
      <aside className="sidebar">
        <div className="titlebar" data-tauri-drag-region />
        <div className="me-row">
          <Avatar client={client} mxc={me?.avatarUrl} name={myName} seed={client.getSafeUserId()} size={30} />
          <div className="me-text">
            <div className="me-name">{myName}</div>
            <div className="me-id">{client.getSafeUserId()}</div>
          </div>
          <button className="icon-btn" onClick={() => setShowSessions(true)} title="Сеансы и устройства" aria-label="Сеансы и устройства">
            <MonitorSmartphone size={17} />
          </button>
          <button
            className="icon-btn"
            onClick={(e) => setMeMenu({ x: e.clientX - 20, y: e.clientY + 12 })}
            title="Ещё"
            aria-label="Ещё"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>

        {verified === false && (
          <button className="notice" onClick={() => setShowVerify(true)}>
            <ShieldAlert size={18} className="notice-icon" />
            <span>
              <strong>Сеанс не подтверждён</strong>
              <br />
              Подтвердите его, чтобы видеть историю зашифрованных чатов
            </span>
          </button>
        )}

        {callState && callRoom && callState.roomId !== roomId && (
          <div className="call-bar">
            <button className="call-bar-room" onClick={() => openRoom(callState.roomId)}>
              <PhoneCall size={15} />
              <span>
                Идёт звонок
                <br />
                <b>{callRoom.name}</b>
              </span>
            </button>
            <button className="pill danger" onClick={() => call.leave()}>
              Завершить
            </button>
          </div>
        )}

        <UpdateBanner />

        <RoomList
          client={client}
          scope={scope}
          selected={roomId}
          onSelect={openRoom}
          onOpenInfo={(id) => {
            if (client.getRoom(id)?.isSpaceRoom()) {
              setScope({ kind: "space", id });
              setRoomId(null);
            } else {
              setRoomId(id);
              setInfoOpen(true);
            }
          }}
        />
      </aside>

      <main className="content">
        {room ? (
          <RoomView
            key={room.roomId}
            client={client}
            room={room}
            infoOpen={infoOpen}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            onOpenRoom={openRoom}
          />
        ) : space ? (
          <SpaceHome
            key={space.roomId}
            client={client}
            space={space}
            onOpenRoom={openRoom}
            onOpenSpace={(id) => changeScope({ kind: "space", id })}
          />
        ) : (
          <div className="empty">
            <div className="titlebar" data-tauri-drag-region />
            <div className="empty-body">
              <div className="empty-title">Выберите чат слева</div>
              <div className="empty-text">Или нажмите «+» над списком, чтобы начать личный чат или создать комнату</div>
            </div>
          </div>
        )}
      </main>
      <CallAudio />
      <Lightbox />
      <Toasts onOpen={openRoom} />
      <DialogHost client={client} onOpenRoom={openRoom} />
      {showVerify && <VerifyDialog client={client} onClose={() => setShowVerify(false)} />}
      {showSessions && <SessionsDialog client={client} onClose={() => setShowSessions(false)} />}
      <VerificationDialog client={client} onVerified={() => setVerifyTick((t) => t + 1)} />
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {meMenu && (
        <PopupMenu
          x={meMenu.x}
          y={meMenu.y}
          onClose={() => setMeMenu(null)}
          items={[
            { label: "Сеансы и устройства", icon: <MonitorSmartphone size={15} />, onClick: () => setShowSessions(true) },
            {
              label: "Проверить уведомления",
              icon: <Bell size={15} />,
              onClick: () => testNotification().then((msg) => alert(msg)),
            },
            {
              label: "Запускать при входе в систему",
              icon: autostart ? <Check size={15} /> : <Power size={15} />,
              hidden: !isDesktop(),
              onClick: () =>
                setAutostart(!autostart)
                  .then(() => setAutostartState(!autostart))
                  .catch((e) => alert(`Не удалось изменить автозапуск: ${e}`)),
            },
            {
              label: "Проверить обновления",
              icon: <Download size={15} />,
              hidden: !canUpdate,
              onClick: () => checkForUpdate(false),
            },
            { label: "О программе", icon: <Info size={15} />, onClick: () => setShowAbout(true) },
            {
              label: "Закрыть JsMessenger полностью",
              icon: <Power size={15} />,
              hidden: !isDesktop(),
              onClick: () => quitApp(),
            },
            {
              label: "Выйти из аккаунта",
              icon: <LogOut size={15} />,
              danger: true,
              onClick: () => confirm("Выйти из аккаунта на этом устройстве?") && onLogout(),
            },
          ]}
        />
      )}
    </div>
  );
}
