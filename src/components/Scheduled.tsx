// Отложенные сообщения: окно выбора времени и полоска «Запланировано» над полем ввода.
import { useEffect, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { AlertCircle, CalendarClock, ChevronDown, ChevronUp, Gem, LoaderCircle, Send, X } from "lucide-react";
import { Modal } from "./ui";
import { ask, notice } from "./Ask";
import {
  cancelScheduled,
  failedText,
  listScheduled,
  onScheduledChange,
  preferredVia,
  schedulePresets,
  scheduleError,
  scheduleRoutes,
  sendScheduledNow,
  setPreferredVia,
  type Scheduled,
  type ScheduleVia,
} from "../scheduled";
import { openPlus } from "../plus";
import { dayLabel, timeHM } from "../format";
import { tr } from "../i18n";

/** Подпись времени: «сегодня в 19:00», «завтра в 9:00», «24 ноября в 9:00». */
export function whenLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, today) ? tr("сегодня") : same(d, tomorrow) ? tr("завтра") : dayLabel(ms);
  return tr("{0} в {1}", day, timeHM(ms));
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const ACK_KEY = "jsm.schedPlusAck";
/** Один раз объясняем, что серверу JsMessenger нужен доступ к устройству. */
async function plusAcknowledged(): Promise<boolean> {
  try {
    if (localStorage.getItem(ACK_KEY)) return true;
  } catch {
    /* спросим */
  }
  const ok = await ask(
    tr(
      "Сообщение отправит сервер JsMessenger. В зашифрованном чате он получит его уже зашифрованным и прочитать не сможет. Чтобы отправить от вашего имени, сервер временно хранит доступ к этому устройству и удаляет его сразу после отправки. Если выйти из аккаунта на этом устройстве, запланированное не уйдёт.",
    ),
    { ok: tr("Понятно, запланировать") },
  );
  if (ok)
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* спросим в следующий раз */
    }
  return ok;
}

