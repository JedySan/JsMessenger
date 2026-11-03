import { useEffect, useRef, useState } from "react";
import { KnownMembership, UserEvent, type MatrixClient } from "matrix-js-sdk";
import { ArrowLeftRight, Bell, Check, Layers, MessageSquare, UserPlus, VolumeX, Download, Info, LogOut, MonitorSmartphone, MoreHorizontal, PhoneCall, Power, ShieldAlert, Languages, UserRound } from "lucide-react";
import { useClientUpdates, useNarrow } from "../hooks";
import type { Account } from "../App";
import { SettingsPage, SpacesPage, TabBar, type Tab } from "./MobileNav";
import { ChevronLeft } from "lucide-react";
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
import ProfileDialog from "./Profile";
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
import { PopupMenu, type MenuItem } from "./ui";
import { electron, isDesktop } from "../platform";
import { setPref, usePrefs } from "../prefs";
import { attachNotifications, onNotificationClick, testNotification, unreadTotal, updateBadge } from "../notifications";
import { LANGS, lang, setLang, tr } from "../i18n";
import { ask, notice } from "./Ask";

export default function Main({
  client,
  accounts,
  initialRoom,
  onSwitchAccount,
  onAddAccount,
  onForeignRoom,
  onOpenInAccount,
  onLogout,
}: {
  client: MatrixClient;
  /** все аккаунты (этот — среди них) */
  accounts: Account[];
  /** открыть сразу после входа в аккаунт (нажали уведомление из него) */
  initialRoom?: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  /** чат не из этого аккаунта: true — его открыл другой аккаунт */
  onForeignRoom: (roomId: string) => boolean;
  /** открыть чат в другом аккаунте */
  onOpenInAccount: (userId: string, roomId: string) => void;
  onLogout: () => void;
}) {
  useClientUpdates(client);
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [roomId, setRoomId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [verifyTick, setVerifyTick] = useState(0);
  const [showAbout, setShowAbout] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [, bumpProfile] = useState(0);
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
  // своё имя и аватар меняются — перерисовать строку профиля
  useEffect(() => {
    const u = client.getUser(client.getSafeUserId());
    if (!u) return;
    const f = () => bumpProfile((x) => x + 1);
    u.on(UserEvent.DisplayName, f);
    u.on(UserEvent.AvatarUrl, f);
    return () => {
      u.off(UserEvent.DisplayName, f);
      u.off(UserEvent.AvatarUrl, f);
    };
  }, [client]);
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
    if (!client.getRoom(id) && onForeignRoom(id)) return;
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
  useEffect(() => {
    if (initialRoom && client.getRoom(initialRoom)) openRoom(initialRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeScope = (s: Scope) => {
    setScope(s);
    setMobileView("list");
    // в пространстве сначала показываем его страницу
    if (s.kind === "space") setRoomId(null);
  };

  // другие аккаунты: имя, аватар, непрочитанные
  const others = accounts
    .filter((a) => a.session.userId !== client.getSafeUserId())
    .map((a) => {
      const u = a.client?.getUser(a.session.userId);
      return {
        userId: a.session.userId,
        name: u?.displayName || a.session.userId,
        avatar: u?.avatarUrl ?? undefined,
        client: a.client,
        unread: a.client ? unreadTotal(a.client) : 0,
        error: a.error,
      };
    });
  const othersUnread = others.reduce((n, a) => n + a.unread, 0);
  const prefs = usePrefs();
  // общий список: чаты готовых к работе других аккаунтов рядом с чатами этого
  const unifiedOthers = prefs.unified ? others.flatMap((a) => (a.client ? [a.client] : [])) : [];
  const accountItems: MenuItem[] = [
    ...others.map((a) => ({
      label: a.name,
      hint: a.unread ? String(a.unread > 99 ? "99+" : a.unread) : a.client ? a.userId.split(":")[1] : tr("подключается…"),
      icon: <ArrowLeftRight size={15} />,
      onClick: () => onSwitchAccount(a.userId),
    })),
    { label: tr("Добавить аккаунт"), icon: <UserPlus size={15} />, onClick: onAddAccount },
  ];

  const meItems: MenuItem[] = [
            { sep: true, label: tr("Профиль"), icon: <UserRound size={15} />, onClick: () => setShowProfile(true) },
            { label: tr("Сеансы и устройства"), icon: <MonitorSmartphone size={15} />, onClick: () => setShowSessions(true) },
            {
              sep: true,
              label: tr("Звук уведомлений"),
              icon: prefs.sound ? <Check size={15} /> : <VolumeX size={15} />,
              hint: prefs.sound ? tr("вкл.") : tr("выкл."),
              onClick: () => setPref("sound", !prefs.sound),
            },
            {
              // Windows и Linux: свои всплывашки как в Telegram или уведомления системы
              label: tr("Всплывающие уведомления"),
              icon: prefs.notifyStyle === "popup" ? <Check size={15} /> : <MessageSquare size={15} />,
              hint: prefs.notifyStyle === "popup" ? tr("как в Telegram") : tr("системные"),
              hidden: !electron(),
              onClick: () => setPref("notifyStyle", prefs.notifyStyle === "popup" ? "system" : "popup"),
            },
            {
              label: tr("Все аккаунты в одном списке"),
              icon: prefs.unified ? <Check size={15} /> : <Layers size={15} />,
              hidden: accounts.length < 2,
              onClick: () => setPref("unified", !prefs.unified),
            },
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
            { sep: true, label: tr("О программе"), icon: <Info size={15} />, onClick: () => setShowAbout(true) },
            {
              label: tr("Закрыть JsMessenger полностью"),
              icon: <Power size={15} />,
              hidden: !isDesktop(),
              onClick: () => quitApp(),
            },
            {
              sep: true,
              label: tr("Выйти из аккаунта"),
              icon: <LogOut size={15} />,
              danger: true,
              onClick: () =>
                void ask(tr("Выйти из аккаунта на этом устройстве?"), { ok: tr("Выйти"), danger: true }).then((ok): unknown => ok && onLogout()),
            },
];

  // телефон: вкладки внизу вместо колонки пространств
  const narrow = useNarrow();
  const [tab, setTab] = useState<Tab>("chats");
  const onTab = (t: Tab) => {
    setTab(t);
    if (t === "chats" || t === "spaces") setScope({ kind: "all" });
    if (t === "dms") setScope({ kind: "dm" });
  };
  const listSide = !narrow || tab === "chats" || tab === "dms" || (tab === "spaces" && scope.kind === "space");

  return (
    <div className={"layout " + (mobileView === "content" && (room || space) ? "show-content" : "show-list")}>
      <SpaceBar client={client} scope={scope} onScope={changeScope} />
      <aside className="sidebar">
        <div className="titlebar" data-tauri-drag-region />
        <div className="me-row">
          <button className="me-open" onClick={() => setShowProfile(true)} title={tr("Профиль")}>
            <span className="me-avatar">
              <Avatar client={client} mxc={me?.avatarUrl} name={myName} seed={client.getSafeUserId()} size={30} />
              {othersUnread > 0 && <span className="me-dot" title={tr("Непрочитанные в других аккаунтах: {0}", othersUnread)} />}
            </span>
            <span className="me-text">
              <span className="me-name">{myName}</span>
              <span className="me-id">{client.getSafeUserId()}</span>
            </span>
          </button>
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

        {verified === false && (!narrow || tab === "chats") && (
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

        {narrow && tab === "settings" && (
          <SettingsPage
            client={client}
            name={myName}
            avatar={me?.avatarUrl}
            verified={verified}
            onProfile={() => setShowProfile(true)}
            onVerify={() => setShowVerify(true)}
            items={meItems}
            accounts={others}
            onSwitchAccount={onSwitchAccount}
            onAddAccount={onAddAccount}
          />
        )}
        {narrow && tab === "spaces" && scope.kind !== "space" && <SpacesPage client={client} onOpen={(id) => setScope({ kind: "space", id })} />}
        {narrow && tab === "spaces" && scope.kind === "space" && (
          <button className="m-back" onClick={() => setScope({ kind: "all" })}>
            <ChevronLeft size={18} /> {tr("Пространства")}
          </button>
        )}
        {listSide && (
        <RoomList
          client={client}
          others={unifiedOthers}
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
        )}
        {narrow && (
          <TabBar
            client={client}
            tab={tab}
            onTab={onTab}
            // в общем списке непрочитанные других аккаунтов видны на «Чатах», иначе — на «Настройках»
            chatsExtra={unifiedOthers.length ? othersUnread : 0}
            settingsBadge={unifiedOthers.length ? 0 : othersUnread}
          />
        )}
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
      <Toasts onOpen={(id, account) => (account === client.getSafeUserId() ? openRoom(id) : onOpenInAccount(account, id))} />
      <IncomingCall client={client} onOpenRoom={openRoom} />
      <ScreenPicker />
      <CallMini client={client} visible={!!callState && callState.roomId !== roomId} onOpen={openRoom} />
      <DialogHost client={client} onOpenRoom={openRoom} />
      {showVerify && <VerifyDialog client={client} onClose={() => setShowVerify(false)} />}
      {showSessions && <SessionsDialog client={client} onClose={() => setShowSessions(false)} />}
      <VerificationDialog client={client} onVerified={() => setVerifyTick((t) => t + 1)} />
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showProfile && <ProfileDialog client={client} onClose={() => setShowProfile(false)} />}
      {meMenu && (
        <PopupMenu
          x={meMenu.x}
          y={meMenu.y}
          onClose={() => setMeMenu(null)}
          items={[...accountItems, ...meItems]}
        />
      )}
    </div>
  );
}
