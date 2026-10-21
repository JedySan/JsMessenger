import { useEffect, useState } from "react";
import { AppWindow, Monitor, X } from "lucide-react";
import { electron, type ScreenSource } from "../platform";
import { tr } from "../i18n";

/** Выбор экрана или окна для показа в звонке (Electron: Windows и Linux на X11). */
export default function ScreenPicker() {
  const [req, setReq] = useState<{ sources: ScreenSource[]; done: (id: string | null) => void } | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");

  useEffect(() => {
    const el = electron();
    if (!el?.onPickSource) return;
    return el.onPickSource(
      (sources) =>
        new Promise((resolve) => {
          setTab(sources.some((s) => s.screen) ? "screen" : "window");
          setReq({ sources, done: resolve });
        }),
    );
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;
  function finish(id: string | null) {
    req?.done(id);
    setReq(null);
  }
  const list = req.sources.filter((s) => s.screen === (tab === "screen"));
  const screens = req.sources.filter((s) => s.screen).length;
  const windows = req.sources.length - screens;

  return (
    <div className="modal-bg" onClick={() => finish(null)}>
      <div className="card modal picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tr("Что показать")}>
        <div className="picker-head">
          <h2>{tr("Что показать?")}</h2>
          <button className="icon-btn" onClick={() => finish(null)} aria-label={tr("Отмена")}>
            <X size={18} />
          </button>
        </div>
        <div className="picker-tabs">
          <button className={"chip" + (tab === "screen" ? " on" : "")} onClick={() => setTab("screen")} disabled={!screens}>
            <Monitor size={14} /> {screens > 1 ? tr("Экраны ({0})", screens) : tr("Экран")}
          </button>
          <button className={"chip" + (tab === "window" ? " on" : "")} onClick={() => setTab("window")} disabled={!windows}>
            <AppWindow size={14} /> {tr("Окна ({0})", windows)}
          </button>
        </div>
        <div className="picker-grid">
          {list.map((s, i) => (
            <button key={s.id} className="picker-item" onClick={() => finish(s.id)} title={s.name}>
              <img src={s.thumb} alt="" />
              <span>{s.screen ? (screens > 1 ? tr("Экран {0}", i + 1) : tr("Весь экран")) : s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
