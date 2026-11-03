import { tr } from "./i18n";

// Набор эмодзи для панели: категории как в Telegram, недавние и поиск по словам (рус./англ.).

export interface EmojiGroup {
  id: string;
  /** значок вкладки */
  icon: string;
  title: string;
  list: string[];
}

const g = (s: string) => s.trim().split(/\s+/);

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: "smileys",
    icon: "😀",
    title: tr("Смайлики"),
    list: g(`😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡
      🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐
      😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡
      👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊`),
  },
  {
    id: "people",
    icon: "👍",
    title: tr("Жесты и люди"),
    list: g(`👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👏 🙌 🫶 👐 🤲 🤝 🙏
      ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁
      🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺
      👯 🧖 🧗 🏇 ⛷️ 🏂 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 👭 👫 👬 💏 💑 👪 🗣️ 👤 👥 🫂`),
  },
  {
    id: "hearts",
    icon: "❤️",
    title: tr("Сердца и символы"),
    list: g(`❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🕳️ 💬 👁️‍🗨️ 🗨️
      🗯️ 💭 💤 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ❓ ❔ ❕ ❗ ‼️ ⁉️ ⚠️ 🚫 ⛔ 📛 🔞 ♻️ ⭕ 🛑 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧
      🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲 🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 ☮️ ✝️ ☪️ 🕉️ ☯️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑
      ♒ ♓ 🆗 🆕 🆙 🆒 🆓 🆘 🔝 🔜 🔛 🔚 🔙 ℹ️ 🔤 🔢 #️⃣ *️⃣ 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 ▶️ ⏸️ ⏹️ ⏺️ ⏭️
      ⏮️ ⏩ ⏪ 🔀 🔁 🔂 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 ©️ ®️ ™️ 〰️ ➰ ➿`),
  },
  {
    id: "nature",
    icon: "🐱",
    title: tr("Животные и природа"),
    list: g(`🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜
      🪰 🪲 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🦭 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘
      🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐈‍⬛ 🪶 🐓 🦃 🦤 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔
      🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 🌎 🪐
      ⭐ 🌟 ✨ ⚡ ☄️ 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💧 🌊 🌫️`),
  },
  {
    id: "food",
    icon: "🍕",
    title: tr("Еда и напитки"),
    list: g(`🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞
      🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙
      🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷
      🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥣 🥡 🥢 🧂`),
  },
  {
    id: "activity",
    icon: "⚽",
    title: tr("Занятия"),
    list: g(`⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 🏆
      🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎈
      🎁 🎀 🪅 🪩 🎃 🎆 🎇 🧨`),
  },
  {
    id: "travel",
    icon: "🚗",
    title: tr("Транспорт и места"),
    list: g(`🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🏍️ 🛵 🚲 🛴 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂
      🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🪝 ⛽ 🚧 🚦 🚥 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢
      🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋
      ⛩️ 🛤️ 🛣️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁`),
  },
  {
    id: "objects",
    icon: "💡",
    title: tr("Предметы"),
    list: g(`⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰
      🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱
      ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺
      🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮
      🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️
      📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎
      🔏 🔐 🔒 🔓`),
  },
];

/** Поиск: слова к самым частым эмодзи. */
const KEYWORDS: Record<string, string> = {
  "😀": "улыбка смех радость smile happy grin", "😂": "смех слезы ржу lol laugh tears", "🤣": "катаюсь ржу rofl", // i18n-ignore
  "😊": "улыбка радость smile blush", "😍": "любовь влюблён love heart eyes", "🥰": "любовь обожаю love", // i18n-ignore
  "😘": "поцелуй kiss", "😎": "круто очки cool sunglasses", "🤔": "думаю хмм think hmm", "😢": "грусть плачу sad cry", // i18n-ignore
  "😭": "рыдаю плач sob cry", "😡": "злость гнев angry rage", "😱": "ужас крик scream shock", "😴": "сплю sleep", // i18n-ignore
  "🤯": "взрыв мозга mind blown", "🥳": "праздник вечеринка party", "😅": "пот неловко sweat", "🙄": "закатил глаза eye roll", // i18n-ignore
  "😬": "неловко grimace", "😇": "ангел angel", "🤡": "клоун clown", "💩": "какашка poop", "👍": "да хорошо класс лайк ок like yes ok thumbs", // i18n-ignore
  "👎": "нет плохо дизлайк no dislike", "👌": "ок окей отлично ok okay perfect", "🙏": "спасибо пожалуйста please thanks pray", // i18n-ignore
  "👏": "аплодисменты браво clap", "💪": "сила мышцы strong", "🤝": "рукопожатие договорились deal handshake", // i18n-ignore
  "👋": "привет пока hi bye wave", "✌️": "мир победа peace victory", "🤞": "удачи luck fingers crossed", "🫡": "есть так точно salute", // i18n-ignore
  "❤️": "сердце любовь heart love red", "🔥": "огонь круто fire hot lit", "💯": "сто процентов 100 hundred", "✅": "готово да сделано done check yes", // i18n-ignore
  "❌": "нет отмена ошибка no cross cancel", "⚠️": "внимание осторожно warning", "🎉": "ура праздник поздравляю party tada", // i18n-ignore
  "👀": "смотрю глаза look eyes", "🚀": "ракета запуск rocket launch", "☕": "кофе чай coffee", "🍕": "пицца pizza", "🍺": "пиво beer", // i18n-ignore
  "🎂": "торт день рождения cake birthday", "🎁": "подарок gift", "⭐": "звезда star", "✨": "блеск sparkles", "⚡": "молния быстро lightning", // i18n-ignore
  "💡": "идея лампа idea", "📌": "закреп pin", "📎": "скрепка clip", "🐛": "баг ошибка bug", "🛠️": "инструменты ремонт tools fix", // i18n-ignore
  "⏳": "ждём время wait time", "🆗": "ок ok", "😮": "удивление wow", "🙈": "не вижу стыдно monkey", "🤷": "не знаю пожимаю плечами shrug", // i18n-ignore
  "🤦": "фейспалм facepalm", "💀": "умер череп dead skull", "🐱": "кот кошка cat", "🐶": "собака пёс dog", "🌹": "роза цветок rose flower", // i18n-ignore
  "🏆": "кубок победа trophy win", "💸": "деньги money", "💰": "деньги богатство money bag", "📞": "звонок телефон call phone", // i18n-ignore
  "💻": "ноутбук компьютер laptop", "🔒": "замок безопасно lock", "🔑": "ключ key", "🗑️": "корзина удалить trash", "📅": "календарь дата calendar", // i18n-ignore
};

export function searchEmoji(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: string[] = [];
  for (const [e, words] of Object.entries(KEYWORDS)) if (words.split(" ").some((w) => w.startsWith(s))) out.push(e);
  return out;
}

// ---------- недавние ----------
const RECENT_KEY = "jsm.recentEmoji";
export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 24) : [];
  } catch {
    return [];
  }
}
export function rememberEmoji(e: string) {
  const next = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* без хранилища — без недавних */
  }
}
