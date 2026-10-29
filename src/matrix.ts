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

// ---------- хранение сессии ----------
// Адрес сервера, пользователь и устройство — в локальном хранилище, а токен входа — в Связке ключей
// (macOS) или в защищённом хранилище системы (Windows, Linux). Где его нет (браузер, Android),
// токен лежит вместе с остальным, как раньше.
const tokenKey = (userId: string) => `access-token:${userId}`;
type Stored = Omit<Session, "accessToken"> & { accessToken?: string; tokenInSecureStore?: boolean };

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export async function loadSession(): Promise<Session | null> {
  const s = readStored();
  if (!s) return null;
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

async function saveSession(s: Session) {
  if (await secureStoreAvailable()) {
    try {
      await secretSet(tokenKey(s.userId), s.accessToken);
      const stored: Stored = { baseUrl: s.baseUrl, userId: s.userId, deviceId: s.deviceId, tokenInSecureStore: true };
      localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
      return;
    } catch (e) {
      console.warn("[session] защищённое хранилище недоступно, токен остаётся локально", e);
    }
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

async function clearSession() {
  const s = readStored();
  localStorage.removeItem(SESSION_KEY);
  if (s?.tokenInSecureStore) await secretDelete(tokenKey(s.userId)).catch(() => {});
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

const cryptoCallbacks = {
  getSecretStorageKey: async (
    { keys }: { keys: Record<string, unknown> },
  ): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
    if (!pendingRecoveryKey || !activeClient) return null;
    const defaultId = await activeClient.secretStorage.getDefaultKeyId();
    const keyId = defaultId && defaultId in keys ? defaultId : Object.keys(keys)[0];
    return keyId ? [keyId, pendingRecoveryKey] : null;
  },
};

// ---------- клиент ----------
let activeClient: MatrixClient | null = null;
let starting: Promise<MatrixClient> | null = null;

export function getClient(): MatrixClient | null {
  return activeClient;
}

/** Создаёт клиент, поднимает шифрование и запускает синхронизацию (один раз). */
export function startClient(session: Session): Promise<MatrixClient> {
  if (starting) return starting;
  starting = (async () => {
    const client = createClient({
      baseUrl: session.baseUrl,
      userId: session.userId,
      deviceId: session.deviceId,
      accessToken: session.accessToken,
      cryptoCallbacks,
    });
    activeClient = client;
    // Хранилище ключей шифрования — IndexedDB, отдельное на каждого пользователя
    await client.initRustCrypto({
      useIndexedDB: true,
      cryptoDatabasePrefix: `jsm-crypto-${session.userId}`,
    });
    // threadSupport: ответы в тредах живут отдельно от основной ленты, как в Element
    await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true, threadSupport: true });
    return client;
  })();
  starting.catch(() => {
    starting = null;
    activeClient = null;
  });
  return starting;
}

export async function login(server: string, user: string, password: string): Promise<Session> {
  const baseUrl = await resolveBaseUrl(user.includes(":") ? user : server);
  const tmp = createClient({ baseUrl });
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
  await saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const client = activeClient;
  if (client) {
    client.stopClient();
    try {
      await client.logout(true);
    } catch {
      /* токен мог уже протухнуть — всё равно чистим локально */
    }
    await client.clearStores();
  }
  activeClient = null;
  starting = null;
  await clearSession();
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
