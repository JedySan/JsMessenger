import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Paperclip, Pencil, Reply, SendHorizontal, X } from "lucide-react";
import { errText } from "../App";
import { nameForPasted } from "../attachments";
import { textToContent } from "../richtext";
import { effectiveContent, plainText } from "./Message";
import { relationFor } from "./UploadDialog";
import { tr } from "../i18n";
import { notice } from "./Ask";
import Avatar from "./Avatar";
import { searchMembers, searchPeople, type Person } from "../people";

/** Текст после «@» до курсора: начало «@» и запрос. */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const m = value.slice(0, caret).match(/(^|[\s(«"])@([^\s@]{0,40})$/);
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/** Упоминания из уже отправленного HTML (для правки сообщения): имя → userId. */
function mentionsFromHtml(html: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!html) return out;
  for (const m of html.matchAll(/<a href="https:\/\/matrix\.to\/#\/(@[^"/?]+)"[^>]*>([^<]+)<\/a>/g)) {
    out.set(m[2], decodeURIComponent(m[1]));
  }
  return out;
}

/** Имена упомянутых → ссылки matrix.to в Markdown; плюс список упомянутых для m.mentions. */
function withMentions(text: string, picked: Map<string, string>): { md: string; userIds: string[] } {
  const names = [...picked.keys()].filter((n) => text.includes(n)).sort((a, b) => b.length - a.length);
  if (!names.length) return { md: text, userIds: [] };
  const esc = (n: string) => n.replace(/[\\[\]*_`]/g, (c) => "\\" + c);
  const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const used = new Set<string>();
  const md = text.replace(re, (n) => {
    const id = picked.get(n)!;
    used.add(id);
    return `[${esc(n)}](https://matrix.to/#/${id})`;
  });
  return { md, userIds: [...used] };
}

const PASTE_KEY = window.jsmDesktop && window.jsmDesktop.platform !== "darwin" ? "Ctrl+V" : "⌘V";

export type ComposerMode = { kind: "normal" } | { kind: "reply"; ev: MatrixEvent } | { kind: "edit"; ev: MatrixEvent };

export default function Composer({
  client,
  room,
  mode,
  setMode,
  onFiles,
  onSent,
  onEditLast,
  threadId,
  placeholder,
}: {
  client: MatrixClient;
  room: Room;
  mode: ComposerMode;
  setMode: (m: ComposerMode) => void;
  onFiles: (files: File[]) => void;
  onSent: () => void;
  onEditLast: () => void;
  /** Если задан — сообщения уходят в этот тред */
  threadId?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const draftBeforeEdit = useRef("");
  // упоминания: какие имена в тексте — это выбранные из списка люди
  const picked = useRef(new Map<string, string>());
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [options, setOptions] = useState<Person[]>([]);
  const [sel, setSel] = useState(0);
  const dismissedAt = useRef(-1);
  const me = client.getSafeUserId();

  // подсказки: сразу участники комнаты, следом — каталог сервера
  useEffect(() => {
    if (!mention) {
      setOptions([]);
      return;
    }
    const local = searchMembers(room, me, mention.query);
    setOptions(local);
    setSel(0);
    if (mention.query.length < 2 || local.length >= 8) return;
    let alive = true;
    const t = setTimeout(() => {
      searchPeople(client, mention.query, 8)
        .then((found) => {
          if (!alive) return;
          const seen = new Set(local.map((p) => p.userId));
          setOptions([...local, ...found.filter((p) => !seen.has(p.userId) && p.userId !== me)].slice(0, 8));
        })
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mention?.start, mention?.query, room, client, me]);

  const updateMention = (value: string, caret: number) => {
    const m = mentionAt(value, caret);
    setMention(m && m.start !== dismissedAt.current ? m : null);
  };

  const pick = (p: Person) => {
    const el = ref.current;
    if (!mention || !el) return;
    // имя без «@», как в Element; одинаковые имена различаем логином
    let name = p.name || p.userId;
    const clash = picked.current.get(name);
    if (clash && clash !== p.userId) name = `${name} (${p.userId})`;
    picked.current.set(name, p.userId);
    const caret = el.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + name + " " + text.slice(caret);
    const pos = mention.start + name.length + 1;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => ref.current?.focus(), [room.roomId, mode]);

  // При входе в режим правки подставляем текст сообщения
  useEffect(() => {
    if (mode.kind === "edit") {
      draftBeforeEdit.current = text;
      const c = effectiveContent(mode.ev);
      picked.current = mentionsFromHtml(c.formatted_body as string | undefined);
      setText(String(c.body ?? ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stopTyping = () => {
    if (typingSent.current) {
      typingSent.current = 0;
      client.sendTyping(room.roomId, false, 0).catch(() => {});
    }
  };
  useEffect(() => stopTyping, [room.roomId]);

  const onChange = (v: string, caret: number) => {
    setText(v);
    updateMention(v, caret);
    // «печатает…» — не чаще раза в 4 секунды
    const now = Date.now();
    if (v && now - typingSent.current > 4000) {
      typingSent.current = now;
      client.sendTyping(room.roomId, true, 6000).catch(() => {});
    } else if (!v) stopTyping();
  };

  const cancelMode = () => {
    if (mode.kind === "edit") setText(draftBeforeEdit.current);
    setMode({ kind: "normal" });
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const current = mode;
    setText(current.kind === "edit" ? draftBeforeEdit.current : "");
    setMode({ kind: "normal" });
    setMention(null);
    stopTyping();
    onSent();
    const { md, userIds } = withMentions(body, picked.current);
    picked.current = new Map();
    try {
      // в body — обычный текст с именами, в formatted_body — ссылки-«плашки» на людей
      const formatted = { ...textToContent(md), body };
      const mentions = { "m.mentions": { user_ids: userIds } };
      if (current.kind === "edit") {
        const old = effectiveContent(current.ev);
        if (old.body === body) return;
        const msgtype = old.msgtype ?? MsgType.Text;
        await client.sendMessage(room.roomId, {
          msgtype,
          body: `* ${body}`,
          ...(formatted.formatted_body
            ? { format: formatted.format, formatted_body: `* ${formatted.formatted_body}` }
            : {}),
          "m.new_content": { msgtype, ...formatted, ...mentions },
          ...mentions,
          "m.relates_to": { rel_type: "m.replace", event_id: current.ev.getId()! },
        } as any);
      } else {
        const content: Record<string, any> = { msgtype: MsgType.Text, ...formatted, ...mentions };
        const rel = relationFor(
          current.kind === "reply" ? current.ev.getId()! : undefined,
          threadId,
          threadId ? (room.getThread(threadId)?.lastReply()?.getId() ?? undefined) : undefined,
        );
        if (rel) content["m.relates_to"] = rel;
        await client.sendMessage(room.roomId, content as any);
      }
    } catch (e) {
      notice(tr("Сообщение не отправлено: ") + errText(e));
      setText(body);
      setMode(current);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // список упоминаний: стрелки, Enter/Tab — выбрать, Esc — закрыть
    if (mention && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSel((i) => (i + d + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[Math.min(sel, options.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedAt.current = mention.start;
        setMention(null);
        return;
      }
    }
    // Enter — отправить, Shift+Enter — новая строка
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && mode.kind !== "normal") {
      e.preventDefault();
      cancelMode();
    } else if (e.key === "ArrowUp" && !text && mode.kind === "normal") {
      // Стрелка вверх в пустом поле — править своё последнее сообщение, как в Element
      e.preventDefault();
      onEditLast();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      onFiles(files.map(nameForPasted));
    }
  };

  const target = mode.kind !== "normal" ? mode.ev : null;
  const targetName = target ? (room.getMember(target.getSender() ?? "")?.name ?? target.getSender()) : "";

  return (
    <div className="composer">
      {mention && options.length > 0 && (
        <div className="mention-pop" role="listbox" aria-label={tr("Упомянуть")}>
          {options.map((p, i) => (
            <button
              key={p.userId}
              type="button"
              role="option"
              aria-selected={i === sel}
              className={"mention-opt" + (i === sel ? " on" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(p)}
            >
              <Avatar client={client} mxc={p.avatar} name={p.name} seed={p.userId} size={26} />
              <span className="mention-name">{p.name}</span>
              <span className="mention-id">{p.userId}</span>
            </button>
          ))}
        </div>
      )}
      {target && (
        <div className="composer-context">
          {mode.kind === "reply" ? <Reply size={15} /> : <Pencil size={14} />}
          <div className="ctx-text">
            <div className="ctx-title">{mode.kind === "reply" ? tr("В ответ: {0}", targetName) : tr("Редактирование сообщения")}</div>
            <div className="ctx-body">{plainText(target)}</div>
          </div>
          <button className="icon-btn small" onClick={cancelMode} title={tr("Отменить (Esc)")} aria-label={tr("Отменить")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="composer-box">
        <button
          className="attach-btn"
          onClick={() => fileInput.current?.click()}
          title={tr("Прикрепить файл")}
          aria-label={tr("Прикрепить файл")}
          disabled={mode.kind === "edit"}
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={mode.kind === "edit" ? tr("Новый текст сообщения") : (placeholder ?? tr("Сообщение для «{0}»", room.name))}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={() => {
            stopTyping();
            setMention(null);
          }}
        />
        <button className="send-btn" onClick={send} disabled={!text.trim()} title={tr("Отправить (Enter)")} aria-label={tr("Отправить")}>
          <SendHorizontal size={18} />
        </button>
      </div>
      <div className="composer-hint">
        {tr("**жирный**, _курсив_, `код`, Shift+Enter — новая строка,")} {PASTE_KEY} {tr("— вставить скриншот")}
      </div>
    </div>
  );
}
