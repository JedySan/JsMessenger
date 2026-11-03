// Черновики поля ввода: по аккаунту, чату и треду. Не теряются при переключении чата или аккаунта
// и после перезапуска (как в Telegram).
const KEY = "jsm.drafts";
let drafts: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
})();
let timer = 0;

export const draftKey = (userId: string, roomId: string, threadId?: string) => `${userId}|${roomId}|${threadId ?? ""}`;

export function getDraft(key: string): string {
  return drafts[key] ?? "";
}

export function setDraft(key: string, text: string) {
  if ((drafts[key] ?? "") === text) return;
  if (text) drafts[key] = text;
  else delete drafts[key];
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(drafts));
    } catch {
      /* хранилище недоступно — черновик живёт до перезапуска */
    }
  }, 300);
}
