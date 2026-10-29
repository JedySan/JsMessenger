import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { BarChart3, Bold, Code, ImagePlus, Italic, Link, LoaderCircle, Mic, Paperclip, Pencil, Plus, Quote, Reply, SendHorizontal, Strikethrough, Trash2, X } from "lucide-react";
import { errText } from "../App";
import { nameForPasted, sendFile } from "../attachments";
import { MAX_VOICE_SECONDS, VoiceRecorder, formatDuration } from "../voice";
import { PollDialog } from "./Poll";
import { PopupMenu } from "./ui";
import { textToContent } from "../richtext";
import { effectiveContent, plainText } from "./Message";
import { relationFor } from "./UploadDialog";
import { isMobile } from "../platform";
import { useNarrow } from "../hooks";
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

const MAC = !window.jsmDesktop || window.jsmDesktop.platform === "darwin";
const PASTE_KEY = MAC ? "⌘V" : "Ctrl+V";
const MOD = MAC ? "⌘" : "Ctrl+";

type Fmt = "bold" | "italic" | "strike" | "code" | "quote" | "link";
const WRAP: Partial<Record<Fmt, string>> = { bold: "**", italic: "_", strike: "~~", code: "`" };

/**
 * Применить Markdown к выделению: обернуть (или снять обёртку), цитата — «> » в начале строк,
 * ссылка — [текст](https://). Возвращает новый текст и выделение.
 */
function applyFormat(text: string, a: number, b: number, f: Fmt): { text: string; a: number; b: number } {
  const sel = text.slice(a, b);
  if (f === "quote") {
    const ls = text.lastIndexOf("\n", a - 1) + 1;
    const block = text.slice(ls, b);
    const lines = block.split("\n");
    const quoted = lines.every((l) => l.startsWith("> "));
    const next = lines.map((l) => (quoted ? l.slice(2) : "> " + l)).join("\n");
    return { text: text.slice(0, ls) + next + text.slice(b), a: ls, b: ls + next.length };
  }
  if (f === "link") {
    const label = sel || tr("текст");
    const url = "https://";
    const ins = `[${label}](${url})`;
    const urlAt = a + label.length + 3;
    // «https://» выделено — вставленный из буфера адрес сразу его заменит
    return { text: text.slice(0, a) + ins + text.slice(b), a: urlAt, b: urlAt + url.length };
  }
  let m = WRAP[f]!;
  // несколько строк кода — блоком
  if (f === "code" && sel.includes("\n")) m = "```";
  const nl = m === "```" ? "\n" : "";
  // уже обёрнуто — снимаем
  if (text.slice(a - m.length - nl.length, a) === m + nl && text.slice(b, b + m.length + nl.length) === nl + m) {
    const s0 = a - m.length - nl.length;
    return { text: text.slice(0, s0) + sel + text.slice(b + m.length + nl.length), a: s0, b: s0 + sel.length };
  }
  if (sel.startsWith(m + nl) && sel.endsWith(nl + m) && sel.length >= 2 * (m.length + nl.length)) {
    const inner = sel.slice(m.length + nl.length, sel.length - m.length - nl.length);
    return { text: text.slice(0, a) + inner + text.slice(b), a, b: a + inner.length };
  }
  // пробелы по краям выделения оставляем снаружи: «**слово** », а не «**слово **»
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.trim();
  const ins = sel.slice(0, lead) + m + nl + core + nl + m + sel.slice(sel.length - trail);
  const start = a + lead + m.length + nl.length;
  return { text: text.slice(0, a) + ins + text.slice(b), a: start, b: start + core.length };
}

