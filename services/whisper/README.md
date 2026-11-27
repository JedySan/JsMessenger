# Распознавание речи для JsMessenger Plus

whisper.cpp на сервере сайта, слушает только 127.0.0.1:8178; к нему ходит сервис `jsmessenger-feedback`.

```bash
sudo bash /opt/jsmessenger/services/whisper/setup.sh            # модель small-q5_1
echo 'WHISPER_URL=http://127.0.0.1:8178/inference' | sudo tee -a /etc/jsmessenger-feedback.env
sudo systemctl restart jsmessenger-feedback
```

Модели (аргумент скрипта): `base-q5_1` — быстрее, хуже понимает; `small-q5_1` — по умолчанию;
`medium-q5_0` — точнее, нужно ~2 ГБ памяти и в разы больше времени. На 1 ядре small распознаёт
примерно со скоростью самой речи: минутное голосовое — около минуты.
