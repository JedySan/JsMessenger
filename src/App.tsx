import { useEffect, useState } from "react";
import { ClientEvent, type MatrixClient } from "matrix-js-sdk";
import {
  getActiveUserId,
  loadSessions,
  logout,
  setActiveUserId,
  startClient,
  waitForSync,
  type Session,
} from "./matrix";
import Login from "./components/Login";
import Main from "./components/Main";
import Logo from "./components/Logo";
import { ask } from "./components/Ask";
import { call } from "./call";
import { attachNotifications, forgetBadge, updateBadge } from "./notifications";
import { tr } from "./i18n";

/** Аккаунт на одном из серверов Matrix. Клиенты всех аккаунтов работают одновременно. */
export interface Account {
  session: Session;
  /** готов (первая синхронизация прошла) */
  client: MatrixClient | null;
  error?: string;
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** чат, который открыть после переключения аккаунта (нажали уведомление другого аккаунта) */
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const [, bump] = useState(0);

  const update = (userId: string, patch: Partial<Account>) =>
    setAccounts((list) => list.map((a) => (a.session.userId === userId ? { ...a, ...patch } : a)));

  const start = (session: Session) => {
    startClient(session)
      .then(async (client) => {
        await waitForSync(client);
        update(session.userId, { client, error: undefined });
      })
      .catch((e: unknown) => update(session.userId, { error: errText(e) }));
  };

  // сессии: токены могут лежать в Связке ключей — читаем асинхронно
  useEffect(() => {
    loadSessions().then(
      (sessions) => {
        setAccounts(sessions.map((session) => ({ session, client: null })));
        const last = getActiveUserId();
        setActive(sessions.find((s) => s.userId === last)?.userId ?? sessions[0]?.userId ?? null);
        sessions.forEach(start);
        setBooted(true);
      },
      () => setBooted(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Аккаунты, которые сейчас не открыты: уведомления и счётчик на иконке
  const readyKey = accounts.map((a) => `${a.session.userId}:${!!a.client}`).join(",");
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const a of accounts) {
      const c = a.client;
      if (!c || a.session.userId === active) continue;
      const label = c.getUser(c.getSafeUserId())?.displayName || c.getSafeUserId();
      offs.push(attachNotifications(c, () => null, label));
      const onSync = () => {
        updateBadge(c);
        bump((x) => x + 1); // непрочитанные других аккаунтов — в переключателе
      };
      c.on(ClientEvent.Sync, onSync);
      offs.push(() => c.off(ClientEvent.Sync, onSync));
      updateBadge(c);
    }
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, readyKey]);

  const switchTo = async (userId: string, roomId?: string) => {
    if (userId === active) return;
    // звонок привязан к аккаунту — при переключении его придётся завершить
    const st = call.state;
    if (st && (st.status === "connecting" || st.status === "connected")) {
      if (!(await ask(tr("Идёт звонок. Завершить его и переключить аккаунт?"), { ok: tr("Переключить"), danger: true }))) return;
      await call.leave();
    }
    setPendingRoom(roomId ?? null);
    setActive(userId);
    setActiveUserId(userId);
    setAdding(false);
  };

  /** Чат из другого аккаунта (уведомление, ссылка) — переключаемся туда. */
  const openForeignRoom = (roomId: string): boolean => {
    const owner = accounts.find((a) => a.session.userId !== active && a.client?.getRoom(roomId));
    if (!owner) return false;
    void switchTo(owner.session.userId, roomId);
    return true;
  };

  const doLogout = async (userId: string) => {
    await logout(userId);
    forgetBadge(userId);
    const rest = accounts.filter((a) => a.session.userId !== userId);
    setAccounts(rest);
    if (userId === active) {
      const next = rest[0]?.session.userId ?? null;
      setActive(next);
      if (next) setActiveUserId(next);
    }
  };

  const onLoggedIn = (session: Session) => {
    setAccounts((list) => [...list.filter((a) => a.session.userId !== session.userId), { session, client: null }]);
    setActive(session.userId);
    setActiveUserId(session.userId);
    setAdding(false);
    start(session);
  };

  if (!booted) return <Splash />;
  if (adding || accounts.length === 0)
    return <Login onLoggedIn={onLoggedIn} onCancel={accounts.length > 0 ? () => setAdding(false) : undefined} />;

  const current = accounts.find((a) => a.session.userId === active) ?? accounts[0];
  if (current.error)
    return (
      <div className="splash">
        <div className="titlebar" data-tauri-drag-region />
        <Logo size={56} />
        <h2>{tr("Нет связи с сервером")}</h2>
        <p className="splash-sub">{current.session.userId}</p>
        <p className="form-error">{current.error}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={() => void doLogout(current.session.userId)}>
            {tr("Выйти из аккаунта")}
          </button>
          {accounts
            .filter((a) => a !== current && a.client)
            .slice(0, 1)
            .map((a) => (
              <button key={a.session.userId} className="ghost" onClick={() => void switchTo(a.session.userId)}>
                {tr("Открыть {0}", a.session.userId)}
              </button>
            ))}
          <button className="primary" onClick={() => location.reload()}>
            {tr("Повторить")}
          </button>
        </div>
      </div>
    );
  if (!current.client) return <Splash />;

  return (
    <Main
      key={current.session.userId}
      client={current.client}
      accounts={accounts}
      initialRoom={pendingRoom}
      onSwitchAccount={(id) => void switchTo(id)}
      onAddAccount={() => setAdding(true)}
      onForeignRoom={openForeignRoom}
      onOpenInAccount={(id, roomId) => void switchTo(id, roomId)}
      onLogout={() => doLogout(current.session.userId)}
    />
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="titlebar" data-tauri-drag-region />
      <Logo size={56} />
      <div className="splash-text">{tr("Загружаю чаты…")}</div>
    </div>
  );
}

export function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const any = e as { data?: { error?: string }; message?: string };
    if (any.data?.error) return any.data.error;
    if (any.message) return any.message;
  }
  return String(e);
}
