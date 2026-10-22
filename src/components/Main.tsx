import { useEffect, useRef, useState } from "react";
import { KnownMembership, type MatrixClient } from "matrix-js-sdk";
import { Bell, Check, Download, Info, LogOut, MonitorSmartphone, MoreHorizontal, PhoneCall, Power, ShieldAlert, Languages } from "lucide-react";
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
import IncomingCall from "./IncomingCall";
import CallMini from "./CallMini";
import ScreenPicker from "./ScreenPicker";
import { attachIncomingCalls } from "../incoming";
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
import { LANGS, lang, setLang, tr } from "../i18n";
import { ask, notice } from "./Ask";

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
  // Входящие звонки: окно вызова и мелодия
  useEffect(() => attachIncomingCalls(client), [client]);
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

  // На телефоне видна одна колонка: список чатов или открытый чат/пространство
  const [mobileView, setMobileView] = useState<"list" | "content">("list");
  const backToList = () => {
    setRoomId(null); // закрываем чат, чтобы не отмечать сообщения прочитанными «за кадром»
    setMobileView("list");
  };

  /** Открыть комнату; для пространства — его страницу. */
  const openRoom = (id: string) => {
    setMobileView("content");
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
    setMobileView("list");
    // в пространстве сначала показываем его страницу
    if (s.kind === "space") setRoomId(null);
  };

  return (
    <div className={"layout " + (mobileView === "content" && (room || space) ? "show-content" : "show-list")}>
      <SpaceBar client={client} scope={scope} onScope={changeScope} />
      <aside className="sidebar">
        <div className="titlebar" data-tauri-drag-region />
        <div className="me-row">
          <Avatar client={client} mxc={me?.avatarUrl} name={myName} seed={client.getSafeUserId()} size={30} />
          <div className="me-text">
            <div className="me-name">{myName}</div>
            <div className="me-id">{client.getSafeUserId()}</div>
          </div>
          <button className="icon-btn" onClick={() => setShowSessions(true)} title={tr("Сеансы и устройства")} aria-label={tr("Сеансы и устройства")}>
            <MonitorSmartphone size={17} />
          </button>
          <button
            className="icon-btn"
            onClick={(e) => setMeMenu({ x: e.clientX - 20, y: e.clientY + 12 })}
            title={tr("Ещё")}
            aria-label={tr("Ещё")}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>

        {verified === false && (
          <button className="notice" onClick={() => setShowVerify(true)}>
            <ShieldAlert size={18} className="notice-icon" />
            <span>
              <strong>{tr("Сеанс не подтверждён")}</strong>
              <br />
              {tr("Подтвердите его, чтобы видеть историю зашифрованных чатов")}
            </span>
          </button>
        )}

        {callState && callRoom && callState.roomId !== roomId && (callState.status === "connecting" || callState.status === "connected") && (
          <div className="call-bar">
            <button className="call-bar-room" onClick={() => openRoom(callState.roomId)}>
              <PhoneCall size={15} />
              <span>
                {tr("Идёт звонок")}
                <br />
                <b>{callRoom.name}</b>
              </span>
            </button>
            <button className="pill danger" onClick={() => call.leave()}>
              {tr("Завершить")}
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
            setMobileView("content");
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
            onBack={backToList}
          />
        ) : space ? (
          <SpaceHome
            key={space.roomId}
            client={client}
            space={space}
            onOpenRoom={openRoom}
            onOpenSpace={(id) => changeScope({ kind: "space", id })}
            onBack={() => setMobileView("list")}
          />
        ) : (
          <div className="empty">
            <div className="titlebar" data-tauri-drag-region />
            <div className="empty-body">
              <div className="empty-title">{tr("Выберите чат слева")}</div>
              <div className="empty-text">{tr("Или нажмите «+» над списком, чтобы начать личный чат или создать комнату")}</div>
            </div>
          </div>
        )}
      </main>
      <CallAudio />
      <Lightbox />
      <Toasts onOpen={openRoom} />
      <IncomingCall client={client} onOpenRoom={openRoom} />
      <ScreenPicker />
      <CallMini client={client} visible={!!callState && callState.roomId !== roomId} onOpen={openRoom} />
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
            { label: tr("Сеансы и устройства"), icon: <MonitorSmartphone size={15} />, onClick: () => setShowSessions(true) },
            {
              label: tr("Проверить уведомления"),
              icon: <Bell size={15} />,
              onClick: () => testNotification().then((msg) => notice(msg)),
            },
            {
              label: tr("Запускать при входе в систему"),
              icon: autostart ? <Check size={15} /> : <Power size={15} />,
              hidden: !isDesktop(),
              onClick: () =>
                setAutostart(!autostart)
                  .then(() => setAutostartState(!autostart))
                  .catch((e) => notice(tr("Не удалось изменить автозапуск: {0}", e))),
            },
            {
              label: tr("Проверить обновления"),
              icon: <Download size={15} />,
              hidden: !canUpdate,
              onClick: () => checkForUpdate(false),
            },
            {
              // переключаем по кругу; язык меняется после перезапуска интерфейса
              label: tr("Язык: {0}", LANGS.find((l) => l.id === lang)?.name ?? lang),
              icon: <Languages size={15} />,
              onClick: () => setLang(LANGS[(LANGS.findIndex((l) => l.id === lang) + 1) % LANGS.length].id),
            },
            { label: tr("О программе"), icon: <Info size={15} />, onClick: () => setShowAbout(true) },
            {
              label: tr("Закрыть JsMessenger полностью"),
              icon: <Power size={15} />,
              hidden: !isDesktop(),
              onClick: () => quitApp(),
            },
            {
              label: tr("Выйти из аккаунта"),
              icon: <LogOut size={15} />,
              danger: true,
              onClick: () =>
                void ask(tr("Выйти из аккаунта на этом устройстве?"), { ok: tr("Выйти"), danger: true }).then((ok): unknown => ok && onLogout()),
            },
          ]}
        />
      )}
    </div>
  );
}
