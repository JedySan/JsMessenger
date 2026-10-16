#!/bin/bash
# Linux-версия JsMessenger (Electron): .deb (Ubuntu/Debian) и .AppImage → release/linux/
# Собирается на Linux — локально или в GitHub Actions (.github/workflows/linux.yml).
#
# Переменные — те же, что для macOS: VITE_DEFAULT_SERVER, VITE_LIVEKIT_SERVICE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname)" == "Linux" ]] || { echo "Linux-пакеты собираются на Linux (или в GitHub Actions)"; exit 1; }
VERSION=$(node -p 'require("./package.json").version')
echo "==> JsMessenger ${VERSION} для Linux"

npm ci --no-audit --no-fund
npm run build

# интерфейс → electron/web, версия → electron/package.json
rm -rf electron/web
cp -r dist electron/web
VERSION="$VERSION" node -e '
  const f = "electron/package.json", p = require("./" + f);
  p.version = process.env.VERSION;
  require("fs").writeFileSync(f, JSON.stringify(p, null, 2) + "\n");'

# зависимости самой Electron-части (только electron-updater) — отдельно от интерфейса,
# иначе в пакет попадут node_modules проекта, уже собранные Vite в web/
npm install --prefix electron --omit=dev --no-audit --no-fund --no-package-lock

npx electron-builder --linux --x64 --publish never "$@"
echo "==> Готово: $(pwd)/release/linux/"
ls -1 release/linux/ | grep -E '\.(deb|AppImage|yml)$'