/** Выбрать, когда отправить. */
export function ScheduleDialog({ client, text, onPick, onClose }: { client: MatrixClient; text: string; onPick: (at: Date, via: ScheduleVia) => Promise<void>; onClose: () => void }) {
  const presets = schedulePresets();
  const [routes, setRoutes] = useState<ScheduleVia[] | null>(null);
  const [via, setVia] = useState<ScheduleVia>("matrix");
  useEffect(() => {
    let alive = true;
    void scheduleRoutes(client).then((r) => {
      if (!alive) return;
      setRoutes(r);
      const pref = preferredVia();
      setVia(pref && r.includes(pref) ? pref : (r[0] ?? "matrix"));
    });
    return () => {
      alive = false;
    };
  }, [client]);
  const [custom, setCustom] = useState(() => {
    const d = new Date(Date.now() + 2 * 3_600_000);
    d.setMinutes(0, 0, 0);
    return localInput(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (at: Date) => {
    if (at.getTime() < Date.now() + 30_000) return setError(tr("Выберите время в будущем"));
    if (via === "plus" && !(await plusAcknowledged())) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(at, via);
      onClose();
    } catch (e) {
      setError(scheduleError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!routes)
    return (
      <Modal title={tr("Отправить позже")} icon={<CalendarClock size={18} />} onClose={onClose}>
        <p className="modal-text sched-loading">
          <LoaderCircle size={20} className="spin" />
        </p>
      </Modal>
    );
  if (!routes.length)
    return (
      <Modal title={tr("Отправить позже")} icon={<CalendarClock size={18} />} onClose={onClose}>
        <p className="modal-text">
          {tr("Ваш Matrix-сервер не умеет отправлять отложенные сообщения. Их может отправить сервер JsMessenger — это входит в JsMessenger Plus.")}
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>{tr("Закрыть")}</button>
          <button
            className="primary"
            onClick={() => {
              onClose();
              openPlus();
            }}
          >
            <Gem size={15} /> {tr("Подробнее о Plus")}
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title={tr("Отправить позже")} icon={<CalendarClock size={18} />} onClose={onClose} busy={busy}>
      <p className="sched-preview">{text}</p>
      {routes.length > 1 && (
        <div className="segmented sched-via" role="radiogroup" aria-label={tr("Кто отправит")}>
          {routes.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={via === r}
              className={via === r ? "on" : ""}
              onClick={() => {
                setVia(r);
                setPreferredVia(r);
              }}
            >
              {r === "plus" ? <><Gem size={14} /> {tr("Сервер JsMessenger")}</> : tr("Ваш Matrix-сервер")}
            </button>
          ))}
        </div>
      )}
      <div className="sched-presets">
        {presets.map((p) => (
          <button key={p.label} className="sched-preset" onClick={() => void go(p.at)} disabled={busy}>
            <b>{p.label}</b>
            <span>{whenLabel(p.at.getTime())}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>{tr("Или выберите дату и время")}</span>
        <div className="row-input">
          <input className="text-input" type="datetime-local" value={custom} min={localInput(new Date())} onChange={(e) => setCustom(e.target.value)} />
          <button className="primary" onClick={() => void go(new Date(custom))} disabled={busy || !custom}>
            {tr("Запланировать")}
          </button>
        </div>
      </label>
      {error && <p className="form-error left">{error}</p>}
      <p className="modal-text small-note">
        {via === "plus"
          ? tr("Сообщение отправит сервер JsMessenger — даже если приложение будет закрыто.")
          : tr("Сообщение отправит сервер — даже если приложение будет закрыто.")}
      </p>
    </Modal>
  );
}

/** Полоска над полем ввода: сколько запланировано в этом чате; раскрывается в список. */
export function ScheduledBar({ client, room }: { client: MatrixClient; room: Room }) {
  const [items, setItems] = useState<Scheduled[]>([]);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => void listScheduled(client, room.roomId).then((l) => alive && setItems(l), () => {});
    load();
    const off = onScheduledChange(load);
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      off();
      window.clearInterval(t);
    };
  }, [client, room.roomId, tick]);
  // пока сообщение не ушло, а время прошло — обновим список чуть позже
  const pending = items.filter((i) => i.failed || i.at > Date.now() - 5_000 || i.via === "plus");
  useEffect(() => {
    const waiting = items.filter((i) => !i.failed);
    const next = waiting.length ? Math.min(...waiting.map((i) => i.at)) : 0;
    if (!next) return;
    const t = window.setTimeout(() => setTick((x) => x + 1), Math.max(3_000, next - Date.now() + 3_000));
    return () => window.clearTimeout(t);
  }, [items]);
  if (!pending.length) return null;
  const failed = pending.filter((i) => i.failed);
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notice(scheduleError(e));
    }
    setTick((x) => x + 1);
  };
  return (
    <div className={"sched-bar" + (open ? " open" : "") + (failed.length ? " failed" : "")}>
      <button className="sched-head" onClick={() => setOpen((v) => !v)}>
        {failed.length ? <AlertCircle size={15} /> : <CalendarClock size={15} />}
        <span>
          {failed.length
            ? tr("Не отправлено сообщений: {0}", failed.length)
            : pending.length === 1
              ? tr("Запланировано на {0}", whenLabel(pending[0].at))
              : tr("Запланировано сообщений: {0}", pending.length)}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        <div className="sched-list">
          {pending.map((i) => (
            <div key={i.delayId} className={"sched-item" + (i.failed ? " failed" : "")}>
              <div className="sched-text">
                <span className="sched-when">
                  {whenLabel(i.at)}
                  {i.via === "plus" && <Gem size={11} className="sched-plus" aria-label="Plus" />}
                  {i.failed && <> · {failedText(i.failed)}</>}
                </span>
                <span className="sched-body">{i.text}</span>
              </div>
              {!i.failed && (
                <button className="icon-btn small" onClick={() => void act(() => sendScheduledNow(client, i.delayId))} title={tr("Отправить сейчас")} aria-label={tr("Отправить сейчас")}>
                  <Send size={15} />
                </button>
              )}
              <button
                className="icon-btn small"
                onClick={() => void act(() => cancelScheduled(client, i.delayId))}
                title={i.failed ? tr("Убрать") : tr("Отменить")}
                aria-label={i.failed ? tr("Убрать") : tr("Отменить")}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
