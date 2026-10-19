#!/bin/bash
# Версии JsMessenger на Electron → release/electron/
#   ./scripts/build-electron.sh linux   — .deb (Ubuntu/Debian) и .AppImage (собирается на Linux)
#   ./scripts/build-electron.sh win     — установщик .exe (собирается на Windows, в Git Bash)
# Обычно собирает GitHub Actions (.github/workflows/desktop.yml) при выходе релиза.
#
# Переменные — те же, что для macOS: VITE_DEFAULT_SERVER, VITE_LIVEKIT_SERVICE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "$TARGET" in
  linux) FLAGS="--linux --x64" ;;
  win)   FLAGS="--win --x64" ;;
  *) echo "Укажите платформу: $0 linux | win"; exit 1 ;;
esac
shift

VERSION=$(node -p 'require("./package.json").version')
echo "==> JsMessenger ${VERSION} для ${TARGET}"

npm ci --no-audit --no-fund
npm run build

# интерфейс → electron/web, версия → electron/package.json
rm -rf electron/web
cp -r dist electron/web
VERSION="$VERSION" node -e '
  const f = "electron/package.json", p = require("./" + f);
  p.version = process.env.VERSION;
  require("fs").writeFileSync(f, JSON.stringify(p, null, 2) + "\n");'

# Electron-часть одним файлом (electron-updater — внутри), без node_modules в пакете
npm run electron:bundle

npx electron-builder $FLAGS --publish never "$@"
echo "==> Готово: $(pwd)/release/electron/"
ls -1 release/electron/ | grep -E '\.(deb|AppImage|exe|yml)$'
