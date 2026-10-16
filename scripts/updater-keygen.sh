#!/bin/bash
# Один раз создаёт ключ подписи обновлений JsMessenger.
# Приложение принимает обновление, только если оно подписано этим ключом.
#
#   ./scripts/updater-keygen.sh                 — ключ без пароля в ~/.tauri/jsmessenger.key
#   ./scripts/updater-keygen.sh --password      — спросить пароль (тогда при сборке задавайте
#                                                 TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${JSM_UPDATER_KEY:-$HOME/.tauri/jsmessenger.key}"
if [[ -f "$KEY" ]]; then
  echo "Ключ уже есть: $KEY"
  echo "Если создать новый, установленные копии перестанут принимать обновления — их придётся переустановить."
  exit 1
fi
mkdir -p "$(dirname "$KEY")"

command -v npm >/dev/null || { echo "Не найден npm (brew install node)"; exit 1; }
# зависимости проекта (в них tauri CLI) — если ещё не ставились
[[ -x node_modules/.bin/tauri ]] || npm install --no-audit --no-fund
# вызываем CLI напрямую: через «npm run» пустой пароль "" теряется
TAURI=node_modules/.bin/tauri

if [[ "${1:-}" == "--password" ]]; then
  "$TAURI" signer generate -w "$KEY"
else
  "$TAURI" signer generate --ci -p "" -w "$KEY"
fi
chmod 600 "$KEY"

cat <<EOF

Готово.
  Закрытый ключ: $KEY       ← держите в секрете и сделайте резервную копию
  Открытый ключ: ${KEY}.pub ← вшивается в приложение при сборке

Без закрытого ключа нельзя выпустить обновление для уже установленных копий.
Не кладите его в git. Дальше просто: ./scripts/build-mac.sh
EOF
