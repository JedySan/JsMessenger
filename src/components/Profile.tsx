// Профиль: имя, аватар, пароль.
import { useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Camera, Check, Copy, KeyRound, Trash2, UserRound } from "lucide-react";
import { errText } from "../App";
import Avatar from "./Avatar";
import { Modal } from "./ui";
import { notice } from "./Ask";
import { tr } from "../i18n";

/** Квадрат по центру, 512×512 — аватары у всех клиентов круглые/квадратные. */
async function squareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("image"))), "image/jpeg", 0.9));
}

export default function ProfileDialog({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const userId = client.getSafeUserId();
  const user = client.getUser(userId);
  const [name, setName] = useState(user?.displayName ?? "");
  const [avatar, setAvatar] = useState<string | undefined>(user?.avatarUrl ?? undefined);
  const [busy, setBusy] = useState<"" | "name" | "avatar" | "password">("");
  const [savedName, setSavedName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  const run = async (what: typeof busy, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  };

  const saveName = () =>
    run("name", async () => {
      const n = name.trim();
      if (!n || n === user?.displayName) return;
      await client.setDisplayName(n);
      setSavedName(true);
      setTimeout(() => setSavedName(false), 1500);
    });

  const pickAvatar = (file: File) =>
    run("avatar", async () => {
      const blob = await squareAvatar(file);
      const up = await client.uploadContent(blob, { type: "image/jpeg", name: "avatar.jpg" });
      await client.setAvatarUrl(up.content_uri);
      setAvatar(up.content_uri);
    });

  const removeAvatar = () =>
    run("avatar", async () => {
      await client.setAvatarUrl("");
      setAvatar(undefined);
    });

  const changePassword = () =>
    run("password", async () => {
      if (newPw.length < 8) throw new Error(tr("Новый пароль — не короче 8 символов"));
      if (newPw !== newPw2) throw new Error(tr("Пароли не совпадают"));
      await client.setPassword(
        { type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password: oldPw } as never,
        newPw,
        false, // остальные устройства остаются в системе
      );
      setOldPw("");
      setNewPw("");
      setNewPw2("");
      setPwOpen(false);
      notice(tr("Пароль изменён. На других устройствах входить заново не нужно."));
    });

  const display = name.trim() || userId;
  return (
    <Modal title={tr("Профиль")} icon={<UserRound size={18} />} onClose={onClose} busy={!!busy}>
      <div className="profile-head">
        <button
          className="profile-avatar"
          onClick={() => fileInput.current?.click()}
          disabled={!!busy}
          title={tr("Сменить фото")}
          aria-label={tr("Сменить фото")}
        >
          <Avatar client={client} mxc={avatar} name={display} seed={userId} size={84} />
          <span className="profile-avatar-cam">
            <Camera size={18} />
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pickAvatar(f);
          }}
        />
        <div className="profile-id">
          <span>{userId}</span>
          <button
            className="icon-btn small"
            onClick={() => navigator.clipboard.writeText(userId).catch(() => {})}
            title={tr("Скопировать адрес")}
            aria-label={tr("Скопировать адрес")}
          >
            <Copy size={14} />
          </button>
        </div>
        {avatar && (
          <button className="link-btn small-link" onClick={removeAvatar} disabled={!!busy}>
            <Trash2 size={13} /> {tr("Убрать фото")}
          </button>
        )}
      </div>

      <label className="field">
        <span>{tr("Имя")}</span>
        <div className="profile-name">
          <input
            value={name}
            maxLength={100}
            placeholder={tr("Как вас будут видеть")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveName()}
          />
          <button
            className="primary"
            onClick={() => void saveName()}
            disabled={!!busy || !name.trim() || name.trim() === user?.displayName}
          >
            {savedName ? <Check size={16} /> : busy === "name" ? tr("Сохраняю…") : tr("Сохранить")}
          </button>
        </div>
      </label>

      {!pwOpen ? (
        <button className="ghost profile-pw-open" onClick={() => setPwOpen(true)}>
          <KeyRound size={15} /> {tr("Сменить пароль")}
        </button>
      ) : (
        <div className="profile-pw">
          <label className="field">
            <span>{tr("Текущий пароль")}</span>
            <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>{tr("Новый пароль")}</span>
            <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <label className="field">
            <span>{tr("Ещё раз")}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void changePassword()}
            />
          </label>
          <div className="modal-actions">
            <button className="ghost" onClick={() => setPwOpen(false)} disabled={!!busy}>
              {tr("Отмена")}
            </button>
            <button className="primary" onClick={() => void changePassword()} disabled={!!busy || !oldPw || !newPw}>
              {busy === "password" ? tr("Меняю…") : tr("Сменить пароль")}
            </button>
          </div>
        </div>
      )}
      {busy === "avatar" && <p className="modal-progress">{tr("Загружаю фото…")}</p>}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
