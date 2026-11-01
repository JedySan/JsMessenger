// Работа с Matrix: вход, хранение сессии, шифрование, ключ восстановления.
import {
  AutoDiscovery,
  ClientEvent,
  createClient,
  type MatrixClient,
} from "matrix-js-sdk";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";
import { tr } from "./i18n";
import { secretDelete, secretGet, secretSet, secureStoreAvailable } from "./secrets";

/** Сервер по умолчанию задаётся при сборке: VITE_DEFAULT_SERVER=matrix.example.com npm run tauri build */
export const DEFAULT_SERVER: string = (import.meta.env.VITE_DEFAULT_SERVER ?? "").trim();
const SESSION_KEY = "jsm.session";
const DEVICE_NAME = `JsMessenger (${
  window.jsmDesktop?.platform === "linux"
    ? "Linux"
    : window.jsmDesktop?.platform === "win32"
      ? "Windows"
      : /Android/i.test(navigator.userAgent)
        ? "Android"
        : /Mac/i.test(navigator.userAgent)
          ? "macOS"
          : "Web"
})`;

export interface Session {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

// ---------- хранение сессий (несколько аккаунтов) ----------
// Адрес сервера, пользователь и устройство — в локальном хранилище, а токен входа — в Связке ключей
// (macOS, iOS) или в защищённом хранилище системы (Windows, Linux). Где его нет (браузер, Android),
// токен лежит вместе с остальным.
const ACCOUNTS_KEY = "jsm.accounts";
const ACTIVE_KEY = "jsm.active";
const tokenKey = (userId: string) => `access-token:${userId}`;
type Stored = Omit<Session, "accessToken"> & { accessToken?: string; tokenInSecureStore?: boolean };

function readAll(): Stored[] {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "null") as Stored[] | null;
    if (Array.isArray(list)) return list;
    // до версии с несколькими аккаунтами сессия была одна
    const old = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Stored | null;
    return old ? [old] : [];
  } catch {
    return [];
  }
}
function writeAll(list: Stored[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  localStorage.removeItem(SESSION_KEY);
}

/** Аккаунт, который был открыт последним. */
export function getActiveUserId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}
export function setActiveUserId(userId: string) {
  localStorage.setItem(ACTIVE_KEY, userId);
}

async function restore(s: Stored): Promise<Session | null> {
  if (s.tokenInSecureStore) {
    try {
      const token = await secretGet(tokenKey(s.userId));
      if (token) return { baseUrl: s.baseUrl, userId: s.userId, deviceId: s.deviceId, accessToken: token };
    } catch (e) {
      console.warn("[session] не удалось прочитать токен из защищённого хранилища", e);
    }
    return null; // доступа к токену нет (запись удалили или отказали) — войти заново
  }
  if (!s.accessToken) return null;
  const session: Session = { baseUrl: s.baseUrl, userId: s.userId, deviceId: s.deviceId, accessToken: s.accessToken };
  await saveSession(session); // старый формат: переносим токен в защищённое хранилище
  return session;
}

/** Все сохранённые аккаунты (те, к токену которых нет доступа, пропускаются). */
export async function loadSessions(): Promise<Session[]> {
  const out: Session[] = [];
  for (const s of readAll()) {
    const session = await restore(s);
    if (session) out.push(session);
  }
  return out;
}

async function saveSession(s: Session) {
  let stored: Stored = s;
  if (await secureStoreAvailable()) {
    try {
      await secretSet(tokenKey(s.userId), s.accessToken);
      stored = { baseUrl: s.baseUrl, userId: s.userId, deviceId: s.deviceId, tokenInSecureStore: true };
    } catch (e) {
      console.warn("[session] защищённое хранилище недоступно, токен остаётся локально", e);
    }
  }
  const list = readAll().filter((x) => x.userId !== s.userId);
  writeAll([...list, stored]);
}

async function clearSession(userId: string) {
  const list = readAll();
  const s = list.find((x) => x.userId === userId);
  writeAll(list.filter((x) => x.userId !== userId));
  if (s?.tokenInSecureStore) await secretDelete(tokenKey(userId)).catch(() => {});
  if (getActiveUserId() === userId) localStorage.removeItem(ACTIVE_KEY);
}

// ---------- определение адреса сервера ----------
/** Принимает домен, URL или полный MXID и возвращает base URL клиентского API. */
export async function resolveBaseUrl(input: string): Promise<string> {
  let domain = input.trim();
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/+$/, "");
  }
  if (domain.startsWith("@") && domain.includes(":")) domain = domain.split(":").slice(1).join(":");
  try {
    const cfg = await AutoDiscovery.findClientConfig(domain);
    const hs = cfg["m.homeserver"];
    if (hs?.state === AutoDiscovery.SUCCESS && hs.base_url) return hs.base_url.replace(/\/+$/, "");
  } catch {
    /* падаем на прямой адрес ниже */
  }
  return `https://${domain}`;
}

// ---------- ключ восстановления ----------
// Ключ хранится только в памяти: нужен на время подтверждения сеанса.
let pendingRecoveryKey: Uint8Array<ArrayBuffer> | null = null;

function cryptoCallbacksFor(get: () => MatrixClient | null) {
  return {
    getSecretStorageKey: async ({ keys }: { keys: Record<string, unknown> }): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
      const client = get();
      if (!pendingRecoveryKey || !client) return null;
      const defaultId = await client.secretStorage.getDefaultKeyId();
      const keyId = defaultId && defaultId in keys ? defaultId : Object.keys(keys)[0];
      return keyId ? [keyId, pendingRecoveryKey] : null;
    },
  };
}

