#!/usr/bin/env bash
# Обновить сайт и сервис на сервере из GitHub (после scripts/server-setup.sh).
#   sudo bash /opt/jsmessenger/scripts/server-update.sh
set -euo pipefail
APP=/opt/jsmessenger
WWW=/var/www/jsmessenger
before=$(git -C "${APP}" rev-parse HEAD)
git -C "${APP}" pull -q --ff-only
after=$(git -C "${APP}" rev-parse HEAD)
if [ "${before}" = "${after}" ]; then
  echo "Нового нет: $(git -C "${APP}" log --oneline -1)"
else
  echo "Обновлено:"
  git -C "${APP}" log --oneline "${before}..${after}" | head -20
fi
# зависимости сервиса — только если поменялись
if ! git -C "${APP}" diff --quiet "${before}" "${after}" -- services/feedback/package-lock.json; then
  (cd "${APP}/services/feedback" && npm ci --omit=dev --silent)
fi
rsync -a --delete --exclude nginx.conf.example "${APP}/site/" "${WWW}/"
systemctl restart jsmessenger-feedback
sleep 1
printf 'сервис: %s, сайт: %s\n' "$(systemctl is-active jsmessenger-feedback)" \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: jsmessenger.ru' -k https://127.0.0.1/)"
