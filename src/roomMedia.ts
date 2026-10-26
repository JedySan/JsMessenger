// Всё, что присылали в чат: фото и видео, файлы, ссылки, аудио — как «Медиа» в Telegram.
// Историю листаем с сервера отдельно от ленты (не трогая её), зашифрованное расшифровываем у себя.
import { Direction, EventType, Filter, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export type MediaKind = "media" | "files" | "links" | "audio";

export interface MediaItem {
  id: string;
  ev: MatrixEvent;
  content: Record<string, any>;
  kind: MediaKind;
  ts: number;
  sender: string;
  /** для ссылок: найденные адреса */
  urls?: string[];
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]}'»]/gi;
const PAGE = 200;

function classify(ev: MatrixEvent): Omit<MediaItem, "id" | "ev" | "ts" | "sender"> | null {
  if (ev.isRedacted() || ev.isDecryptionFailure() || ev.isRelation("m.replace")) return null;
  if (ev.getType() !== EventType.RoomMessage) return null;
  const content = ev.getContent();
  switch (content.msgtype) {
    case MsgType.Image:
    case MsgType.Video:
      return content.url || content.file ? { content, kind: "media" } : null;
    case MsgType.File:
      return content.url || content.file ? { content, kind: "files" } : null;
    case MsgType.Audio:
      return content.url || content.file ? { content, kind: "audio" } : null;
    case MsgType.Text:
    case MsgType.Notice:
    case MsgType.Emote: {
      // ссылки ищем в тексте; цитату-«фоллбек» ответа пропускаем
      const body = String(content.body ?? "")
        .split("\n")
        .filter((l) => !l.startsWith("> "))
        .join("\n");
      const urls = [...new Set(body.match(URL_RE) ?? [])];
      return urls.length ? { content, kind: "links", urls } : null;
    }
  }
  return null;
}

export class MediaScanner {
  items: MediaItem[] = [];
  done = false;
  private from: string | null = null;
  private seen = new Set<string>();
  private busy: Promise<void> | null = null;

  constructor(
    private client: MatrixClient,
    private room: Room,
  ) {}

  count(kind: MediaKind) {
    return this.items.reduce((n, i) => n + (i.kind === kind ? 1 : 0), 0);
  }

  /** Догрузить историю, пока не найдётся ещё want штук нужного вида (или история не кончится). */
  more(kind: MediaKind, want = 30): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const target = this.count(kind) + want;
      let pages = 0;
      // не больше ~3000 событий за раз, чтобы не повесить окно в огромных чатах
      while (!this.done && this.count(kind) < target && pages < 15) {
        await this.page();
        pages++;
      }
    })().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  /** Новое (или только что расшифрованное) сообщение, пока панель открыта. */
  addLive(ev: MatrixEvent): boolean {
    const id = ev.getId();
    if (!id || this.seen.has(id) || ev.isSending()) return false;
    const c = classify(ev);
    if (!c) return false;
    this.seen.add(id);
    // по времени (новые сверху): сюда же попадают сообщения, расшифрованные позже
    const item = { id, ev, ts: ev.getTs(), sender: ev.getSender() ?? "", ...c };
    const at = this.items.findIndex((i) => i.ts < item.ts);
    this.items.splice(at < 0 ? this.items.length : at, 0, item);
    return true;
  }

  /** Сообщение удалили — убираем из списка. */
  remove(id: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    return this.items.length !== n;
  }

  private async page() {
    const encrypted = this.room.hasEncryptionStateEvent();
    const filter = new Filter(this.client.getSafeUserId());
    filter.setDefinition({
      room: { timeline: { types: encrypted ? [EventType.RoomMessage, EventType.RoomMessageEncrypted] : [EventType.RoomMessage] } },
    });
    const res = await this.client.createMessagesRequest(this.room.roomId, this.from, PAGE, Direction.Backward, filter);
    const mapper = this.client.getEventMapper();
    const evs = (res.chunk ?? []).map(mapper);
    await Promise.all(evs.filter((e) => e.isEncrypted()).map((e) => this.client.decryptEventIfNeeded(e).catch(() => {})));
    for (const ev of evs) {
      const id = ev.getId();
      if (!id || this.seen.has(id)) continue;
      this.seen.add(id);
      const c = classify(ev);
      if (c) this.items.push({ id, ev, ts: ev.getTs(), sender: ev.getSender() ?? "", ...c });
    }
    this.from = res.end ?? null;
    if (!res.end || !res.chunk?.length) this.done = true;
  }
}
