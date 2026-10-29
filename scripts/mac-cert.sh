#!/usr/bin/env bash
# Постоянный сертификат подписи для macOS-сборок JsMessenger (самоподписанный, бесплатный).
#
# Зачем: ad-hoc подпись меняется при каждой сборке, и macOS после обновления считает приложение
# новым — заново спрашивает доступ к Связке ключей (там токен входа), микрофону и камере.
# С постоянным сертификатом приложение остаётся «тем же самым».
#
#   ./scripts/mac-cert.sh                — создать сертификат (один раз) и положить копию в ~/.tauri/
#   ./scripts/mac-cert.sh import ФАЙЛ.p12 — поставить тот же сертификат на второй Мак
#
# Это не сертификат Apple Developer: Gatekeeper по-прежнему покажет «неустановленный разработчик»,
# как и сейчас. Сертификат и пароль — секреты, в git их не кладите.
set -euo pipefail
NAME="JsMessenger Self-Signed"
DIR="$HOME/.tauri"
P12="$DIR/jsmessenger-codesign.p12"
PASSFILE="$DIR/jsmessenger-codesign.pass"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
OPENSSL=/usr/bin/openssl # системный LibreSSL: его PKCS#12 понимает security на любой macOS

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin ]] || die "Только для macOS"

have() { security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "\"$NAME\""; }

install_p12() { # файл, пароль, сертификат в PEM (для доверия)
  security import "$1" -k "$KEYCHAIN" -P "$2" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  # доверие для подписи кода (macOS спросит пароль от Мака)
  security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$3"
}

if [[ ${1:-} == import ]]; then
  FILE=${2:?Укажите файл: ./scripts/mac-cert.sh import jsmessenger-codesign.p12}
  [[ -f $FILE ]] || die "Нет файла $FILE"
  if have; then say "Сертификат «$NAME» уже установлен"; exit 0; fi
  PASS=""
  [[ -f "$(dirname "$FILE")/jsmessenger-codesign.pass" ]] && PASS=$(cat "$(dirname "$FILE")/jsmessenger-codesign.pass")
  [[ -n $PASS ]] || read -r -s -p "Пароль от $FILE: " PASS && echo
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  $OPENSSL pkcs12 -in "$FILE" -passin "pass:$PASS" -nokeys -out "$TMP/cert.pem" 2>/dev/null || die "Неверный пароль или файл"
  install_p12 "$FILE" "$PASS" "$TMP/cert.pem"
  mkdir -p "$DIR"
  [[ "$FILE" -ef "$P12" ]] || { cp "$FILE" "$P12"; printf '%s' "$PASS" >"$PASSFILE"; chmod 600 "$P12" "$PASSFILE"; }
  say "Готово: сборки на этом Маке подписываются «$NAME»"
  exit 0
fi

if have; then
  say "Сертификат «$NAME» уже есть в связке ключей"
  [[ -f $P12 ]] && echo "    Копия для второго Мака: $P12 (+ $PASSFILE)"
  exit 0
fi

say "Создаю сертификат «$NAME» (на 10 лет)"
mkdir -p "$DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CNF
$OPENSSL req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
PASS=$($OPENSSL rand -hex 16)
$OPENSSL pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$P12" -passout "pass:$PASS"
printf '%s' "$PASS" >"$PASSFILE"
chmod 600 "$P12" "$PASSFILE"
install_p12 "$P12" "$PASS" "$TMP/cert.pem"
have || die "Сертификат не появился среди подписей — см. «Связка ключей» → «Мои сертификаты»"

say "Готово. Следующие сборки ./scripts/build-mac.sh подпишутся им"
cat <<TXT
    Для второго Мака скопируйте оба файла (как ключ обновлений):
      $P12
      $PASSFILE
    и запустите там: ./scripts/mac-cert.sh import ~/путь/jsmessenger-codesign.p12
    После первой сборки с новой подписью macOS один раз спросит доступ к микрофону и Связке
    ключей — дальше, при обновлениях, перестанет.
TXT
