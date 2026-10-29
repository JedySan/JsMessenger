// Защищённое хранилище секретов (токен входа):
//   macOS и iOS (Tauri)  — Связка ключей;
//   Windows/Linux (Electron) — safeStorage: шифрование ключом системы (DPAPI, libsecret/KWallet);
//   браузер и Android    — недоступно, тогда токен остаётся в локальном хранилище, как раньше.
import { electron, isIOSApp, isMobile, isTauri } from "./platform";

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Есть ли защищённое хранилище на этой платформе. */
export async function secureStoreAvailable(): Promise<boolean> {
  const el = electron();
  if (el?.secretAvailable) return el.secretAvailable();
  if (isTauri() && (!isMobile() || isIOSApp())) {
    try {
      await tauriInvoke("secret_get", { key: "probe" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function secretGet(key: string): Promise<string | null> {
  const el = electron();
  if (el?.secretGet) return el.secretGet(key);
  return tauriInvoke<string | null>("secret_get", { key });
}

export async function secretSet(key: string, value: string): Promise<void> {
  const el = electron();
  if (el?.secretSet) return el.secretSet(key, value);
  await tauriInvoke("secret_set", { key, value });
}

export async function secretDelete(key: string): Promise<void> {
  const el = electron();
  if (el?.secretDelete) return el.secretDelete(key);
  await tauriInvoke("secret_delete", { key });
}
