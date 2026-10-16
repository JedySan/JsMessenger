import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { avatarHue, initials } from "../format";
import { thumbnailUrl } from "../media";

/** Круглый аватар: картинка из Matrix или цветные инициалы. */
export default function Avatar({
  client,
  mxc,
  name,
  seed,
  size = 36,
}: {
  client: MatrixClient;
  mxc?: string | null;
  name: string;
  seed: string;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    if (!mxc) return;
    let alive = true;
    // берём миниатюру в 2× для Retina
    thumbnailUrl(client, mxc, size * 2).then((u) => alive && setSrc(u), () => {});
    return () => {
      alive = false;
    };
  }, [client, mxc, size]);

  const hue = avatarHue(seed);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ["--hue" as string]: hue,
      }}
      aria-hidden
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export function RoomAvatar({ client, room, size = 36 }: { client: MatrixClient; room: import("matrix-js-sdk").Room; size?: number }) {
  // У личных чатов без своей картинки берём аватар собеседника
  const mxc = room.getMxcAvatarUrl() ?? room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? null;
  return <Avatar client={client} mxc={mxc} name={room.name} seed={room.roomId} size={size} />;
}