// ---------- клиенты: по одному на аккаунт, работают одновременно ----------
const clients = new Map<string, Promise<MatrixClient>>();
// шифрование поднимаем по очереди: одновременная инициализация двух хранилищ ключей падает в js-sdk
let cryptoQueue: Promise<unknown> = Promise.resolve();

/** Создаёт клиент, поднимает шифрование и запускает синхронизацию (один раз на аккаунт). */
export function startClient(session: Session): Promise<MatrixClient> {
  const existing = clients.get(session.userId);
  if (existing) return existing;
  let ref: MatrixClient | null = null;
  const starting = (async () => {
    const client = createClient({
      baseUrl: session.baseUrl,
      userId: session.userId,
      deviceId: session.deviceId,
      accessToken: session.accessToken,
      cryptoCallbacks: cryptoCallbacksFor(() => ref),
    });
    ref = client;
    // Хранилище ключей шифрования — IndexedDB, отдельное на каждого пользователя
    const init = cryptoQueue.then(() =>
      client.initRustCrypto({
        useIndexedDB: true,
        cryptoDatabasePrefix: `jsm-crypto-${session.userId}`,
      }),
    );
    cryptoQueue = init.catch(() => {});
    await init;
    // threadSupport: ответы в тредах живут отдельно от основной ленты, как в Element
    await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true, threadSupport: true });
    return client;
  })();
  starting.catch(() => clients.delete(session.userId));
  clients.set(session.userId, starting);
  return starting;
}

export async function login(server: string, user: string, password: string): Promise<Session> {
  const baseUrl = await resolveBaseUrl(user.includes(":") ? user : server);
  const tmp = createClient({ baseUrl });
  // этот аккаунт уже добавлен — второй вход создал бы лишнее устройство
  if (user.startsWith("@") && readAll().some((s) => s.userId === user)) throw new Error(tr("Этот аккаунт уже добавлен"));
  const res = await tmp.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: DEVICE_NAME,
  });
  const session: Session = {
    baseUrl: res.well_known?.["m.homeserver"]?.base_url?.replace(/\/+$/, "") ?? baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  if (readAll().some((s) => s.userId === session.userId)) {
    // вошли повторно в уже добавленный аккаунт: лишнее устройство сразу выводим
    await createClient({ baseUrl: session.baseUrl, accessToken: session.accessToken }).logout(true).catch(() => {});
    throw new Error(tr("Этот аккаунт уже добавлен"));
  }
  await saveSession(session);
  return session;
}

/** Выйти из одного аккаунта (остальные продолжают работать). */
export async function logout(userId: string): Promise<void> {
  const client = await clients.get(userId)?.catch(() => null);
  clients.delete(userId);
  if (client) {
    client.stopClient();
    try {
      await client.logout(true);
    } catch {
      /* токен мог уже протухнуть — всё равно чистим локально */
    }
    await client.clearStores();
  }
  await clearSession(userId);
}

/** Ждёт первой успешной синхронизации. */
export function waitForSync(client: MatrixClient): Promise<void> {
  if (client.isInitialSyncComplete()) return Promise.resolve();
  return new Promise((resolve) => {
    const onSync = (state: string) => {
      if (state === "PREPARED" || state === "SYNCING") {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });
}

// ---------- подтверждение сеанса ----------
/** true, если этот сеанс подписан кросс-подписью (подтверждён). */
export async function isThisDeviceVerified(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) return false;
  const st = await crypto.getDeviceVerificationStatus(client.getSafeUserId(), client.getDeviceId()!);
  return !!st?.crossSigningVerified;
}

/**
 * Подтверждает сеанс ключом восстановления (Security Key из Element):
 * подтягивает ключи кросс-подписи из секретного хранилища, подписывает устройство,
 * включает резервную копию ключей и восстанавливает из неё историю.
 */
export async function verifyWithRecoveryKey(
  client: MatrixClient,
  recoveryKey: string,
  onProgress?: (text: string) => void,
): Promise<{ imported: number; total: number }> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(tr("Шифрование не инициализировано"));

  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(recoveryKey.trim());
  } catch {
    throw new Error(tr("Неверный формат ключа восстановления"));
  }

  const keyId = await client.secretStorage.getDefaultKeyId();
  if (!keyId) throw new Error(tr("На аккаунте не настроено секретное хранилище (настройте резервную копию в Element)"));
  const keyInfo = await client.secretStorage.getKey(keyId);
  if (keyInfo && !(await client.secretStorage.checkKey(key, keyInfo[1]))) {
    throw new Error(tr("Ключ не подходит к этому аккаунту"));
  }

  pendingRecoveryKey = key;
  try {
    onProgress?.(tr("Подтверждаю сеанс…"));
    await crypto.bootstrapCrossSigning({});

    onProgress?.(tr("Загружаю ключ резервной копии…"));
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();

    onProgress?.(tr("Восстанавливаю историю…"));
    const res = await crypto.restoreKeyBackup({
      progressCallback: (p) => {
        if (p.stage === "load_keys") onProgress?.(tr("Восстанавливаю ключи: {0} из {1}", p.successes, p.total));
      },
    });
    return { imported: res.imported, total: res.total };
  } finally {
    pendingRecoveryKey = null;
  }
}
