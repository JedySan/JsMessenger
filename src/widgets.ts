// Jitsi-виджеты, закреплённые в комнатах (как их создаёт Element).
import { Direction, type Room } from "matrix-js-sdk";

export interface JitsiWidget {
  id: string;
  name: string;
  url: string;
  audioOnly: boolean;
}

const WIDGET_TYPES = ["im.vector.modular.widgets", "m.widget"];

export function getJitsiWidgets(room: Room): JitsiWidget[] {
  const state = room.getLiveTimeline().getState(Direction.Forward);
  if (!state) return [];
  const out: JitsiWidget[] = [];
  for (const type of WIDGET_TYPES) {
    for (const ev of state.getStateEvents(type)) {
      const c = ev.getContent() as Record<string, any>;
      if (c.type !== "jitsi" && c.type !== "m.jitsi") continue; // пустой контент = виджет удалён
      const data = (c.data ?? {}) as Record<string, any>;
      let url: string | null = null;
      if (data.domain && data.conferenceId) {
        url = `https://${data.domain}/${encodeURIComponent(data.conferenceId)}`;
      } else if (typeof c.url === "string") {
        // запасной вариант: шаблон Element с $conferenceId / $domain
        try {
          const u = new URL(c.url.replace("$conferenceId", data.conferenceId ?? "").replace("$domain", data.domain ?? ""));
          const conf = u.searchParams.get("confId") ?? data.conferenceId;
          const domain = u.searchParams.get("conferenceDomain") ?? data.domain;
          if (conf && domain) url = `https://${domain}/${encodeURIComponent(conf)}`;
        } catch {
          /* битый URL виджета */
        }
      }
      if (url) {
        out.push({
          id: ev.getStateKey() ?? url,
          name: c.name || data.roomName || "Jitsi",
          url,
          audioOnly: !!data.isAudioOnly,
        });
      }
    }
  }
  return out;
}

/** Открывает ссылку в системном браузере (в Tauri) или новой вкладке (в браузере). */
export async function openExternal(url: string) {
  const el = window.jsmDesktop;
  if (el) {
    await el.openExternal(url);
  } else if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
