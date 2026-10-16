import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Порт 1420 ожидает Tauri (см. src-tauri/tauri.conf.json → build.devUrl)
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // WASM-модуль шифрования грузит себя через import.meta.url — не пре-бандлить
  optimizeDeps: { exclude: ["@matrix-org/matrix-sdk-crypto-wasm"] },
  build: { target: "esnext", sourcemap: true },
});
