// Опрос в ленте и окно создания опроса.
import { useEffect, useMemo, useReducer, useState } from "react";
import { PollEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Poll, type Room } from "matrix-js-sdk";
import { BarChart3, Check, Plus, X } from "lucide-react";
import { canEndPoll, endPoll, parsePoll, sendPoll, tally, votePoll } from "../polls";
import { errText } from "../App";
import { Modal, Toggle } from "./ui";
import { ask, notice } from "./Ask";
import { plural, tr } from "../i18n";

/** Модель опроса из js-sdk: голоса подтягивает сама (в том числе из истории и зашифрованные). */
function usePoll(room: Room, ev: MatrixEvent) {
  const id = ev.getId()!;
  const [poll, setPoll] = useState<Poll | undefined>(() => room.polls.get(id));
  const [responses, setResponses] = useState<MatrixEvent[]>([]);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    // своё только что созданное (ещё не дошло до сервера) — у него временный id, голосов пока нет
    if (poll || ev.isSending() || id.startsWith("~")) return;
    const onNew = (p: Poll) => p.pollId === id && setPoll(p);
    room.on(PollEvent.New, onNew);
    void room.processPollEvents([ev]).then(() => setPoll(room.polls.get(id)));
    return () => {
      room.off(PollEvent.New, onNew);
    };
  }, [room, ev, id, poll]);

  useEffect(() => {
    if (!poll) return;
    let alive = true;
    const load = () =>
      void poll.getResponses().then((rel) => alive && setResponses([...(rel.getRelations() ?? [])]));
    load();
    poll.on(PollEvent.Responses, load);
    poll.on(PollEvent.End, bump);
    // свой голос появляется не сразу — перечитываем при новых событиях комнаты
    room.on(RoomEvent.Timeline, load);
    return () => {
      alive = false;
      poll.off(PollEvent.Responses, load);
      poll.off(PollEvent.End, bump);
      room.off(RoomEvent.Timeline, load);
    };
  }, [poll, room]);

  const endEv = poll?.endEventId ? room.findEventById(poll.endEventId) : undefined;
  return { poll, responses, ended: !!poll?.isEnded, endTs: poll?.isEnded ? (endEv?.getTs() ?? Date.now()) : null };
}

