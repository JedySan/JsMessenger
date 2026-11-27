#!/usr/bin/env bash
# Распознавание речи для JsMessenger Plus: whisper.cpp на этом сервере (только для 127.0.0.1).
#   sudo bash /opt/jsmessenger/services/whisper/setup.sh [модель]
# Модель по умолчанию — small-q5_1: ~190 МБ на диске, ~500 МБ памяти, хорошо понимает русский.
# Для слабого сервера можно base-q5_1 (быстрее, но ошибается чаще), для мощного — medium-q5_0.
set -euo pipefail
MODEL="${1:-small-q5_1}"
DIR=/opt/whisper.cpp
TAG=v1.9.6

# без вопросов: иначе apt (needrestart, debconf) ждёт ответа в невидимом окне
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -qq
apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold build-essential cmake git ffmpeg curl

if [ ! -d "${DIR}/.git" ]; then
  git clone --depth 1 --branch "${TAG}" https://github.com/ggml-org/whisper.cpp "${DIR}"
fi
cd "${DIR}"
cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null
cmake --build build -j "$(nproc)" --target whisper-server
[ -f "models/ggml-${MODEL}.bin" ] || bash models/download-ggml-model.sh "${MODEL}"

cat > /etc/systemd/system/whisper.service <<UNIT
[Unit]
Description=whisper.cpp — распознавание голосовых для JsMessenger Plus
After=network.target

[Service]
ExecStart=${DIR}/build/bin/whisper-server -m ${DIR}/models/ggml-${MODEL}.bin --host 127.0.0.1 --port 8178 -t $(nproc) -l auto
DynamicUser=yes
Restart=on-failure
Nice=10
MemoryMax=1200M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now whisper
echo
echo "Готово. Добавьте в /etc/jsmessenger-feedback.env строку"
echo "  WHISPER_URL=http://127.0.0.1:8178/inference"
echo "и перезапустите: systemctl restart jsmessenger-feedback"
