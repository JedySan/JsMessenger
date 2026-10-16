#!/bin/bash
# Универсальная сборка JsMessenger (Apple Silicon + Intel) и архив для раздачи.
# Сервер по умолчанию можно вшить: VITE_DEFAULT_SERVER=matrix.example.com ./scripts/build-mac.sh
# Запуск из папки проекта:  ./scripts/build-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "сборка macOS-приложения возможна только на Mac"
command -v npm >/dev/null || die "не найден npm (brew install node)"
command -v cargo >/dev/null || { [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"; }
command -v rustup >/dev/null || die "не найден Rust (curl https://sh.rustup.rs -sSf | sh)"

VERSION=$(node -p 'require("./package.json").version')
NAME="JsMessenger"
OUT="release/JsMessenger-${VERSION}-macOS"
TARGET="universal-apple-darwin"
BUNDLE="src-tauri/target/${TARGET}/release/bundle"

say "Версия ${VERSION}: готовлю инструменты"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npm install --no-audit --no-fund

say "Собираю универсальное приложение (первый раз — 5–10 минут)"
npm run tauri build -- --target "$TARGET" --bundles app dmg

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

say "Готово"
echo "Пакет:  $(pwd)/${OUT}.zip  ($(du -h "${OUT}.zip" | cut -f1))"
echo "Внутри: DMG, установщик, инструкция, лицензии"
open -R "${OUT}.zip"
