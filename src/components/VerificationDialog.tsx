import { useEffect, useReducer, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type Verifier,
} from "matrix-js-sdk/lib/crypto-api";
import { CircleCheck, CircleX, LoaderCircle, MonitorSmartphone } from "lucide-react";
import { restoreAfterVerification, sasNameRu, verification } from "../verification";

/** Окно подтверждения сеанса: сверка эмодзи между двумя устройствами. */
export default function VerificationDialog({ client, onVerified }: { client: MatrixClient; onVerified: () => void }) {
  const req = useSyncExternalStore(
    (f) => verification.subscribe(f),
    () => verification.request,
  );
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    verification.attach(client);
  }, [client]);

  // Следим за состоянием запроса
  useEffect(() => {
    if (!req) return;
    setSas(null);
    if (req.isSelfVerification) {
      client
        .getDevices()
        .then((r) => setNames(Object.fromEntries(r.devices.map((d) => [d.device_id, d.display_name || d.device_id]))))
        .catch(() => {});
    }
    req.on(VerificationRequestEvent.Change, bump);
    return () => {
      req.off(VerificationRequestEvent.Change, bump);
    };
  }, [req]);

  // Как только появился «верификатор» (кто-то начал сверку) — запускаем его и ждём эмодзи
  const verifier: Verifier | undefined = req?.verifier;
  useEffect(() => {
    if (!verifier) return;
    const onSas = (cb: ShowSasCallbacks) => setSas(cb);
    verifier.on(VerifierEvent.ShowSas, onSas);
    const existing = verifier.getShowSasCallbacks();
    if (existing) setSas(existing);
    verifier.verify().catch(() => {
      /* отмену покажет фаза Cancelled */
    });
    return () => {
      verifier.off(VerifierEvent.ShowSas, onSas);
    };
  }, [verifier]);

  // После успешного подтверждения своего сеанса — подтягиваем историю
  const phase = req?.phase;
  useEffect(() => {
    if (phase === VerificationPhase.Done && req?.isSelfVerification) {
      onVerified();
      setRestoring(true);
      restoreAfterVerification(client).finally(() => setRestoring(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!req) return null;

  const otherDevice = req.otherDeviceId;
  const deviceLabel = otherDevice ? (names[otherDevice] ?? otherDevice) : "другом устройстве";
  const who = req.isSelfVerification ? deviceLabel : (client.getUser(req.otherUserId)?.displayName ?? req.otherUserId);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error("verification", e);
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  let actions: ReactNode;

  if (phase === VerificationPhase.Requested && !req.initiatedByMe) {
    body = (
      <p className="modal-text">
        {req.isSelfVerification
          ? `Сеанс «${deviceLabel}» просит подтверждения. Примите запрос, если это ваше устройство.`
          : `${who} хочет подтвердить вас.`}
      </p>
    );
    actions = (
      <>
        <button className="ghost" onClick={() => verification.close()} disabled={busy}>
          Отклонить
        </button>
        <button className="primary" onClick={() => run(() => req.accept())} disabled={busy}>
          Принять
        </button>
      </>
    );
  } else if (phase === VerificationPhase.Requested || phase === VerificationPhase.Unsent) {
    body = (
      <div className="verify-wait">
        <LoaderCircle size={22} className="spin" />
        <p className="modal-text">
          Откройте Element или JsMessenger на другом своём устройстве — там появится запрос. Примите его.
        </p>
      </div>
    );
    actions = (
      <button className="ghost" onClick={() => verification.close()}>
        Отмена
      </button>
    );
  } else if (phase === VerificationPhase.Ready) {
    body = (
      <p className="modal-text">
        Запрос принят. Сравните эмодзи на обоих устройствах: если совпадут, сеанс будет подтверждён.
      </p>
    );
    actions = (
      <>
        <button className="ghost" onClick={() => verification.close()}>
          Отмена
        </button>
        <button className="primary" disabled={busy} onClick={() => run(() => req.startVerification("m.sas.v1"))}>
          Сравнить эмодзи
        </button>
      </>
    );
  } else if (phase === VerificationPhase.Started) {
    const emoji = sas?.sas.emoji;
    body = emoji ? (
      <>
        <p className="modal-text">Убедитесь, что на другом устройстве те же эмодзи в том же порядке.</p>
        <div className="sas-grid">
          {emoji.map(([e, name], i) => (
            <div key={i} className="sas-item">
              <span className="sas-emoji">{e}</span>
              <span className="sas-name">{sasNameRu(name)}</span>
            </div>
          ))}
        </div>
      </>
    ) : (
      <div className="verify-wait">
        <LoaderCircle size={22} className="spin" />
        <p className="modal-text">Готовлю эмодзи для сверки…</p>
      </div>
    );
    actions = emoji ? (
      <>
        <button
          className="ghost danger-text"
          disabled={busy}
          onClick={() => {
            sas?.mismatch();
          }}
        >
          Не совпадают
        </button>
        <button className="primary" disabled={busy} onClick={() => run(() => sas!.confirm())}>
          Совпадают
        </button>
      </>
    ) : (
      <button className="ghost" onClick={() => verification.close()}>
        Отмена
      </button>
    );
  } else if (phase === VerificationPhase.Done) {
    body = (
      <div className="verify-result ok">
        <CircleCheck size={40} />
        <p className="modal-text">
          {req.isSelfVerification ? "Сеанс подтверждён." : `${who} подтверждён.`}
          {restoring ? " Подтягиваю ключи старых сообщений…" : ""}
        </p>
      </div>
    );
    actions = (
      <button className="primary" onClick={() => verification.close()}>
        Готово
      </button>
    );
  } else {
    body = (
      <div className="verify-result fail">
        <CircleX size={40} />
        <p className="modal-text">{cancelText(req.cancellationCode)}</p>
      </div>
    );
    actions = (
      <button className="primary" onClick={() => verification.close()}>
        Закрыть
      </button>
    );
  }

  return (
    <div className="modal-bg">
      <div className="card modal">
        <div className="modal-icon">
          <MonitorSmartphone size={22} />
        </div>
        <h2>{req.isSelfVerification ? "Подтверждение сеанса" : "Подтверждение пользователя"}</h2>
        {body}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

function cancelText(code: string | null): string {
  switch (code) {
    case "m.mismatched_sas":
      return "Эмодзи не совпали, подтверждение отменено. Если это не вы входили в аккаунт — смените пароль.";
    case "m.timeout":
      return "Время ожидания истекло. Попробуйте ещё раз.";
    case "m.user":
      return "Подтверждение отменено.";
    case "m.accepted":
      return "Запрос принят на другом устройстве.";
    default:
      return "Подтверждение прервано. Попробуйте ещё раз.";
  }
}
