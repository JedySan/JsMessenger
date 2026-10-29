// Опросы Matrix (MSC3381) — тот же формат, что у Element и Element X.
// Отправляем «нестабильные» имена (org.matrix.msc3381.*), читаем и их, и стабильные (m.poll.*).
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { tr } from "./i18n";

export const POLL_START = ["org.matrix.msc3381.poll.start", "m.poll.start"];
export const POLL_RESPONSE = ["org.matrix.msc3381.poll.response", "m.poll.response"];
export const POLL_END = ["org.matrix.msc3381.poll.end", "m.poll.end"];
const TEXT = ["org.matrix.msc1767.text", "m.text"];
const DISCLOSED = ["org.matrix.msc3381.poll.disclosed", "m.poll.disclosed"];

export const isPollStart = (ev: MatrixEvent) => POLL_START.includes(ev.getType());
export const isPollResponse = (ev: MatrixEvent) => POLL_RESPONSE.includes(ev.getType());
export const isPollEnd = (ev: MatrixEvent) => POLL_END.includes(ev.getType());

const pick = (o: Record<string, any> | undefined, keys: string[]) => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};
/** Текст в «расширяемом» формате: строка или [{body, mimetype}] */
function textOf(o: Record<string, any> | undefined): string {
  const t = pick(o, TEXT) ?? o?.body;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return String(t.find((x) => !x.mimetype || x.mimetype === "text/plain")?.body ?? t[0]?.body ?? "");
  return "";
}

export interface PollInfo {
  question: string;
  answers: Array<{ id: string; text: string }>;
  disclosed: boolean;
  maxSelections: number;
}

export function parsePoll(ev: MatrixEvent): PollInfo | null {
  const c = pick(ev.getContent(), POLL_START);
  if (!c || !Array.isArray(c.answers)) return null;
  const answers = c.answers
    .map((a: Record<string, any>) => ({ id: String(a.id ?? ""), text: textOf(a) }))
    .filter((a: { id: string }) => a.id)
    .slice(0, 20);
  if (!answers.length) return null;
  return {
    question: textOf(c.question),
    answers,
    disclosed: !c.kind || DISCLOSED.includes(c.kind),
    maxSelections: Math.max(1, Math.min(Number(c.max_selections) || 1, answers.length)),
  };
}

/** Итоги: последний действительный голос каждого участника до завершения опроса. */
export function tally(poll: PollInfo, responses: MatrixEvent[], endTs: number | null, me: string) {
  const latest = new Map<string, MatrixEvent>();
  for (const r of responses) {
    if (r.isRedacted() || (endTs !== null && r.getTs() > endTs)) continue;
    const s = r.getSender()!;
    const prev = latest.get(s);
    if (!prev || r.getTs() >= prev.getTs()) latest.set(s, r);
  }
  const ids = new Set(poll.answers.map((a) => a.id));
  const counts = new Map(poll.answers.map((a) => [a.id, 0]));
  let voters = 0;
  let mine: string[] = [];
  for (const [sender, r] of latest) {
    const ans = pick(r.getContent(), POLL_RESPONSE)?.answers;
    // неверный голос (лишние варианты, чужие id) считается «испорченным» — как в Element
    if (!Array.isArray(ans) || !ans.length || ans.length > poll.maxSelections || ans.some((a) => !ids.has(a))) continue;
    voters++;
    for (const a of new Set<string>(ans)) counts.set(a, (counts.get(a) ?? 0) + 1);
    if (sender === me) mine = ans;
  }
  return { counts, voters, mine };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function sendPoll(client: MatrixClient, room: Room, question: string, answers: string[], disclosed: boolean, multiple: boolean) {
  const list = answers.map((text) => ({ id: randomId(), "org.matrix.msc1767.text": text }));
  const fallback = `${question}\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
  await client.sendEvent(room.roomId, POLL_START[0] as never, {
    "org.matrix.msc3381.poll.start": {
      question: { "org.matrix.msc1767.text": question, body: question, msgtype: "m.text" },
      kind: disclosed ? DISCLOSED[0] : "org.matrix.msc3381.poll.undisclosed",
      max_selections: multiple ? answers.length : 1,
      answers: list,
    },
    "org.matrix.msc1767.text": fallback,
  } as never);
}

export async function votePoll(client: MatrixClient, room: Room, pollId: string, answerIds: string[]) {
  await client.sendEvent(room.roomId, POLL_RESPONSE[0] as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: pollId },
    "org.matrix.msc3381.poll.response": { answers: answerIds },
  } as never);
}

export async function endPoll(client: MatrixClient, room: Room, pollId: string, summary: string) {
  await client.sendEvent(room.roomId, POLL_END[0] as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: pollId },
    "org.matrix.msc3381.poll.end": {},
    "org.matrix.msc1767.text": summary || tr("Опрос завершён"),
  } as never);
}

/** Может ли пользователь завершить опрос: автор или тот, кто может удалять чужие сообщения. */
export function canEndPoll(room: Room, ev: MatrixEvent, me: string): boolean {
  return ev.getSender() === me || room.currentState.maySendRedactionForEvent(ev, me);
}

export function pollPreview(ev: MatrixEvent): string {
  const p = parsePoll(ev);
  return tr("Опрос: {0}", p?.question ?? "");
}
