// Собирает Electron-часть (main + preload) в electron/dist/ — по одному файлу, с зависимостями внутри.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "info" };
await build({ ...common, entryPoints: ["electron/main.cjs"], outfile: "electron/dist/main.cjs" });
await build({ ...common, entryPoints: ["electron/preload.cjs"], outfile: "electron/dist/preload.cjs" });
