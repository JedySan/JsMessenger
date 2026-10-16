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

if [[ "${1:-}" == "--password" ]]; then
  npm run tauri signer generate -- -w "$KEY"
else
  npm run tauri signer generate -- --ci -p "" -w "$KEY"
fi
chmod 600 "$KEY"

cat <<EOF

Готово.
  Закрытый ключ: $KEY       ← держите в секрете и сделайте резервную копию
  Открытый ключ: ${KEY}.pub ← вшивается в приложение при сборке

Без закрытого ключа нельзя выпустить обновление для уже установленных копий.
Не кладите его в git. Дальше просто: ./scripts/build-mac.sh
EOF
