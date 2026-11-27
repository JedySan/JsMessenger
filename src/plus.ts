// JsMessenger Plus: тариф пользователя из сервиса на сайте (services/feedback/plus.mjs).
// Вход — одноразовым OpenID-токеном Matrix: пароль никуда не уходит.
import { useEffect, useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk";

const BASE: string = ((import.meta.env.VITE_JSM_CLOUD_URL ?? "").trim() || "https://jsmassenger.ru").replace(/\/+$/, "");
const KEY = "jsm.plus";

export interface PlusFeature {
  id: string;
  title: string;
  soon?: boolean;
}
export interface PlusState {
  mxid: string;
  plus: { plan: "plus"; until: number } | null;
  features: PlusFeature[];
  /** когда спрашивали сервер */
  checked: number;
}

type Store = Record<string, { session?: string; state?: PlusState }>;
function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
function store(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* без хранилища — спросим сервер заново */
  }
  listeners.forEach((f) => f());
}
const listeners = new Set<() => void>();

export class PlusError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit & { session?: string } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.session ? { Authorization: `Bearer ${init.session}` } : {}) },
    });
  } catch {
    throw new PlusError("network", "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlusError(body?.error ?? String(res.status), String(res.status));
  return body;
}

/** Войти в сервис (если ещё нет сессии) и узнать тариф. */
async function session(client: MatrixClient, fresh = false): Promise<string> {
  const me = client.getSafeUserId();
  const s = load();
  if (s[me]?.session && !fresh) return s[me].session!;
  const openid = await client.getOpenIdToken();
  const r = await call("/api/plus/auth", { method: "POST", body: JSON.stringify({ openid }) });
  const next = load();
  next[me] = { session: r.session, state: { ...r, checked: Date.now() } };
  store(next);
  return r.session;
}

async function withSession<T>(client: MatrixClient, fn: (s: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await session(client));
  } catch (e) {
    // сессия истекла или её сбросили — входим заново один раз
    if (e instanceof PlusError && e.code === "session") return fn(await session(client, true));
    throw e;
  }
}

/** Обновить тариф с сервера. */
export async function refreshPlus(client: MatrixClient): Promise<PlusState> {
  const r = await withSession(client, (s) => call("/api/plus/me", { session: s }));
  const st: PlusState = { ...r, checked: Date.now() };
  const next = load();
  next[client.getSafeUserId()] = { ...next[client.getSafeUserId()], state: st };
  store(next);
  return st;
}

/** Активировать код. */
export async function redeemCode(client: MatrixClient, code: string): Promise<PlusState> {
  const r = await withSession(client, (s) => call("/api/plus/redeem", { method: "POST", session: s, body: JSON.stringify({ code }) }));
  const st: PlusState = { ...r, checked: Date.now() };
  const next = load();
  next[client.getSafeUserId()] = { ...next[client.getSafeUserId()], state: st };
  store(next);
  return st;
}

/** Сохранённое состояние (без запроса). */
export function plusState(client: MatrixClient): PlusState | undefined {
  return load()[client.getSafeUserId()]?.state;
}

/** Plus действует? (по сохранённому; сервер для своих функций проверяет сам) */
export function hasPlus(client: MatrixClient): boolean {
  const p = plusState(client)?.plus;
  return !!p && p.until > Date.now();
}

/** Состояние Plus для интерфейса; раз в 6 часов тихо уточняет у сервера. */
export function usePlus(client: MatrixClient): PlusState | undefined {
  const state = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => {
      try {
        return localStorage.getItem(KEY) ?? "";
      } catch {
        return "";
      }
    },
  );
  useEffect(() => {
    const st = plusState(client);
    if (!st || Date.now() - st.checked > 6 * 3_600_000) void refreshPlus(client).catch(() => {});
  }, [client]);
  void state;
  return plusState(client);
}
