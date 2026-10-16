// На чём запущен интерфейс: Tauri (macOS), Electron (Linux) или обычный браузер (npm run dev).
// Electron-часть отдаёт свои возможности через window.jsmDesktop (см. electron/preload.cjs).

export interface UpdateInfo {
  version: string;
  notes?: string;
}

export interface ElectronBridge {
  platform: string;
  notify(title: string, body: string, roomId: string): Promise<boolean>;
  onNotificationClick(cb: (roomId: string) => void): () => void;
  attention(): void;
  setBadge(count: number): void;
  saveDownload(name: string, data: Uint8Array): Promise<string>;
  openExternal(url: string): Promise<void>;
  autostartGet(): Promise<boolean>;
  autostartSet(on: boolean): Promise<void>;
  updaterEnabled(): Promise<boolean>;
  updateCheck(): Promise<UpdateInfo | null>;
  updateDownload(onProgress: (percent: number | null) => void): Promise<void>;
  updateInstall(): void;
  quit(): void;
}

declare global {
  interface Window {
    jsmDesktop?: ElectronBridge;
  }
}

export const isTauri = () => "__TAURI_INTERNALS__" in window;
export const electron = (): ElectronBridge | undefined => window.jsmDesktop;
/** Настольное приложение (любое), а не вкладка браузера. */
export const isDesktop = () => isTauri() || !!electron();
