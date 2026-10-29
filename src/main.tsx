import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AskHost } from "./components/Ask";
import "./platform";
import { setupIOS } from "./ios";
import { lang } from "./i18n";
import "@fontsource-variable/onest";
import "./styles.css";

// На Linux у окна обычная системная рамка — отступы под «светофор» macOS не нужны
if (window.jsmDesktop) {
  document.documentElement.dataset.platform = window.jsmDesktop.platform;
  window.jsmDesktop.setLang?.(lang);
}
else if (/Android/i.test(navigator.userAgent)) document.documentElement.dataset.platform = "android";
else if ("__TAURI_INTERNALS__" in window && /iPhone|iPad/i.test(navigator.userAgent)) setupIOS();

// В приложении системное меню WebView («Перезагрузить», «Проверить элемент») не нужно.
// Оставляем его только для полей ввода и выделенного текста (вырезать/копировать/вставить);
// у сообщений, чатов и вложений — свои меню.
if (window.jsmDesktop || "__TAURI_INTERNALS__" in window) {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable=true]")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AskHost />
  </StrictMode>,
);
