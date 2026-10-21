import { useState, type FormEvent } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { KeyRound, MonitorSmartphone } from "lucide-react";
import { verifyWithOtherDevice } from "../verification";
import { verifyWithRecoveryKey } from "../matrix";
import { errText } from "../App";
import { tr } from "../i18n";

export default function VerifyDialog({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [method, setMethod] = useState<"choose" | "key">("choose");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await verifyWithRecoveryKey(client, key, setProgress);
      setDone(tr("Сеанс подтверждён. Восстановлено ключей: {0} из {1}.", r.imported, r.total));
      setKey("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <form className="card modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">
          <KeyRound size={22} />
        </div>
        <h2>{tr("Подтвердите этот сеанс")}</h2>
        {!done && method === "choose" ? (
          <>
            <p className="modal-text">
              {tr("Подтверждённый сеанс видит историю зашифрованных чатов, а другие участники доверяют ему.")}
            </p>
            <button
              className="choice"
              onClick={() => {
                onClose();
                verifyWithOtherDevice(client).catch((e) => alert(errText(e)));
              }}
            >
              <MonitorSmartphone size={20} />
              <span>
                <b>{tr("С другого устройства")}</b>
                <span>{tr("Element на телефоне или компьютере, где вы уже вошли. Сверите эмодзи.")}</span>
              </span>
            </button>
            <button className="choice" onClick={() => setMethod("key")}>
              <KeyRound size={20} />
              <span>
                <b>{tr("Ключом восстановления")}</b>
                <span>{tr("Если другого устройства под рукой нет.")}</span>
              </span>
            </button>
          </>
        ) : done ? (
          <>
            <p>{done}</p>
            <button type="button" className="primary" onClick={onClose}>
              {tr("Готово")}
            </button>
          </>
        ) : (
          <>
            <p className="modal-text">
              {tr("Вставьте ключ восстановления, который Element показал при настройке резервной копии. Он начинается с")} <code>EsT</code> {tr("и состоит из групп по четыре символа. Ключ нигде не сохраняется.")}
            </p>
            <textarea
              rows={2}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="EsT… …"
              autoFocus
              spellCheck={false}
            />
            {progress && <p className="modal-progress">{progress}</p>}
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setMethod("choose")} disabled={busy}>
                {tr("Назад")}
              </button>
              <button type="submit" className="primary" disabled={busy || !key.trim()}>
                {busy ? tr("Подтверждаю…") : tr("Подтвердить")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
