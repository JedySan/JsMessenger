import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./platform";
import { lang } from "./i18n";
import "@fontsource-variable/onest";
import "./styles.css";

// На Linux у окна обычная системная рамка — отступы под «светофор» macOS не нужны
if (window.jsmDesktop) {
  document.documentElement.dataset.platform = window.jsmDesktop.platform;
  window.jsmDesktop.setLang?.(lang);
}
else if (/Android/i.test(navigator.userAgent)) document.documentElement.dataset.platform = "android";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
