// Отложенные сообщения: окно выбора времени и полоска «Запланировано» над полем ввода.
import { useEffect, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { CalendarClock, ChevronDown, ChevronUp, Send, X } from "lucide-react";
import { Modal } from "./ui";
import { notice } from "./Ask";
import { cancelScheduled, listScheduled, onScheduledChange, schedulePresets, scheduleError, sendScheduledNow, type Scheduled } from "../scheduled";
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

/** Выбрать, когда отправить. */
export function ScheduleDialog({ text, onPick, onClose }: { text: string; onPick: (at: Date) => Promise<void>; onClose: () => void }) {
  const presets = schedulePresets();
  const [custom, setCustom] = useState(() => {
    const d = new Date(Date.now() + 2 * 3_600_000);
    d.setMinutes(0, 0, 0);
    return localInput(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (at: Date) => {
    if (at.getTime() < Date.now() + 30_000) return setError(tr("Выберите время в будущем"));
    setBusy(true);
    setError(null);
    try {
      await onPick(at);
      onClose();
    } catch (e) {
      setError(scheduleError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={tr("Отправить позже")} icon={<CalendarClock size={18} />} onClose={onClose} busy={busy}>
      <p className="sched-preview">{text}</p>
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
      <p className="modal-text small-note">{tr("Сообщение отправит сервер — даже если приложение будет закрыто.")}</p>
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
  const pending = items.filter((i) => i.at > Date.now() - 5_000);
  useEffect(() => {
    const next = items.length ? Math.min(...items.map((i) => i.at)) : 0;
    if (!next) return;
    const t = window.setTimeout(() => setTick((x) => x + 1), Math.max(3_000, next - Date.now() + 3_000));
    return () => window.clearTimeout(t);
  }, [items]);
  if (!pending.length) return null;
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notice(scheduleError(e));
    }
    setTick((x) => x + 1);
  };
  return (
    <div className={"sched-bar" + (open ? " open" : "")}>
      <button className="sched-head" onClick={() => setOpen((v) => !v)}>
        <CalendarClock size={15} />
        <span>
          {pending.length === 1
            ? tr("Запланировано на {0}", whenLabel(pending[0].at))
            : tr("Запланировано сообщений: {0}", pending.length)}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        <div className="sched-list">
          {pending.map((i) => (
            <div key={i.delayId} className="sched-item">
              <div className="sched-text">
                <span className="sched-when">{whenLabel(i.at)}</span>
                <span className="sched-body">{i.text}</span>
              </div>
              <button className="icon-btn small" onClick={() => void act(() => sendScheduledNow(client, i.delayId))} title={tr("Отправить сейчас")} aria-label={tr("Отправить сейчас")}>
                <Send size={15} />
              </button>
              <button className="icon-btn small" onClick={() => void act(() => cancelScheduled(client, i.delayId))} title={tr("Отменить")} aria-label={tr("Отменить")}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
