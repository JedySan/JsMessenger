// «JsMessenger Plus»: что входит, до какого числа действует, ввод кода активации.
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { BadgeCheck, Gem, KeyRound, RefreshCw } from "lucide-react";
import { Modal } from "./ui";
import { PlusError, redeemCode, refreshPlus, usePlus } from "../plus";
import { tr } from "../i18n";

const dateRu = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

function errorText(e: unknown): string {
  const code = e instanceof PlusError ? e.code : "";
  if (code === "code") return tr("Такого кода нет. Проверьте, что ввели его правильно.");
  if (code === "used") return tr("Этот код уже использован.");
  if (code === "too many") return tr("Слишком много попыток — подождите несколько минут.");
  if (code === "network") return tr("Нет связи с сервером JsMessenger. Проверьте интернет.");
  if (code === "openid") return tr("Не удалось подтвердить ваш аккаунт у Matrix-сервера.");
  return e instanceof Error ? e.message : String(e);
}

export default function PlusDialog({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const st = usePlus(client);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const active = !!st?.plus && st.plus.until > Date.now();

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      await redeemCode(client, code);
      setCode("");
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshPlus(client);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="JsMessenger Plus" icon={<Gem size={18} />} onClose={onClose} busy={busy}>
      <div className={"plus-status" + (active ? " on" : "")}>
        {active ? <BadgeCheck size={22} /> : <Gem size={22} />}
        <div>
          <b>{active ? tr("Plus подключён") : tr("Plus не подключён")}</b>
          <span>{active ? tr("Действует до {0}", dateRu(st!.plus!.until)) : tr("Дополнительные возможности за небольшую плату")}</span>
        </div>
        <button className="icon-btn small" onClick={() => void refresh()} title={tr("Обновить")} aria-label={tr("Обновить")} disabled={busy}>
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="plus-features">
        {(st?.features ?? []).map((f) => (
          <div key={f.id} className="plus-feature">
            <BadgeCheck size={16} />
            <span>{f.title}</span>
            {f.soon && <em>{tr("скоро")}</em>}
          </div>
        ))}
        {!st && <p className="modal-text small-note">{tr("Загружаю…")}</p>}
      </div>

      <label className="field">
        <span>{active ? tr("Продлить кодом") : tr("Код активации")}</span>
        <div className="row-input">
          <input
            className="text-input mono"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setDone(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && void redeem()}
            placeholder="JSM-XXXX-XXXX-XXXX"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <button className="primary" onClick={() => void redeem()} disabled={busy || !code.trim()}>
            <KeyRound size={15} /> {tr("Активировать")}
          </button>
        </div>
      </label>
      {done && <p className="plus-ok">{tr("Готово! Plus действует до {0}", st?.plus ? dateRu(st.plus.until) : "—")}</p>}
      {error && <p className="form-error left">{error}</p>}
      <p className="modal-text small-note">
        {tr("Plus привязан к аккаунту {0} и работает на всех ваших устройствах. Код можно получить у разработчика.", client.getSafeUserId())}
      </p>
    </Modal>
  );
}
