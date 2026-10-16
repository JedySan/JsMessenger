import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { loadSession, logout, startClient, waitForSync, type Session } from "./matrix";
import Login from "./components/Login";
import Main from "./components/Main";
import Logo from "./components/Logo";

type State =
  | { kind: "login" }
  | { kind: "loading"; session: Session }
  | { kind: "ready"; client: MatrixClient }
  | { kind: "error"; message: string };

export default function App() {
  const [state, setState] = useState<State>(() => {
    const s = loadSession();
    return s ? { kind: "loading", session: s } : { kind: "login" };
  });

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    startClient(state.session)
      .then(async (client) => {
        await waitForSync(client);
        if (!cancelled) setState({ kind: "ready", client });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  const doLogout = async () => {
    await logout();
    setState({ kind: "login" });
  };

  switch (state.kind) {
    case "login":
      return <Login onLoggedIn={(session) => setState({ kind: "loading", session })} />;
    case "loading":
      return (
        <div className="splash">
          <div className="titlebar" data-tauri-drag-region />
          <Logo size={56} />
          <div className="splash-text">Загружаю чаты…</div>
        </div>
      );
    case "error":
      return (
        <div className="splash">
          <div className="titlebar" data-tauri-drag-region />
          <Logo size={56} />
          <h2>Нет связи с сервером</h2>
          <p className="form-error">{state.message}</p>
          <div className="modal-actions">
            <button className="ghost" onClick={doLogout}>
              Выйти из аккаунта
            </button>
            <button className="primary" onClick={() => location.reload()}>
              Повторить
            </button>
          </div>
        </div>
      );
    case "ready":
      return <Main client={state.client} onLogout={doLogout} />;
  }
}

export function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const any = e as { data?: { error?: string }; message?: string };
    if (any.data?.error) return any.data.error;
    if (any.message) return any.message;
  }
  return String(e);
}
