# Отзывы JsMessenger

Маленький сервис на сайте: принимает отзывы из приложения (меню «…» → «Написать разработчику»),
хранит их, показывает в админке `https://jsmassenger.ru/admin/` и присылает письмо на почту.

- `POST /api/feedback` — JSON `{ kind: "bug"|"idea"|"other", text, contact?, app? }`; не больше 5 отзывов с адреса за 10 минут.
- `/admin/` — список (новые / обработанные / все), «Обработано», «Удалить». Вход — логин и пароль из настроек.
- Хранение — `feedback.json` в `DATA_DIR`. Почта — через SMTP или локальный sendmail.

## Установка (на сервере сайта, один раз)

```bash
cd /opt/jsmessenger/services/feedback && npm ci --omit=dev
sudo cp feedback.env.example /etc/jsmessenger-feedback.env && sudo chmod 600 /etc/jsmessenger-feedback.env
sudo nano /etc/jsmessenger-feedback.env        # пароль админки, почта, SMTP
sudo cp jsmessenger-feedback.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jsmessenger-feedback
# в конфиг nginx сайта — блоки из nginx.locations.conf, затем:
sudo nginx -t && sudo systemctl reload nginx
```

Обновление: `git -C /opt/jsmessenger pull && sudo systemctl restart jsmessenger-feedback`.
