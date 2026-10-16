import { useEffect, useReducer, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { MatrixRTCSessionEvent } from "matrix-js-sdk/lib/matrixrtc";
import { Phone, PhoneIncoming, Video, Presentation } from "lucide-react";
import { call } from "../call";
import { getJitsiWidgets, openExternal } from "../widgets";
import { useCallState } from "./CallPanel";

/** Кнопки звонка в шапке комнаты: MatrixRTC/LiveKit и закреплённые Jitsi-конференции. */
export default function CallButtons({ client, room }: { client: MatrixClient; room: Room }) {
  const st = useCallState();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [busy, setBusy] = useState(false);
  const session = client.matrixRTC.getRoomSession(room);

  // Перерисовка, когда кто-то входит/выходит из звонка
  useEffect(() => {
    session.on(MatrixRTCSessionEvent.MembershipsChanged, bump);
    return () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, bump);
    };
  }, [session]);

  const inThisCall = st?.roomId === room.roomId && st.status !== "error" && st.status !== "ended";
  const others = session.memberships.filter(
    (m) => !(m.sender === client.getSafeUserId() && m.deviceId === client.getDeviceId()),
  );
  const jitsi = getJitsiWidgets(room);

  const start = async (video: boolean) => {
    setBusy(true);
    try {
      await call.join(client, room, video);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="head-actions">
      {jitsi.map((w) => (
        <button key={w.id} className="pill" title={`Открыть в браузере: ${w.url}`} onClick={() => openExternal(w.url)}>
          <Presentation size={15} />
          {w.name}
        </button>
      ))}
      {!inThisCall &&
        (others.length > 0 ? (
          <button className="pill join" disabled={busy} onClick={() => start(true)}>
            <PhoneIncoming size={15} />
            Присоединиться
            <span className="pill-count">{others.length}</span>
          </button>
        ) : (
          <>
            <button className="icon-btn" disabled={busy} onClick={() => start(false)} title="Аудиозвонок" aria-label="Аудиозвонок">
              <Phone size={18} />
            </button>
            <button className="icon-btn" disabled={busy} onClick={() => start(true)} title="Видеозвонок" aria-label="Видеозвонок">
              <Video size={19} />
            </button>
          </>
        ))}
    </div>
  );
}
