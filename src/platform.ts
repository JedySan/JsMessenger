// На чём запущен интерфейс: Tauri (macOS, Android), Electron (Windows, Linux) или обычный браузер (npm run dev).
// Electron-часть отдаёт свои возможности через window.jsmDesktop (см. electron/preload.cjs).

export interface UpdateInfo {
  version: string;
  notes?: string;
}

export interface ScreenSource {
  id: string;
  name: string;
  screen: boolean;
  thumb: string;
}

export interface ElectronBridge {
  platform: string;
  notify(title: string, body: string, roomId: string): Promise<boolean>;
  onNotificationClick(cb: (roomId: string) => void): () => void;
  attention(): void;
  showWindow(): void;
  /** язык надписей оболочки (меню в трее) */
  setLang?(lang: string): void;
  setBadge(count: number, image?: string): void;
  /** Выбор экрана/окна для показа: вернуть id источника или null (отмена). */
  onPickSource(cb: (sources: ScreenSource[]) => Promise<string | null>): () => void;
  /** в «Загрузки» (без перезаписи); возвращает путь */
  saveDownload(name: string, data: Uint8Array): Promise<string>;
  /** окно «Сохранить как…»; null — отменили */
  saveAs?(name: string, data: Uint8Array): Promise<string | null>;
  openPath?(file: string): Promise<void>;
  showItem?(file: string): Promise<void>;
  fileExists?(file: string): Promise<boolean>;
  /** защищённое хранилище (safeStorage) */
  secretAvailable?(): Promise<boolean>;
  secretGet?(key: string): Promise<string | null>;
  secretSet?(key: string, value: string): Promise<void>;
  secretDelete?(key: string): Promise<void>;
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
/** Телефон/планшет (Tauri для Android). */
export const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
/** Android-приложение (не мобильный браузер). */
export const isAndroidApp = () => isTauri() && /Android/i.test(navigator.userAgent);
/** Настольное приложение (любое), а не вкладка браузера и не телефон. */
export const isDesktop = () => (isTauri() && !isMobile()) || !!electron();