export function PollCard({ client, room, ev }: { client: MatrixClient; room: Room; ev: MatrixEvent }) {
  const info = useMemo(() => parsePoll(ev), [ev]);
  const me = client.getSafeUserId();
  const { responses, ended, endTs } = usePoll(room, ev);
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!info) return <span className="msg-text">{tr("Опрос (не удалось прочитать)")}</span>;
  const t = tally(info, responses, endTs, me);
  const mine = pending ?? t.mine;
  const voted = mine.length > 0;
  // в «скрытом» опросе итоги видны только после завершения
  const showResults = ended || (info.disclosed && voted);
  const multi = info.maxSelections > 1;
  const top = Math.max(0, ...t.counts.values());

  const vote = async (id: string) => {
    if (ended || busy) return;
    let next: string[];
    if (multi) next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id].slice(0, info.maxSelections);
    else next = mine[0] === id ? mine : [id];
    if (next.length === 0) return; // убрать последний голос формат не позволяет
    setPending(next);
    setBusy(true);
    try {
      await votePoll(client, room, ev.getId()!, next);
    } catch (e) {
      setPending(null);
      notice(tr("Голос не отправлен: {0}", errText(e)));
    } finally {
      setBusy(false);
    }
  };

  const finish = () =>
    void ask(tr("Завершить опрос? Голосовать больше будет нельзя, итоги увидят все."), { ok: tr("Завершить") }).then(async (ok) => {
      if (!ok) return;
      const best = info.answers.filter((a) => (t.counts.get(a.id) ?? 0) === top && top > 0).map((a) => a.text);
      try {
        await endPoll(client, room, ev.getId()!, best.length ? tr("Опрос завершён. Победил вариант: {0}", best.join(", ")) : tr("Опрос завершён"));
      } catch (e) {
        notice(errText(e));
      }
    });

  return (
    <div className={"poll" + (ended ? " ended" : "")}>
      <div className="poll-q">
        <BarChart3 size={16} />
        <b>{info.question}</b>
      </div>
      <div className="poll-answers" role={multi ? "group" : "radiogroup"}>
        {info.answers.map((a) => {
          const n = t.counts.get(a.id) ?? 0;
          const pct = t.voters ? Math.round((n / t.voters) * 100) : 0;
          const chosen = mine.includes(a.id);
          const win = ended && n === top && top > 0;
          return (
            <button
              key={a.id}
              className={"poll-a" + (chosen ? " chosen" : "") + (win ? " win" : "")}
              onClick={() => void vote(a.id)}
              disabled={ended}
              role={multi ? "checkbox" : "radio"}
              aria-checked={chosen}
            >
              {showResults && <span className="poll-bar" style={{ width: `${pct}%` }} />}
              <span className={"poll-mark" + (multi ? " sq" : "")}>{chosen && <Check size={12} strokeWidth={3} />}</span>
              <span className="poll-text">{a.text}</span>
              {showResults && <span className="poll-n">{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <span>
          {ended
            ? tr("Опрос завершён · {0} {1}", t.voters, plural(t.voters, "голос", "голоса", "голосов"))
            : !info.disclosed && !voted
              ? tr("Итоги — после завершения")
              : voted || showResults
                ? `${t.voters} ${plural(t.voters, "голос", "голоса", "голосов")}${multi ? ` · ${tr("можно несколько")}` : ""}`
                : multi
                  ? tr("Выберите один или несколько вариантов")
                  : tr("Выберите вариант")}
        </span>
        {!ended && canEndPoll(room, ev, me) && (
          <button className="link-btn" onClick={finish}>
            {tr("Завершить")}
          </button>
        )}
      </div>
    </div>
  );
}

export function PollDialog({ client, room, onClose }: { client: MatrixClient; room: Room; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", ""]);
  const [disclosed, setDisclosed] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = answers.map((a) => a.trim()).filter(Boolean);
  const ok = question.trim() && filled.length >= 2 && new Set(filled).size === filled.length;

  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await sendPoll(client, room, question.trim(), filled, disclosed, multiple);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={tr("Новый опрос")} icon={<BarChart3 size={18} />} onClose={onClose} busy={busy}>
      <label className="field">
        <span>{tr("Вопрос")}</span>
        <input value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder={tr("О чём спрашиваем?")} autoFocus />
      </label>
      <div className="field">
        <span>{tr("Варианты ответа")}</span>
        <div className="poll-edit">
          {answers.map((a, i) => (
            <div key={i} className="poll-edit-row">
              <input
                value={a}
                maxLength={200}
                placeholder={tr("Вариант {0}", i + 1)}
                onChange={(e) => setAnswers((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i === answers.length - 1 && a.trim() && answers.length < 20) setAnswers((l) => [...l, ""]);
                }}
              />
              {answers.length > 2 && (
                <button
                  className="icon-btn small"
                  onClick={() => setAnswers((l) => l.filter((_, j) => j !== i))}
                  aria-label={tr("Убрать вариант")}
                  title={tr("Убрать вариант")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {answers.length < 20 && (
            <button className="ghost poll-add" onClick={() => setAnswers((l) => [...l, ""])}>
              <Plus size={15} /> {tr("Добавить вариант")}
            </button>
          )}
        </div>
      </div>
      <Toggle checked={multiple} onChange={setMultiple} label={tr("Несколько ответов")} hint={tr("Можно выбрать больше одного варианта")} />
      <Toggle
        checked={!disclosed}
        onChange={(v) => setDisclosed(!v)}
        label={tr("Итоги после завершения")}
        hint={tr("Пока опрос идёт, результаты не видны никому")}
      />
      {filled.length >= 2 && new Set(filled).size !== filled.length && <p className="form-error">{tr("Варианты повторяются")}</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={() => void submit()} disabled={busy || !ok}>
          {busy ? tr("Создаю…") : tr("Создать опрос")}
        </button>
      </div>
    </Modal>
  );
}
