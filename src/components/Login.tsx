import { useState, type FormEvent } from "react";
import { DEFAULT_SERVER, login, type Session } from "../matrix";
import { errText } from "../App";
import Logo from "./Logo";
import { tr } from "../i18n";

export default function Login({ onLoggedIn }: { onLoggedIn: (s: Session) => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  // Если сервер по умолчанию не задан при сборке — сразу показываем поле ввода
  const [editServer, setEditServer] = useState(!DEFAULT_SERVER);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(server, user.trim(), password));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="titlebar" data-tauri-drag-region />
      <form className="login" onSubmit={submit}>
        <Logo size={56} />
        <h1>{tr("Вход в JsMessenger")}</h1>
        <p className="login-server">
          {editServer ? (
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              aria-label={tr("Сервер")}
              placeholder={tr("Сервер Matrix, например matrix.org")}
              required
              autoFocus
            />
          ) : (
            <>
              {tr("Сервер")} {server}{" "}
              <button type="button" className="text-btn" onClick={() => setEditServer(true)}>
                {tr("Изменить")}
              </button>
            </>
          )}
        </p>
        <label className="field">
          <span>{tr("Логин")}</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={tr("ivanov или @ivanov:example.com")}
            autoFocus={!editServer}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>{tr("Пароль")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary wide" disabled={busy}>
          {busy ? tr("Вхожу…") : tr("Войти")}
        </button>
      </form>
    </div>
  );
}
