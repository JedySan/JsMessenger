import { useCallback, useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Check, LoaderCircle, LogOut, Monitor, Pencil, ShieldCheck, ShieldAlert, X } from "lucide-react";
import { errText } from "../App";
import { listTime } from "../format";
import { verifyOtherDevice } from "../verification";
import { tr } from "../i18n";
import { notice } from "./Ask";

interface Device {
  id: string;
  name: string;
  ip?: string;
  lastSeen?: number;
  verified: boolean;
}

/** Список сеансов аккаунта: подтверждение, переименование, выход. */
export default function SessionsDialog({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [signingOut, setSigningOut] = useState<string[] | null>(null);
  const me = client.getSafeUserId();
  const myDevice = client.getDeviceId();

  const load = useCallback(async () => {
    try {
      const res = await client.getDevices();
      const crypto = client.getCrypto();
      const list = await Promise.all(
        res.devices.map(async (d) => {
          const st = crypto ? await crypto.getDeviceVerificationStatus(me, d.device_id).catch(() => null) : null;
          return {
            id: d.device_id,
            name: d.display_name || d.device_id,
            ip: d.last_seen_ip,
            lastSeen: d.last_seen_ts,
            verified: !!st?.crossSigningVerified,
          };
        }),
      );
      // текущий сеанс первым, остальные по последней активности
      list.sort((a, b) => (a.id === myDevice ? -1 : b.id === myDevice ? 1 : (b.lastSeen ?? 0) - (a.lastSeen ?? 0)));
      setDevices(list);
    } catch (e) {
      setError(errText(e));
    }
  }, [client, me, myDevice]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !signingOut && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, signingOut]);

  const rename = async (id: string) => {
    try {
      await client.setDeviceDetails(id, { display_name: newName.trim() });
      setRenaming(null);
      load();
    } catch (e) {
      notice(errText(e));
    }
  };

  const others = devices?.filter((d) => d.id !== myDevice) ?? [];

  return (
    <div className="modal-bg" onClick={signingOut ? undefined : onClose}>
      <div className="card modal sessions" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{tr("Сеансы")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={tr("Закрыть")}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">
          {tr("Все устройства, где выполнен вход в ваш аккаунт. Подтверждённые сеансы видят историю зашифрованных чатов.")}
        </p>

        {error && <p className="form-error">{error}</p>}
        {!devices && !error && (
          <div className="verify-wait">
            <LoaderCircle size={20} className="spin" />
          </div>
        )}

        {devices && (
          <div className="session-list">
            {devices.map((d) => (
              <div key={d.id} className="session">
                <span className={"session-icon" + (d.verified ? " ok" : " warn")}>
                  <Monitor size={18} />
                </span>
                <div className="session-main">
                  {renaming === d.id ? (
                    <div className="session-rename">
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(d.id);
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        autoFocus
                      />
                      <button className="icon-btn small" onClick={() => rename(d.id)} aria-label={tr("Сохранить")}>
                        <Check size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="session-name">
                      {d.name}
                      {d.id === myDevice && <span className="session-tag">{tr("этот сеанс")}</span>}
                    </div>
                  )}
                  <div className="session-meta">
                    <span className={d.verified ? "ok" : "warn"}>
                      {d.verified ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                      {d.verified ? tr("Подтверждён") : tr("Не подтверждён")}
                    </span>
                    <span>{d.id}</span>
                    {d.ip && <span>{d.ip}</span>}
                    {d.lastSeen && d.id !== myDevice && <span>{tr("активность:")} {listTime(d.lastSeen)}</span>}
                  </div>
                </div>
                <div className="session-actions">
                  {!d.verified && d.id !== myDevice && (
                    <button
                      className="pill"
                      onClick={() => {
                        verifyOtherDevice(client, d.id).catch((e) => notice(errText(e)));
                        onClose();
                      }}
                    >
                      {tr("Подтвердить")}
                    </button>
                  )}
                  <button
                    className="icon-btn small"
                    onClick={() => {
                      setRenaming(d.id);
                      setNewName(d.name);
                    }}
                    title={tr("Переименовать")}
                    aria-label={tr("Переименовать")}
                  >
                    <Pencil size={14} />
                  </button>
                  {d.id !== myDevice && (
                    <button
                      className="icon-btn small danger-text"
                      onClick={() => setSigningOut([d.id])}
                      title={tr("Выйти из этого сеанса")}
                      aria-label={tr("Выйти из этого сеанса")}
                    >
                      <LogOut size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {others.length > 1 && (
          <div className="modal-actions">
            <button className="ghost danger-text" onClick={() => setSigningOut(others.map((d) => d.id))}>
              {tr("Выйти из всех остальных сеансов")}
            </button>
          </div>
        )}

        {signingOut && (
          <SignOutConfirm
            client={client}
            deviceIds={signingOut}
            onDone={(ok) => {
              setSigningOut(null);
              if (ok) load();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Выход из чужих сеансов требует пароль (интерактивная авторизация Matrix). */
function SignOutConfirm({
  client,
  deviceIds,
  onDone,
}: {
  client: MatrixClient;
  deviceIds: string[];
  onDone: (ok: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Первый запрос без пароля возвращает 401 с идентификатором сессии авторизации
      let session: string | undefined;
      try {
        await client.deleteMultipleDevices(deviceIds);
        onDone(true);
        return;
      } catch (e: any) {
        if (e?.httpStatus !== 401) throw e;
        session = e?.data?.session;
      }
      await client.deleteMultipleDevices(deviceIds, {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: client.getSafeUserId() },
        password,
        session,
      } as any);
      onDone(true);
    } catch (e: any) {
      setError(e?.httpStatus === 401 ? tr("Неверный пароль") : errText(e));
      setBusy(false);
    }
  };

  return (
    <div className="signout-confirm">
      <p className="modal-text">
        {deviceIds.length === 1
          ? tr("Чтобы выйти из этого сеанса, введите пароль от аккаунта.")
          : tr("Чтобы выйти из {0} сеансов, введите пароль от аккаунта.", deviceIds.length)}
      </p>
      <input
        type="password"
        className="text-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && password && submit()}
        placeholder={tr("Пароль")}
        autoFocus
      />
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={() => onDone(false)} disabled={busy}>
          {tr("Отмена")}
        </button>
        <button className="primary danger-bg" onClick={submit} disabled={busy || !password}>
          {busy ? tr("Выхожу…") : tr("Выйти")}
        </button>
      </div>
    </div>
  );
}