const TOOLS: Array<{ f: Fmt; icon: typeof Bold; label: string; key: string }> = [
  { f: "bold", icon: Bold, label: tr("Жирный"), key: "B" },
  { f: "italic", icon: Italic, label: tr("Курсив"), key: "I" },
  { f: "strike", icon: Strikethrough, label: tr("Зачёркнутый"), key: "Shift+X" },
  { f: "code", icon: Code, label: tr("Код"), key: "E" },
  { f: "quote", icon: Quote, label: tr("Цитата"), key: "Shift+." },
  { f: "link", icon: Link, label: tr("Ссылка"), key: "K" },
];

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

  const narrow = useNarrow();
  // на телефоне клавиатура при открытии чата только мешает — фокус ставим, лишь когда отвечаем или правим
  useEffect(() => {
    if (!isMobile() || mode.kind !== "normal") ref.current?.focus();
  }, [room.roomId, mode]);

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

  // ---------- голосовое: нажать микрофон → говорить → «Отправить» (или корзина / Esc) ----------
  const [voice, setVoice] = useState<{ rec: VoiceRecorder; sec: number; levels: number[]; sending?: boolean } | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(() => () => voiceRef.current?.rec.cancel(), []);
  useEffect(() => {
    voiceRef.current?.rec.cancel();
    setVoice(null);
  }, [room.roomId]);

  const startVoice = async () => {
    const rec = new VoiceRecorder();
    rec.onTick = (sec) => {
      setVoice((v) => (v && v.rec === rec ? { ...v, sec, levels: rec.levels.slice(-48) } : v));
      if (sec >= MAX_VOICE_SECONDS) void sendVoice(rec);
    };
    try {
      await rec.start();
      setVoice({ rec, sec: 0, levels: [] });
      client.sendTyping(room.roomId, true, 30000).catch(() => {});
    } catch (e) {
      rec.cancel();
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      notice(denied ? tr("Нет доступа к микрофону. Разрешите его в настройках системы") : tr("Не удалось начать запись: {0}", errText(e)));
    }
  };
  const cancelVoice = () => {
    voice?.rec.cancel();
    setVoice(null);
    stopTyping();
    client.sendTyping(room.roomId, false, 0).catch(() => {});
  };
  const sendVoice = async (rec = voice?.rec) => {
    if (!rec || voiceRef.current?.sending) return;
    setVoice((v) => (v ? { ...v, sending: true } : v));
    client.sendTyping(room.roomId, false, 0).catch(() => {});
    try {
      const r = await rec.stop();
      if (r.durationMs < 700) {
        setVoice(null); // случайное касание
        return;
      }
      const current = mode;
      const rel = relationFor(
        current.kind === "reply" ? current.ev.getId()! : undefined,
        threadId,
        threadId ? (room.getThread(threadId)?.lastReply()?.getId() ?? undefined) : undefined,
      );
      const file = new File([r.blob], "voice-message.ogg", { type: "audio/ogg" });
      await sendFile(client, room, file, undefined, rel, {
        body: tr("Голосовое сообщение"),
        info: { duration: r.durationMs },
        fields: {
          "org.matrix.msc1767.audio": { duration: r.durationMs, waveform: r.waveform },
          "org.matrix.msc3245.voice": {},
        },
      });
      if (current.kind === "reply") setMode({ kind: "normal" });
      onSent();
    } catch (e) {
      notice(tr("Голосовое не отправлено: {0}", errText(e)));
    } finally {
      setVoice(null);
    }
  };
  useEffect(() => {
    if (!voice) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelVoice();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void sendVoice();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null);
  const [pollOpen, setPollOpen] = useState(false);

  const format = (f: Fmt) => {
    const el = ref.current;
    if (!el) return;
    const r = applyFormat(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, f);
    setText(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.a, r.b);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // ⌘B / ⌘I / ⌘E / ⌘K / ⌘⇧X / ⌘⇧. — форматирование выделенного
    if (MAC ? e.metaKey : e.ctrlKey) {
      const k = e.code;
      const f: Fmt | null =
        !e.shiftKey && k === "KeyB" ? "bold"
        : !e.shiftKey && k === "KeyI" ? "italic"
        : !e.shiftKey && k === "KeyE" ? "code"
        : !e.shiftKey && k === "KeyK" ? "link"
        : e.shiftKey && k === "KeyX" ? "strike"
        : e.shiftKey && k === "Period" ? "quote"
        : null;
      if (f) {
        e.preventDefault();
        format(f);
        return;
      }
    }
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
    // Enter — отправить, Shift+Enter — новая строка; на телефоне Enter — новая строка, отправка — кнопкой (как в Telegram)
    if (e.key === "Enter" && !e.shiftKey && !narrow) {
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
      {voice ? (
        <div className="composer-box voice-rec" role="group" aria-label={tr("Запись голосового")}>
          <button className="attach-btn" onClick={cancelVoice} title={tr("Отменить (Esc)")} aria-label={tr("Отменить запись")} disabled={voice.sending}>
            <Trash2 size={18} />
          </button>
          <span className="rec-dot" aria-hidden />
          <span className="rec-time">{formatDuration(voice.sec)}</span>
          <span className="rec-wave" aria-hidden>
            {Array.from({ length: 48 }, (_, i) => voice.levels[i - (48 - voice.levels.length)] ?? 0).map((l, i) => (
              <i key={i} style={{ height: `${Math.max(8, l * 100)}%` }} />
            ))}
          </span>
          <button className="send-btn" onClick={() => void sendVoice()} title={tr("Отправить (Enter)")} aria-label={tr("Отправить голосовое")} disabled={voice.sending}>
            {voice.sending ? <LoaderCircle size={18} className="spin" /> : <SendHorizontal size={18} />}
          </button>
        </div>
      ) : (
      <div className="composer-box">
        <button
          className="attach-btn"
          onClick={(e) => {
            // в треде — сразу файл; в чате — меню: файл или опрос
            if (threadId) fileInput.current?.click();
            else {
              const r = e.currentTarget.getBoundingClientRect();
              setAttachMenu({ x: r.left, y: r.top - 8 });
            }
          }}
          title={threadId ? tr("Прикрепить файл") : tr("Прикрепить")}
          aria-label={threadId ? tr("Прикрепить файл") : tr("Прикрепить")}
          disabled={mode.kind === "edit"}
        >
          {narrow ? <Plus size={22} /> : <Paperclip size={18} />}
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
        {!text.trim() && mode.kind !== "edit" ? (
          <button className="send-btn mic" onClick={() => void startVoice()} title={tr("Записать голосовое")} aria-label={tr("Записать голосовое")}>
            <Mic size={18} />
          </button>
        ) : (
          <button className="send-btn" onClick={send} disabled={!text.trim()} title={tr("Отправить (Enter)")} aria-label={tr("Отправить")}>
            <SendHorizontal size={18} />
          </button>
        )}
      </div>
      )}
      {attachMenu && (
        <AttachMenu
          at={attachMenu}
          onClose={() => setAttachMenu(null)}
          onFile={() => fileInput.current?.click()}
          onPoll={() => setPollOpen(true)}
        />
      )}
      {pollOpen && <PollDialog client={client} room={room} onClose={() => setPollOpen(false)} />}
      <div className="composer-hint">
        <div className="fmt-tools" role="toolbar" aria-label={tr("Форматирование")}>
          {TOOLS.map(({ f, icon: Icon, label, key }) => (
            <button
              key={f}
              type="button"
              className="fmt-btn"
              title={`${label} (${MOD}${key})`}
              aria-label={label}
              onMouseDown={(e) => e.preventDefault()} // не забирать фокус и выделение у поля
              onClick={() => format(f)}
            >
              <Icon size={15} strokeWidth={f === "bold" ? 2.6 : 2} />
            </button>
          ))}
        </div>
        <span className="composer-keys">
          {tr("Shift+Enter — новая строка,")} {PASTE_KEY} {tr("— вставить скриншот")}
        </span>
      </div>
    </div>
  );
}

/** Меню скрепки над полем ввода: файл или опрос. Открывается вверх от кнопки. */
function AttachMenu({ at, onClose, onFile, onPoll }: { at: { x: number; y: number }; onClose: () => void; onFile: () => void; onPoll: () => void }) {
  // PopupMenu ставит меню левым верхним углом в точку — поднимаем его над кнопкой (примерная высота)
  return (
    <PopupMenu
      x={at.x}
      y={Math.max(8, at.y - 92)}
      onClose={onClose}
      items={[
        { label: tr("Фото или файл"), icon: <ImagePlus size={15} />, onClick: onFile },
        { label: tr("Опрос"), icon: <BarChart3 size={15} />, onClick: onPoll },
      ]}
    />
  );
}
