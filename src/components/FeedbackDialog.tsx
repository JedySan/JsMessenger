// «Написать разработчику»: отзыв уходит на сайт (админка и письмо на почту), см. services/feedback.
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { ImagePlus, MessageSquareHeart, X } from "lucide-react";
import { Modal, Toggle } from "./ui";
import { electron, isAndroidApp, isIOSApp, isTauri } from "../platform";
import { tr } from "../i18n";

const FEEDBACK_URL: string = (import.meta.env.VITE_FEEDBACK_URL ?? "").trim() || "https://jsmassenger.ru/api/feedback";

type Kind = "bug" | "idea" | "other";

/** картинка к отзыву: уже уменьшенная и в base64 */
interface Shot {
  id: number;
  name: string;
  type: string;
  data: string;
  url: string;
}
const MAX_SHOTS = 5;
const MAX_SIDE = 2560;
const KEEP_BYTES = 1.5 * 1024 * 1024;
let shotSeq = 0;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Большие картинки уменьшаем (до 2560 px по длинной стороне) и пережимаем в JPEG — отзыв уходит быстро даже с телефона. */
async function prepareShot(file: File): Promise<Shot> {
  let blob: Blob = file;
  let type = file.type;
  let name = file.name || "screenshot.png";
  if (type !== "image/gif") {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale < 1 || file.size > KEEP_BYTES || !/^image\/(png|jpeg|webp)$/.test(type)) {
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      const png = type === "image/png" && file.size <= KEEP_BYTES;
      type = png ? "image/png" : "image/jpeg";
      blob = (await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.88))) ?? file;
      if (!png) name = name.replace(/\.[^.]+$/, "") + ".jpg";
    }
    bmp.close();
  }
  if (blob.size > 4 * 1024 * 1024) throw new Error(tr("Картинка «{0}» слишком большая (больше 4 МБ)", name));
  return { id: ++shotSeq, name, type, data: await toBase64(blob), url: URL.createObjectURL(blob) };
}

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
  const [shots, setShots] = useState<Shot[]>([]);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // картинки: кнопкой, вставкой из буфера (скриншот — Cmd/Ctrl+V) или перетаскиванием
  const addFiles = async (list: File[]) => {
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setError(null);
    const room = MAX_SHOTS - shots.length;
    if (imgs.length > room) setError(tr("Можно приложить не больше {0} картинок", MAX_SHOTS));
    for (const f of imgs.slice(0, Math.max(0, room))) {
      try {
        const sh = await prepareShot(f);
        setShots((s) => (s.length < MAX_SHOTS ? [...s, sh] : s));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void addFiles([...e.dataTransfer.files]);
  };
  const removeShot = (id: number) =>
    setShots((s) => {
      const x = s.find((i) => i.id === id);
      if (x) URL.revokeObjectURL(x.url);
      return s.filter((i) => i.id !== id);
    });

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
          attachments: shots.map((x) => ({ name: x.name, type: x.type, data: x.data })),
        }),
      });
      if (res.status === 413) throw new Error(tr("Картинки слишком большие — уберите одну-две и отправьте ещё раз"));
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
        <textarea className="text-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} maxLength={5000} autoFocus />
      </label>
      <div
        className={"fb-shots" + (drag ? " drag" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {shots.map((x) => (
          <span key={x.id} className="fb-shot">
            <img src={x.url} alt={x.name} />
            <button onClick={() => removeShot(x.id)} aria-label={tr("Убрать")} title={tr("Убрать")}>
              <X size={13} />
            </button>
          </span>
        ))}
        {shots.length < MAX_SHOTS && (
          <button className="fb-add" onClick={() => fileInput.current?.click()} disabled={busy}>
            <ImagePlus size={18} />
            <span>{shots.length ? tr("Ещё") : tr("Картинка или скриншот")}</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files);
          }}
        />
      </div>
      {shots.length === 0 && <p className="fb-hint">{tr("Можно вставить скриншот из буфера (Ctrl+V) или перетащить картинку сюда")}</p>}
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
