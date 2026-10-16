#!/bin/bash
# Универсальная сборка JsMessenger (Apple Silicon + Intel), архив для установки и файлы автообновления.
#
#   ./scripts/build-mac.sh              — собрать
#   ./scripts/build-mac.sh --publish    — собрать и выложить релиз на GitHub (нужен gh)
#
# Переменные (все необязательные):
#   VITE_DEFAULT_SERVER       сервер Matrix в форме входа, например matrix.example.com
#   VITE_LIVEKIT_SERVICE_URL  запасной адрес lk-jwt-service для звонков
#   JSM_UPDATE_URL            где будут лежать файлы обновлений (без / в конце);
#                             по умолчанию — релизы GitHub (работает, только если репозиторий публичный)
#   JSM_UPDATER_KEY           ключ подписи обновлений; по умолчанию ~/.tauri/jsmessenger.key
#   JSM_RELEASE_NOTES         что нового — показывается в окне обновления
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

PUBLISH=0
[[ "${1:-}" == "--publish" ]] && PUBLISH=1

[[ "$(uname)" == "Darwin" ]] || die "сборка macOS-приложения возможна только на Mac"
command -v npm >/dev/null || die "не найден npm (brew install node)"
command -v cargo >/dev/null || { [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"; }
command -v rustup >/dev/null || die "не найден Rust (curl https://sh.rustup.rs -sSf | sh)"

VERSION=$(node -p 'require("./package.json").version')
NAME="JsMessenger"
OUT="release/JsMessenger-${VERSION}-macOS"
UPD="release/update-${VERSION}"
TARGET="universal-apple-darwin"
BUNDLE="src-tauri/target/${TARGET}/release/bundle"
UPDATE_URL="${JSM_UPDATE_URL:-https://github.com/JedySan/JsMessenger/releases/latest/download}"
UPDATE_URL="${UPDATE_URL%/}"
KEY="${JSM_UPDATER_KEY:-$HOME/.tauri/jsmessenger.key}"

say "Версия ${VERSION}: готовлю инструменты"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npm install --no-audit --no-fund

# ---------- автообновление: включается, если есть ключ подписи ----------
# (в системном bash 3.2 на macOS пустые массивы ломаются при set -u — используем флаг)
UPDATER=0
CONF=""
if [[ -f "$KEY" && -f "${KEY}.pub" ]]; then
  [[ "$UPDATE_URL" == https://* ]] || die "JSM_UPDATE_URL должен начинаться с https://"
  export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  CONF="$(mktemp -d)/updater.json"
  PUBKEY="$(cat "${KEY}.pub")" ENDPOINT="${UPDATE_URL}/latest.json" node -e '
    const c = { bundle: { createUpdaterArtifacts: true },
                plugins: { updater: { pubkey: process.env.PUBKEY.trim(), endpoints: [process.env.ENDPOINT] } } };
    require("fs").writeFileSync(process.argv[1], JSON.stringify(c, null, 2));' "$CONF"
  UPDATER=1
  echo "Автообновление: включено, проверка по ${UPDATE_URL}/latest.json"
else
  warn "Автообновление: ВЫКЛЮЧЕНО — нет ключа ${KEY}"
  warn "Создайте ключ один раз: ./scripts/updater-keygen.sh"
fi

say "Собираю универсальное приложение (первый раз — 5–10 минут)"
if [[ $UPDATER -eq 1 ]]; then
  npm run tauri build -- --target "$TARGET" --bundles app dmg --config "$CONF"
else
  npm run tauri build -- --target "$TARGET" --bundles app dmg
fi

APP="${BUNDLE}/macos/${NAME}.app"
DMG=$(ls -t "${BUNDLE}"/dmg/*.dmg 2>/dev/null | head -1 || true)
[[ -d "$APP" ]] || die "не найдено ${APP}"
[[ -n "$DMG" ]] || die "DMG не создан (см. вывод выше: если macOS спрашивала доступ Терминала к Finder — разрешите и запустите снова)"

say "Проверяю сборку"
EXE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "${APP}/Contents/Info.plist")
ARCHS=$(lipo -archs "${APP}/Contents/MacOS/${EXE}")
echo "Архитектуры: ${ARCHS}"
[[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || die "сборка не универсальная"
codesign --verify --deep --strict "$APP" && echo "Подпись: целостна (ad-hoc)"

say "Собираю пакет для установки"
rm -rf "$OUT" "${OUT}.zip"
mkdir -p "$OUT"
cp "$DMG" "${OUT}/JsMessenger-${VERSION}.dmg"
cp packaging/install.command "${OUT}/Установить JsMessenger.command"
chmod +x "${OUT}/Установить JsMessenger.command"
sed "s/{{VERSION}}/${VERSION}/g" packaging/README-install.txt > "${OUT}/Как установить.txt"
cp public/THIRD_PARTY_LICENSES.txt "${OUT}/Лицензии.txt"
# ditto сохраняет права и атрибуты — так .command останется исполняемым
ditto -c -k --keepParent "$OUT" "${OUT}.zip"

# ---------- файлы обновления ----------
if [[ $UPDATER -eq 1 ]]; then
  say "Готовлю файлы обновления"
  TGZ="${BUNDLE}/macos/${NAME}.app.tar.gz"
  [[ -f "$TGZ" && -f "${TGZ}.sig" ]] || die "не созданы ${TGZ} и .sig — проверьте ключ и пароль (TAURI_SIGNING_PRIVATE_KEY_PASSWORD)"
  FILE="JsMessenger_${VERSION}_universal.app.tar.gz"
  rm -rf "$UPD" && mkdir -p "$UPD"
  cp "$TGZ" "${UPD}/${FILE}"
  # одна универсальная сборка подходит и для Apple Silicon, и для Intel
  VERSION="$VERSION" URL="${UPDATE_URL}/${FILE}" SIG="$(cat "${TGZ}.sig")" NOTES="${JSM_RELEASE_NOTES:-}" node -e '
    const e = process.env, p = { signature: e.SIG, url: e.URL };
    const j = { version: e.VERSION, notes: e.NOTES, pub_date: new Date().toISOString(),
                platforms: { "darwin-aarch64": p, "darwin-x86_64": p } };
    require("fs").writeFileSync(process.argv[1], JSON.stringify(j, null, 2) + "\n");' "${UPD}/latest.json"
  echo "Файлы обновления: $(pwd)/${UPD}/"
  echo "  ${FILE}"
  echo "  latest.json  → должен быть доступен по ${UPDATE_URL}/latest.json"

  if [[ $PUBLISH -eq 1 ]]; then
    command -v gh >/dev/null || die "для --publish нужен GitHub CLI: brew install gh && gh auth login"
    say "Публикую релиз v${VERSION} на GitHub"
    gh release create "v${VERSION}" \
      "${UPD}/${FILE}" "${UPD}/latest.json" "${OUT}.zip" \
      --title "JsMessenger ${VERSION}" --notes "${JSM_RELEASE_NOTES:-JsMessenger ${VERSION}}"
  fi
fi

say "Готово"
echo "Пакет:  $(pwd)/${OUT}.zip  ($(du -h "${OUT}.zip" | cut -f1))"
echo "Внутри: DMG, установщик, инструкция, лицензии"
open -R "${OUT}.zip"
