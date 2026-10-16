#!/bin/bash
# Установщик JsMessenger: ставит приложение в «Программы» и снимает карантин macOS,
# чтобы приложение без подписи Apple открывалось без предупреждений.
set -euo pipefail
cd "$(dirname "$0")"
NAME="JsMessenger"
DEST="/Applications/${NAME}.app"

echo "Установка ${NAME}…"
DMG=$(ls -t JsMessenger-*.dmg 2>/dev/null | head -1 || true)
if [[ -z "$DMG" ]]; then
  echo "Не найден файл JsMessenger-*.dmg рядом с установщиком. Распакуйте архив целиком и запустите снова."
  read -r -p "Нажмите Enter, чтобы закрыть…" _; exit 1
fi

# Закрыть запущенную копию, если она открыта
osascript -e "tell application \"${NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1

MNT=$(mktemp -d /tmp/kpm.XXXXXX)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null
trap 'hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rmdir "$MNT" 2>/dev/null || true' EXIT

copy() {
  rm -rf "$DEST"
  ditto "${MNT}/${NAME}.app" "$DEST"
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
}
# В «Программы» обычно можно писать без пароля; если нет — спросим пароль администратора
if [[ -w /Applications ]] && { [[ ! -e "$DEST" ]] || [[ -w "$DEST" ]]; }; then
  copy
else
  echo "Нужен пароль администратора этого Мака:"
  sudo rm -rf "$DEST"
  sudo ditto "${MNT}/${NAME}.app" "$DEST"
  sudo xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
fi

echo "Готово: ${NAME} установлен в «Программы». Запускаю…"
open "$DEST"
sleep 1
osascript -e 'tell application "Terminal" to close (every window whose name contains ".command")' >/dev/null 2>&1 &
exit 0
