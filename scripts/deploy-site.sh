#!/bin/bash
# Выложить сайт (папка site/) на сервер по ssh.
#   ./scripts/deploy-site.sh user@server            → /var/www/jsmassenger.ru
#   ./scripts/deploy-site.sh user@server /другая/папка
# Установщики на сервер не копируются: сайт берёт ссылки из последнего релиза GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:?Укажите сервер: ./scripts/deploy-site.sh user@server}"
DIR="${2:-/var/www/jsmassenger.ru}"
ssh "$HOST" "mkdir -p '$DIR'"
rsync -av --delete --exclude 'nginx.conf.example' site/ "$HOST:$DIR/"
echo "Готово: файлы в $HOST:$DIR"
