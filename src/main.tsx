import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./platform";
import "@fontsource-variable/onest";
import "./styles.css";

// На Linux у окна обычная системная рамка — отступы под «светофор» macOS не нужны
if (window.jsmDesktop) document.documentElement.dataset.platform = window.jsmDesktop.platform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
