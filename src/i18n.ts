// Перевод интерфейса. Ключ — русская строка из кода (её и видно в исходниках),
// для других языков — словарь src/locales/<язык>.ts. Подстановки: {0}, {1}… по порядку аргументов.
//   tr("Звонок в «{0}»", room.name)
//   plural(n, "участник", "участника", "участников")  →  «участника» / «members»
import en from "./locales/en";

export type Lang = "ru" | "en";
export const LANGS: Array<{ id: Lang; name: string }> = [
  { id: "ru", name: "Русский" }, // i18n-ignore: название языка всегда на нём самом
  { id: "en", name: "English" },
];

const KEY = "jsm.lang";
const dicts: Record<Lang, Record<string, string> | null> = { ru: null, en };

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    /* хранилище недоступно — берём язык системы */
  }
  const sys = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  // русский интерфейс — для русского и близких языков, иначе английский
  return /^(ru|be|uk|kk)\b/.test(sys) ? "ru" : "en";
}

export const lang: Lang = detect();
document.documentElement.lang = lang;

/** Сменить язык: запоминаем и перезапускаем интерфейс (строки вычисляются при отрисовке). */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* не страшно */
  }
  location.reload();
}

/** Локаль для дат и чисел. */
export const locale = lang === "ru" ? "ru-RU" : "en-US";

const missing = new Set<string>();

/** Перевести строку; {0}, {1}… заменяются аргументами. */
export function tr(ru: string, ...args: unknown[]): string {
  const dict = dicts[lang];
  let s = ru;
  if (dict) {
    const v = dict[ru];
    if (v !== undefined) s = v;
    else if (import.meta.env.DEV && !missing.has(ru)) {
      missing.add(ru);
      console.warn(`[i18n] нет перевода (${lang}):`, JSON.stringify(ru));
    }
  }
  return args.length ? s.replace(/\{(\d+)\}/g, (_m, i) => String(args[+i] ?? "")) : s;
}

/**
 * Слово при числе. Русский: «1 участник, 2 участника, 5 участников».
 * Английский: в словаре ключ "участник|участника|участников" → "member|members".
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const dict = dicts[lang];
  if (dict) {
    const v = dict[`${one}|${few}|${many}`];
    if (v) {
      const [sg, pl] = v.split("|");
      return n === 1 ? sg : (pl ?? sg);
    }
  }
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
