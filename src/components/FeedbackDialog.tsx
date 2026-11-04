// «Написать разработчику»: отзыв уходит на сайт (админка и письмо на почту), см. services/feedback.
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { MessageSquareHeart } from "lucide-react";
import { Modal, Toggle } from "./ui";
import { electron, isAndroidApp, isIOSApp, isTauri } from "../platform";
import { tr } from "../i18n";

const FEEDBACK_URL: string = (import.meta.env.VITE_FEEDBACK_URL ?? "").trim() || "https://jsmassenger.ru/api/feedback";

type Kind = "bug" | "idea" | "other";

function platformName(): string {
  const d = electron();
  if (d) return d.platform === "win32" ? "Windows" : d.platform === "darwin" ? "macOS (Electron)" : "Linux";
  if (isAndroidApp()) return "Android";
  if (isIOSApp()) return "iOS";
  if (isTauri()) return "macOS";
  return "Web";
}

export default function FeedbackDialog({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("bug");
  const [text, setText] = useState("");
  const [contact, setContact] = useState(client.getSafeUserId());
  const [details, setDetails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          text: text.trim(),
          contact: contact.trim(),
          app: details
            ? { version: __APP_VERSION__, platform: platformName(), server: client.getHomeserverUrl(), ua: navigator.userAgent }
            : { version: __APP_VERSION__ },
        }),
      });
      if (res.status === 429) throw new Error(tr("Слишком много отзывов подряд — попробуйте через несколько минут"));
      if (!res.ok) throw new Error(tr("Сервер ответил {0}", res.status));
      setSent(true);
    } catch (e) {
      setError(e instanceof TypeError ? tr("Нет связи с сайтом. Проверьте интернет и попробуйте ещё раз.") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Modal title={tr("Написать разработчику")} icon={<MessageSquareHeart size={18} />} onClose={onClose}>
        <p className="modal-text">{tr("Спасибо! Отзыв отправлен — разработчик его прочитает.")}</p>
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>
            {tr("Готово")}
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal title={tr("Написать разработчику")} icon={<MessageSquareHeart size={18} />} onClose={onClose} busy={busy}>
      <div className="field">
        <span>{tr("О чём")}</span>
        <div className="segmented">
          <button className={kind === "bug" ? "on" : ""} onClick={() => setKind("bug")}>
            {tr("Ошибка")}
          </button>
          <button className={kind === "idea" ? "on" : ""} onClick={() => setKind("idea")}>
            {tr("Предложение")}
          </button>
          <button className={kind === "other" ? "on" : ""} onClick={() => setKind("other")}>
            {tr("Другое")}
          </button>
        </div>
      </div>
      <label className="field">
        <span>{kind === "bug" ? tr("Что случилось и как это повторить") : tr("Сообщение")}</span>
        <textarea className="text-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} autoFocus />
      </label>
      <label className="field">
        <span>{tr("Как с вами связаться (необязательно)")}</span>
        <input className="text-input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={tr("Matrix ID, почта или Telegram")} />
      </label>
      <Toggle
        checked={details}
        onChange={setDetails}
        label={tr("Приложить сведения об устройстве")}
        hint={tr("Версия, система и адрес сервера — помогают найти ошибку")}
      />
      {error && <p className="form-error left">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary" onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? tr("Отправляю…") : tr("Отправить")}
        </button>
      </div>
    </Modal>
  );
}
