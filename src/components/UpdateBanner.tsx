import { useSyncExternalStore } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { dismissUpdate, getUpdateState, installUpdate, subscribeUpdate } from "../desktop";
import { isAndroidApp } from "../platform";
import { tr } from "../i18n";

/** Плашка в боковой панели: найдено обновление, скачивание, ошибка, «обновлений нет». */
export default function UpdateBanner() {
  const st = useSyncExternalStore(subscribeUpdate, getUpdateState);

  switch (st.kind) {
    case "available":
      return (
        <div className="update-bar stack">
          <Download size={16} className="update-icon" />
          <span className="update-text">
            <b>{tr("Доступна версия {0}", st.version)}</b>
            <span>{st.notes?.trim() || (isAndroidApp() ? tr("Скачается установочный файл — откройте его, чтобы обновить") : tr("Приложение перезапустится за пару секунд"))}</span>
          </span>
          <span className="update-actions">
            <button className="ghost small-ghost" onClick={dismissUpdate}>
              {tr("Позже")}
            </button>
            <button className="pill join" onClick={() => installUpdate()}>
              {tr("Обновить")}
            </button>
          </span>
        </div>
      );
    case "downloading":
    case "ready":
      return (
        <div className="update-bar">
          <LoaderCircle size={16} className="update-icon spin" />
          <span className="update-text">
            <b>{st.kind === "ready" ? tr("Перезапускаю…") : tr("Загружаю версию {0}", st.version)}</b>
            {st.kind === "downloading" && (
              <span className="progress">
                <div style={{ width: `${st.percent ?? 30}%` }} className={st.percent === null ? "indeterminate" : ""} />
              </span>
            )}
          </span>
        </div>
      );
    case "checking":
      return (
        <div className="update-bar quiet">
          <LoaderCircle size={14} className="spin" />
          <span className="update-text">{tr("Проверяю обновления…")}</span>
        </div>
      );
    case "none":
    case "error":
      return (
        <div className={"update-bar quiet" + (st.kind === "error" ? " err" : "")}>
          <span className="update-text">{st.kind === "none" ? tr("У вас последняя версия") : st.message}</span>
          <button className="icon-btn small" onClick={dismissUpdate} aria-label={tr("Закрыть")}>
            <X size={14} />
          </button>
        </div>
      );
    default:
      return null;
  }
}
