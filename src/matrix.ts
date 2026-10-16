// Работа с Matrix: вход, хранение сессии, шифрование, ключ восстановления.
import {
  AutoDiscovery,
  ClientEvent,
  createClient,
  type MatrixClient,
} from "matrix-js-sdk";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";

/** Сервер по умолчанию задаётся при сборке: VITE_DEFAULT_SERVER=matrix.example.com npm run tauri build */
export const DEFAULT_SERVER: string = (import.meta.env.VITE_DEFAULT_SERVER ?? "").trim();
const SESSION_KEY = "jsm.session";
const DEVICE_NAME = "JsMessenger (macOS)";

export interface Session {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

// ---------- хранение сессии ----------
// TODO (этап 3): перенести токен в связку ключей macOS через Tauri-плагин.
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
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
  saveSession(session);
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
  clearSession();
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
  if (!crypto) throw new Error("Шифрование не инициализировано");

  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(recoveryKey.trim());
  } catch {
    throw new Error("Неверный формат ключа восстановления");
  }

  const keyId = await client.secretStorage.getDefaultKeyId();
  if (!keyId) throw new Error("На аккаунте не настроено секретное хранилище (настройте резервную копию в Element)");
  const keyInfo = await client.secretStorage.getKey(keyId);
  if (keyInfo && !(await client.secretStorage.checkKey(key, keyInfo[1]))) {
    throw new Error("Ключ не подходит к этому аккаунту");
  }

  pendingRecoveryKey = key;
  try {
    onProgress?.("Подтверждаю сеанс…");
    await crypto.bootstrapCrossSigning({});

    onProgress?.("Загружаю ключ резервной копии…");
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();

    onProgress?.("Восстанавливаю историю…");
    const res = await crypto.restoreKeyBackup({
      progressCallback: (p) => {
        if (p.stage === "load_keys") onProgress?.(`Восстанавливаю ключи: ${p.successes} из ${p.total}`);
      },
    });
    return { imported: res.imported, total: res.total };
  } finally {
    pendingRecoveryKey = null;
  }
}
