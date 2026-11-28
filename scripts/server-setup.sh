#!/usr/bin/env bash
# Поставить сайт JsMessenger на чистый сервер (Ubuntu 22.04/24.04) целиком: сайт, отзывы, Plus, расшифровку.
#   sudo bash server-setup.sh <почта для Let's Encrypt> <домен> [ещё домены…]
#   пример: sudo bash server-setup.sh jedysan@gmail.com jsmessenger.ru www.jsmessenger.ru jsmassenger.ru www.jsmassenger.ru
# Первый домен — основной (адрес админки и писем). Все домены обслуживаются одинаково: старые версии
# приложения ходят на старый адрес, поэтому он должен работать, а не перенаправлять.
# Если рядом лежит /root/jsm-move.tgz (архив со старого сервера) — отзывы, подписчики Plus и настройки
# переносятся из него. Можно запускать повторно: уже сделанное не ломается.
set -euo pipefail
EMAIL="${1:?Укажите почту для сертификата Let’s Encrypt}"
shift
[ $# -ge 1 ] || { echo "Укажите хотя бы один домен"; exit 1; }
MAIN="$1"
DOMAINS=("$@")
REPO=https://github.com/JedySan/JsMessenger.git
APP=/opt/jsmessenger
WWW=/var/www/jsmessenger
ENVF=/etc/jsmessenger-feedback.env
DATA=/var/lib/private/jsmessenger-feedback
ARCHIVE=/root/jsm-move.tgz
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }

say "Пакеты"
apt-get update -qq
apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
  nginx certbot python3-certbot-nginx git rsync curl ca-certificates ffmpeg dnsutils >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v), nginx $(nginx -v 2>&1 | cut -d/ -f2)"

say "Код"
if [ -d "${APP}/.git" ]; then git -C "${APP}" pull -q; else git clone -q "${REPO}" "${APP}"; fi
(cd "${APP}/services/feedback" && npm ci --omit=dev --silent)
mkdir -p "${WWW}"
rsync -a --delete --exclude nginx.conf.example "${APP}/site/" "${WWW}/"

say "Данные и настройки"
if [ -f "${ARCHIVE}" ] && [ ! -f "${DATA}/feedback.json" ]; then
  tmp=$(mktemp -d)
  tar xzf "${ARCHIVE}" -C "${tmp}"
  [ -f "${tmp}/etc/jsmessenger-feedback.env" ] && [ ! -f "${ENVF}" ] && install -m 600 "${tmp}/etc/jsmessenger-feedback.env" "${ENVF}"
  if [ -d "${tmp}/var/lib/private/jsmessenger-feedback" ]; then
    mkdir -p /var/lib/private && chmod 700 /var/lib/private
    rsync -a "${tmp}/var/lib/private/jsmessenger-feedback/" "${DATA}/"
  fi
  rm -rf "${tmp}"
  echo "перенесено из ${ARCHIVE}: $(ls "${DATA}" 2>/dev/null | tr '\n' ' ')"
fi
if [ ! -f "${ENVF}" ]; then
  install -m 600 "${APP}/services/feedback/feedback.env.example" "${ENVF}"
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')/" "${ENVF}"
  echo "новые настройки: ${ENVF} — впишите почту (SMTP)"
fi
setenv() { # setenv КЛЮЧ значение — одна строка на ключ
  if grep -q "^$1=" "${ENVF}"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{ if (!s++) print k"="v; next } {print}' "${ENVF}" > "${ENVF}.tmp"
    cat "${ENVF}.tmp" > "${ENVF}" && rm "${ENVF}.tmp"
  else
    echo "$1=$2" >> "${ENVF}"
  fi
}
setenv SITE_URL "https://${MAIN}"
setenv WHISPER_URL "http://127.0.0.1:8178/inference"

say "Служба отзывов и Plus"
cp "${APP}/services/feedback/jsmessenger-feedback.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q jsmessenger-feedback
systemctl restart jsmessenger-feedback

say "nginx"
cat > /etc/nginx/sites-available/jsmessenger <<NGINX
# Сайт JsMessenger (scripts/server-setup.sh). HTTPS добавляет certbot.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAINS[*]};
    root ${WWW};
    index index.html;
    server_tokens off;

    location / { try_files \$uri \$uri/ =404; }
    # отзывы, админка и Plus — сервис jsmessenger-feedback
    location = /api/feedback {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
        client_max_body_size 30m;
    }
    location /api/plus/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
        client_max_body_size 25m; # голосовые на расшифровку
    }
    location ^~ /admin { # ^~: иначе admin.css и картинки отзывов уйдут в правило для статики ниже
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
    }
    location ~* \.(png|css|js)\$ { expires 7d; add_header Cache-Control "public"; }
    location = /index.html { add_header Cache-Control "no-cache"; }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    gzip on;
    gzip_types text/css application/javascript;
}
NGINX
ln -sf /etc/nginx/sites-available/jsmessenger /etc/nginx/sites-enabled/jsmessenger
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx

say "Сертификат"
MYIP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
ok=()
for d in "${DOMAINS[@]}"; do
  ip=$(dig +short A "$d" @1.1.1.1 | tail -1)
  if [ "$ip" = "$MYIP" ]; then ok+=("-d" "$d"); else echo "пропускаю $d: в DNS ${ip:-нет записи}, а у сервера ${MYIP}"; fi
done
if [ ${#ok[@]} -gt 0 ]; then
  certbot --nginx --non-interactive --agree-tos -m "${EMAIL}" --redirect --cert-name "${MAIN}" --expand "${ok[@]}"
else
  echo "Ни один домен ещё не смотрит на этот сервер — запустите скрипт ещё раз, когда обновится DNS."
fi

say "Расшифровка голосовых (whisper.cpp, модель base)"
if ! systemctl is-active -q whisper; then bash "${APP}/services/whisper/setup.sh" base-q5_1; fi
systemctl restart jsmessenger-feedback

say "Проверка"
systemctl is-active nginx jsmessenger-feedback whisper | paste -sd' '
for d in "${DOMAINS[@]}"; do
  printf '%-28s %s\n' "$d" "$(curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 10 "https://$d/" || echo 'нет ответа')"
done
echo
echo "Админка: https://${MAIN}/admin/  (логин admin, пароль — ADMIN_PASSWORD в ${ENVF})"
