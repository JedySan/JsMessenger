#!/usr/bin/env bash
# Сборка для iPhone и установка на телефон, подключённый кабелем.
# Бесплатный Apple ID подходит (без App Store и TestFlight), но такая сборка работает 7 дней —
# потом просто запустите скрипт ещё раз. Данные приложения при переустановке сохраняются.
#
#   ./scripts/build-ios.sh            собрать и поставить на подключённый iPhone
#   ./scripts/build-ios.sh --no-install   только собрать (.ipa в release/ios/)
#   APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX ./scripts/build-ios.sh   если команда не нашлась сама
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

INSTALL=1
[ "${1:-}" = "--no-install" ] && INSTALL=0

# ---------- инструменты ----------
xcodebuild -version >/dev/null 2>&1 || die "Нужен Xcode (App Store). Откройте его один раз и примите соглашение."
command -v rustup >/dev/null || die "Нужен Rust: https://rustup.rs"
rustup target list --installed | grep -q '^aarch64-apple-ios$' || { say "Rust для iPhone"; rustup target add aarch64-apple-ios; }
if ! command -v xcodegen >/dev/null || ! command -v pod >/dev/null; then
  command -v brew >/dev/null || die "Нужны xcodegen и cocoapods: поставьте Homebrew (https://brew.sh) и запустите ещё раз"
  say "Ставлю xcodegen и cocoapods"
  brew install xcodegen cocoapods
fi
[ -d node_modules ] || { say "npm ci"; npm ci; }

# ---------- команда разработчика (Personal Team вашего Apple ID) ----------
TEAM="${APPLE_DEVELOPMENT_TEAM:-}"
if [ -z "$TEAM" ]; then
  TEAM=$(security find-certificate -a -c "Apple Development" -p 2>/dev/null |
    openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1 || true)
fi
if [ -z "$TEAM" ]; then
  die "Не нашёл сертификат «Apple Development».
  Xcode → Settings → Accounts → ваш Apple ID → Manage Certificates… → «+» → Apple Development,
  затем запустите скрипт ещё раз (или укажите APPLE_DEVELOPMENT_TEAM=<ID команды>)."
fi
export APPLE_DEVELOPMENT_TEAM="$TEAM"
say "Команда разработчика: $TEAM"

# ---------- проект Xcode (src-tauri/gen/apple, создаётся один раз) ----------
if [ ! -d src-tauri/gen/apple ]; then
  say "Создаю проект Xcode"
  npx tauri ios init
fi

# ---------- сборка ----------
say "Собираю (первый раз — минут 10)"
npx tauri ios build --export-method debugging
IPA=$(ls -t src-tauri/gen/apple/build/arm64/*.ipa 2>/dev/null | head -1 || true)
[ -n "$IPA" ] || die "Сборка прошла, но .ipa не нашёлся в src-tauri/gen/apple/build/arm64/"
VERSION=$(node -p 'require("./package.json").version')
mkdir -p release/ios
cp "$IPA" "release/ios/JsMessenger-$VERSION.ipa"
say "Готово: release/ios/JsMessenger-$VERSION.ipa"
[ "$INSTALL" = 1 ] || exit 0

# ---------- установка на подключённый iPhone ----------
JSON=$(mktemp)
xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1 || true
DEVICE=$(node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const list = (d.result?.devices ?? []).filter((x) => x.hardwareProperties?.platform === "iOS" &&
    x.connectionProperties?.pairingState === "paired");
  const best = list.find((x) => x.connectionProperties?.transportType === "wired") ?? list[0];
  if (best) console.log(best.identifier + "\t" + (best.deviceProperties?.name ?? "iPhone"));
' "$JSON" 2>/dev/null || true)
rm -f "$JSON"
if [ -z "$DEVICE" ]; then
  die "iPhone не найден. Подключите его кабелем, разблокируйте и нажмите «Доверять этому компьютеру».
  Файл для установки: release/ios/JsMessenger-$VERSION.ipa"
fi
ID=${DEVICE%%$'\t'*}
NAME=${DEVICE#*$'\t'}
APPDIR=$(mktemp -d)
unzip -q "$IPA" -d "$APPDIR"
say "Ставлю на «$NAME»"
if ! xcrun devicectl device install app --device "$ID" "$APPDIR"/Payload/*.app; then
  rm -rf "$APPDIR"
  die "Установка не удалась. Проверьте на iPhone: Настройки → Конфиденциальность и безопасность → Режим разработчика (вкл.)"
fi
rm -rf "$APPDIR"
say "Установлено. Первый запуск: Настройки → Основные → VPN и управление устройством → ваш Apple ID → Доверять"
