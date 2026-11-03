// Панель «Эмодзи / Стикеры»: в поле ввода (вставить смайлик, отправить стикер) и для реакций.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { ClockArrowUp, Search, Sticker as StickerIcon, X } from "lucide-react";
import { EMOJI_GROUPS, recentEmoji, rememberEmoji, searchEmoji } from "../emoji";
import { removeMySticker, stickerPacks, type Sticker } from "../stickers";
import { thumbnailUrl } from "../media";
import { notice } from "./Ask";
import { tr } from "../i18n";

export default function EmojiPanel({
  onPick,
  onClose,
  client,
  room,
  onSticker,
  className = "",
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** для вкладки «Стикеры» */
  client?: MatrixClient;
  room?: Room;
  onSticker?: (s: Sticker) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"emoji" | "stickers">("emoji");
  const [q, setQ] = useState("");
  const [recent] = useState(recentEmoji);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // pointerdown — чтобы закрывалось и от касания на телефоне
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pick = (e: string) => {
    rememberEmoji(e);
    onPick(e);
  };
  const found = q ? searchEmoji(q) : [];
  const groups = useMemo(
    () => [...(recent.length ? [{ id: "recent", icon: "", title: tr("Недавние"), list: recent }] : []), ...EMOJI_GROUPS],
    [recent],
  );
  const jump = (id: string) => scroller.current?.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: "start" });

  return (
    <div className={"emoji-panel " + className} ref={ref} onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
      {onSticker && (
        <div className="ep-tabs" role="tablist">
          <button role="tab" className={tab === "emoji" ? "on" : ""} onClick={() => setTab("emoji")}>
            {tr("Эмодзи")}
          </button>
          <button role="tab" className={tab === "stickers" ? "on" : ""} onClick={() => setTab("stickers")}>
            {tr("Стикеры")}
          </button>
        </div>
      )}
      {tab === "emoji" ? (
        <>
          <label className="ep-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Поиск эмодзи")} />
            {q && (
              <button onClick={() => setQ("")} aria-label={tr("Очистить поиск")}>
                <X size={13} />
              </button>
            )}
          </label>
          <div className="ep-scroll" ref={scroller}>
            {q ? (
              found.length ? (
                <div className="ep-grid">
                  {found.map((e) => (
                    <button key={e} onClick={() => pick(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ep-empty">{tr("Ничего не нашлось")}</p>
              )
            ) : (
              groups.map((gr) => (
                <section key={gr.id} data-group={gr.id}>
                  <h4>{gr.title}</h4>
                  <div className="ep-grid">
                    {gr.list.map((e, i) => (
                      <button key={e + i} onClick={() => pick(e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
          {!q && (
            <div className="ep-cats">
              {groups.map((gr) => (
                <button key={gr.id} onClick={() => jump(gr.id)} title={gr.title} aria-label={gr.title}>
                  {gr.id === "recent" ? <ClockArrowUp size={16} /> : gr.icon}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <StickersTab client={client!} room={room} onSticker={onSticker!} />
      )}
    </div>
  );
}

function StickersTab({ client, room, onSticker }: { client: MatrixClient; room?: Room; onSticker: (s: Sticker) => void }) {
  const [, bump] = useState(0);
  const packs = stickerPacks(client, room);
  const total = packs.reduce((n, p) => n + p.stickers.length, 0);
  if (!total)
    return (
      <div className="ep-scroll">
        <div className="ep-empty big">
          <StickerIcon size={30} />
          <p>{tr("Стикеров пока нет.")}</p>
          <p>{tr("Нажмите правой кнопкой (на телефоне — подержите) на картинку или чужой стикер в чате и выберите «Добавить в стикеры».")}</p>
        </div>
      </div>
    );
  return (
    <div className="ep-scroll">
      {packs
        .filter((p) => p.stickers.length)
        .map((p) => (
          <section key={p.id}>
            <h4>{p.title}</h4>
            <div className="ep-stickers">
              {p.stickers.map((s) => (
                <div key={s.key} className="ep-sticker">
                  <button onClick={() => onSticker(s)} title={s.body}>
                    <StickerThumb client={client} url={s.url} alt={s.body} />
                  </button>
                  {p.mine && (
                    <button
                      className="ep-remove"
                      aria-label={tr("Убрать из моих стикеров")}
                      title={tr("Убрать из моих стикеров")}
                      onClick={() =>
                        removeMySticker(client, s.key).then(
                          () => bump((x) => x + 1),
                          (e) => notice(String(e?.message ?? e)),
                        )
                      }
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function StickerThumb({ client, url, alt }: { client: MatrixClient; url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbnailUrl(client, url, 160).then(
      (u) => alive && setSrc(u),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [client, url]);
  return src ? <img src={src} alt={alt} loading="lazy" /> : <span className="ep-loading" />;
}
