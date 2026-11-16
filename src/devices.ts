// Микрофон, камера и динамики для звонков: список устройств и выбранные (запоминаются).
import { useEffect, useState } from "react";

export type DeviceKind = "audioinput" | "videoinput" | "audiooutput";

const KEY = "jsm.devices";
type Saved = Partial<Record<DeviceKind, string>>;

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Выбранное устройство (или undefined — системное по умолчанию). */
export function savedDevice(kind: DeviceKind): string | undefined {
  return load()[kind] || undefined;
}

export function saveDevice(kind: DeviceKind, id: string) {
  const s = load();
  if (id && id !== "default") s[kind] = id;
  else delete s[kind];
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* хранилище недоступно — выбор действует до перезапуска */
  }
}

/** Выбор динамиков есть не везде (Safari/WebKit — частично). */
export const canPickSpeaker = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export interface Devices {
  audioinput: MediaDeviceInfo[];
  videoinput: MediaDeviceInfo[];
  audiooutput: MediaDeviceInfo[];
}

const EMPTY: Devices = { audioinput: [], videoinput: [], audiooutput: [] };

export async function listDevices(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) return EMPTY;
  const all = await navigator.mediaDevices.enumerateDevices();
  const by = (k: DeviceKind) => all.filter((d) => d.kind === k && d.deviceId);
  return { audioinput: by("audioinput"), videoinput: by("videoinput"), audiooutput: by("audiooutput") };
}

/** Список устройств, обновляется при подключении/отключении (наушники, камера по USB). */
export function useDevices(enabled = true): Devices {
  const [devs, setDevs] = useState<Devices>(EMPTY);
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices) return;
    let alive = true;
    const refresh = () => void listDevices().then((d) => alive && setDevs(d), () => {});
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [enabled]);
  return devs;
}

/** Подпись устройства: без разрешения браузер не отдаёт названия. */
export function deviceLabel(d: MediaDeviceInfo, i: number, kind: DeviceKind, tr: (s: string, ...a: unknown[]) => string): string {
  if (d.label) return d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "");
  return kind === "audioinput" ? tr("Микрофон {0}", i + 1) : kind === "videoinput" ? tr("Камера {0}", i + 1) : tr("Динамики {0}", i + 1);
}
