// Поиск людей: участники наших чатов (мгновенно) + каталог пользователей сервера.
// Понимает перепутанную раскладку («lfybbk» → «даниил», «вфтшшд» → «daniil»).
import { EventType, KnownMembership, type MatrixClient } from "matrix-js-sdk";

export interface Person {
  userId: string;
  name: string;
  avatar?: string;
  /** уже есть личный чат */
  dmRoomId?: string;
  /** нашёлся среди участников наших чатов (а не только в каталоге сервера) */
  known: boolean;
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
const enToRu = new Map([...EN].map((c, i) => [c, RU[i]]));
const ruToEn = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Тот же текст, набранный в другой раскладке (или null, если менять нечего). */
export function switchLayout(s: string): string | null {
  const lower = s.toLowerCase();
  const ru = /[а-яё]/.test(lower);
  const map = ru ? ruToEn : enToRu;
  let changed = false;
  const out = [...lower]
    .map((c) => {
      const m = map.get(c);
      if (m) changed = true;
      return m ?? c;
    })
    .join("");
  return changed ? out : null;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Все слова запроса — начала слов в имени или логине. 0 — не подходит, больше — лучше. */
function score(query: string, name: string, userId: string): number {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const hay = norm(`${name} ${userId.replace(/^@/, "").replace(/[:._-]/g, " ")}`).split(/[\s]+/);
  let total = 0;
  for (const w of words) {
    if (hay.some((h) => h === w)) total += 3;
    else if (hay.some((h) => h.startsWith(w))) total += 2;
    else if (hay.some((h) => h.includes(w))) total += 1;
    else return 0;
  }
  return total;
}

/** Личные чаты по собеседнику: userId → roomId. */
export function directRooms(client: MatrixClient): Map<string, string> {
  const content = (client.getAccountData(EventType.Direct as never)?.getContent() ?? {}) as Record<string, string[]>;
  const out = new Map<string, string>();
  for (const [userId, ids] of Object.entries(content)) {
    const id = ids.find((r) => client.getRoom(r)?.getMyMembership() === KnownMembership.Join);
    if (id) out.set(userId, id);
  }
  return out;
}

/** Участники наших чатов — без запроса к серверу. */
function knownPeople(client: MatrixClient): Map<string, { name: string; avatar?: string }> {
  const me = client.getSafeUserId();
  const out = new Map<string, { name: string; avatar?: string }>();
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== KnownMembership.Join) continue;
    for (const m of room.getJoinedMembers()) {
      if (m.userId === me || out.has(m.userId)) continue;
      out.set(m.userId, { name: m.name, avatar: m.getMxcAvatarUrl() ?? undefined });
    }
  }
  return out;
}

/** Быстрый локальный поиск — для мгновенного ответа, пока ждём сервер. */
export function searchKnown(client: MatrixClient, term: string, limit = 8): Person[] {
  const t = term.trim();
  if (!t) return [];
  const alt = switchLayout(t);
  const dms = directRooms(client);
  const scored: Array<[number, Person]> = [];
  for (const [userId, p] of knownPeople(client)) {
    const s = Math.max(score(t, p.name, userId), alt ? score(alt, p.name, userId) : 0);
    if (s > 0) scored.push([s + (dms.has(userId) ? 0.5 : 0), { userId, name: p.name, avatar: p.avatar, dmRoomId: dms.get(userId), known: true }]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, "ru"))
    .slice(0, limit)
    .map(([, p]) => p);
}

/** Полный поиск: свои + каталог сервера (по запросу и по запросу в другой раскладке). */
export async function searchPeople(client: MatrixClient, term: string, limit = 20): Promise<Person[]> {
  const t = term.trim();
  if (!t) return [];
  const me = client.getSafeUserId();
  const dms = directRooms(client);
  const found = new Map<string, Person>();
  for (const p of searchKnown(client, t, limit)) found.set(p.userId, p);

  const queries = [t, switchLayout(t)].filter((q): q is string => !!q);
  const answers = await Promise.all(
    queries.map((q) => client.searchUserDirectory({ term: q, limit }).catch(() => ({ results: [] as any[] }))),
  );
  for (const res of answers) {
    for (const r of res.results) {
      if (r.user_id === me || found.has(r.user_id)) continue;
      found.set(r.user_id, {
        userId: r.user_id,
        name: r.display_name || r.user_id,
        avatar: r.avatar_url,
        dmRoomId: dms.get(r.user_id),
        known: false,
      });
    }
  }
  // полный адрес @user:server, которого нет в каталоге (например, с другого сервера)
  if (/^@[^:\s]+:\S+$/.test(t) && !found.has(t) && t !== me) found.set(t, { userId: t, name: t, known: false });

  const list = [...found.values()];
  const rank = (p: Person) =>
    Math.max(score(t, p.name, p.userId), queries[1] ? score(queries[1], p.name, p.userId) : 0) +
    (p.dmRoomId ? 1 : 0) +
    (p.known ? 0.5 : 0);
  return list.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name, "ru")).slice(0, limit);
}

/** Строка поиска чатов тоже понимает другую раскладку. */
export function matchesText(text: string, term: string): boolean {
  const t = norm(term.trim());
  if (!t) return true;
  const h = norm(text);
  if (h.includes(t)) return true;
  const alt = switchLayout(t);
  return !!alt && h.includes(norm(alt));
}
