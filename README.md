# JsMessenger

Настольный клиент [Matrix](https://matrix.org) для macOS и Linux со сквозным шифрованием и звонками через
[LiveKit](https://livekit.io) (MatrixRTC). Совместим с Element, Element X и Element Call: можно переписываться
и созваниваться вперемешку.

> Ранняя версия. macOS 13+ (Apple Silicon и Intel) и Linux x86-64 (Ubuntu 22.04+, Debian 12+ и другие
> через AppImage). Сборки для macOS пока не подписаны сертификатом Apple.

## Возможности

**Переписка**
- Вход по логину и паролю на любой Matrix-сервер, сервер находится через `.well-known`
- Сквозное шифрование (Rust-криптография matrix-sdk-crypto в WebAssembly), в том числе вложений
- Подтверждение сеанса сверкой эмодзи с другим устройством или ключом восстановления, список сеансов
- Ответы, треды, реакции, правка и удаление, закреплённые сообщения, Markdown, «печатает…»
- Файлы и скриншоты: скрепка, ⌘V, перетаскивание; просмотр картинок, видео и аудио
- Поиск по чату и по всем чатам (для зашифрованных — среди загруженной истории)

**Комнаты и пространства**
- Колонка пространств, каталог комнат пространства, вложенные пространства
- Создание комнат, пространств и личных чатов, поиск по каталогу пользователей сервера, приглашения
- Участники и роли, модерация, настройки комнаты, избранное, «без звука»

**Звонки**
- Аудио- и видеозвонки и демонстрация экрана через LiveKit по MatrixRTC
- Шифрование звонков в зашифрованных комнатах (ключи участников передаются через Matrix)
- Входящие звонки: карточка вызова с мелодией, «Принять» / «С видео» / «Отклонить»; звонящий слышит гудки
  и видит «отклонил» или «не ответил» (MSC4075 / MSC4310, совместимо с Element и Element X)

**macOS**
- Нативные уведомления (UNUserNotificationCenter) с переходом в чат по клику, счётчик в Dock
- Работа в фоне: крестик прячет окно, клик по иконке в Dock возвращает его, ⌘Q — полный выход;
  App Nap отключён, чтобы сообщения приходили без задержек
- Автозапуск при входе в систему (без окна) — включается при первом запуске, переключается в меню «⋯»
- Автообновление с проверкой подписи: проверка при запуске и каждые 6 часов, установка в один клик
- Окно без заголовка, светлая и тёмная тема по системе

## Что нужно на сервере

- Matrix-сервер (проверено на Synapse 1.163)
- Для звонков: [LiveKit](https://github.com/livekit/livekit) и [lk-jwt-service](https://github.com/element-hq/lk-jwt-service).
  Адрес сервиса клиент берёт из `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports`
  (Synapse: `matrix_rtc.transports`) или из `.well-known/matrix/client`:

  ```json
  {
    "m.homeserver": { "base_url": "https://matrix.example.com" },
    "org.matrix.msc4143.rtc_foci": [
      { "type": "livekit", "livekit_service_url": "https://livekit.example.com/livekit/jwt" }
    ]
  }
  ```

## Сборка

Нужны Xcode Command Line Tools, [Rust](https://rustup.rs) и Node.js 20+.

```bash
npm install
npm run tauri dev          # режим разработки
./scripts/build-mac.sh     # универсальная сборка (arm64 + x86_64) и архив для установки → release/
```

В браузере без Tauri: `npm run dev` → http://localhost:1420

### Настройки сборки

| Переменная | Назначение |
|---|---|
| `VITE_DEFAULT_SERVER` | сервер, подставленный в форму входа, например `matrix.example.com` |
| `VITE_LIVEKIT_SERVICE_URL` | запасной адрес lk-jwt-service, если сервер не сообщает его сам |
| `JSM_UPDATE_URL` | откуда приложение берёт обновления (по умолчанию релизы GitHub) |
| `JSM_UPDATER_KEY` | ключ подписи обновлений (по умолчанию `~/.tauri/jsmessenger.key`) |
| `JSM_RELEASE_NOTES` | текст «что нового» в окне обновления |

```bash
VITE_DEFAULT_SERVER=matrix.example.com ./scripts/build-mac.sh
```

### Автообновление

Обновления подписываются своим ключом (это не сертификат Apple), приложение ставит только подписанные им.

1. Один раз создайте ключ: `./scripts/updater-keygen.sh` → `~/.tauri/jsmessenger.key`.
   Сделайте резервную копию: без ключа нельзя выпустить обновление для уже установленных копий.
2. Соберите: `./scripts/build-mac.sh`. Если ключ на месте, в сборку вшиваются открытый ключ и адрес
   проверки, а в `release/update-<версия>/` появятся `JsMessenger_<версия>_universal.app.tar.gz` и `latest.json`.
3. Выложите оба файла туда, где их найдёт приложение:
   - **GitHub Releases** (по умолчанию, только для публичного репозитория):
     `./scripts/build-mac.sh --publish` создаст релиз через `gh`;
   - **свой сервер**: `JSM_UPDATE_URL=https://downloads.example.com/jsmessenger ./scripts/build-mac.sh`
     и скопируйте файлы в эту папку (nginx отдаёт их как статику).

Описание изменений для окна обновления: `JSM_RELEASE_NOTES="Что нового" ./scripts/build-mac.sh`.
Сборка без ключа работает как раньше, просто без автообновления.

### Установка неподписанной сборки

В `release/JsMessenger-<версия>-macOS.zip` лежат DMG, установщик `Установить JsMessenger.command`
(копирует приложение в «Программы» и снимает карантин macOS) и инструкция.
Когда появится сертификат Developer ID, укажите его в `bundle.macOS.signingIdentity`
в `src-tauri/tauri.conf.json` или в переменной `APPLE_SIGNING_IDENTITY`.

## Linux

Linux-версия — тот же интерфейс в оболочке Electron (Chromium): звонки, демонстрация экрана и шифрование
звонков работают внутри приложения. Пакеты собирает GitHub Actions (`.github/workflows/linux.yml`), когда
`./scripts/build-mac.sh --publish` создаёт релиз, и прикладывает их к нему:

- `JsMessenger-<версия>-amd64.deb` — Ubuntu и Debian: `sudo apt install ./JsMessenger-<версия>-amd64.deb`;
- `JsMessenger-<версия>-x86_64.AppImage` — остальные дистрибутивы: `chmod +x` и запустить
  (на Ubuntu 24.04 удобнее `.deb`: AppImage там требует `libfuse2` и настройки AppArmor).

Значок в трее (меню «Открыть / Выйти»), крестик прячет окно, повторный запуск показывает его.
Автозапуск — `~/.config/autostart`. Автообновление — `electron-updater` по `latest-linux.yml` из релиза:
AppImage обновляется сам, для `.deb` система спросит пароль администратора.

Собрать локально (на Linux): `npm run linux` → `release/linux/`. Запуск интерфейса в Electron
при разработке: `npm run dev` и в соседнем терминале `npm run electron:dev`.

## Устройство

| | |
|---|---|
| Оболочка | macOS: Tauri 2 (Rust), системный WebKit; Linux: Electron |
| Интерфейс | React 19, TypeScript, Vite |
| Matrix | matrix-js-sdk + matrix-sdk-crypto (WASM) |
| Звонки | livekit-client + MatrixRTC |

```
src/matrix.ts          вход, сессия, шифрование, ключ восстановления
src/rooms.ts           пространства, личные чаты, создание, теги, роли
src/call.ts            звонки MatrixRTC + LiveKit, ожидание ответа
src/incoming.ts        входящие звонки; src/ringtone.ts — мелодия и гудки (WebAudio)
src/attachments.ts     шифрование и загрузка вложений
src/verification.ts    подтверждение сеансов
src/notifications.ts   уведомления, счётчик в Dock
src/desktop.ts         автообновление, автозапуск, выход
src/platform.ts        Tauri / Electron / браузер — общий слой
src/components/        интерфейс
src-tauri/             оболочка: работа в фоне, App Nap, плагины; src/notify_mac.rs — уведомления
electron/              Linux-оболочка: main.cjs (окно, трей, уведомления, обновления), preload.cjs
scripts/               сборка и выпуск обновлений, ключ подписи, файл лицензий
```

## Планы

- Хранение входа в Связке ключей macOS
- Голосовые сообщения, профиль, сборка для Windows (на той же Electron-оболочке)

## Лицензия

[GNU AGPL-3.0-or-later](LICENSE). Тексты лицензий сторонних компонентов генерируются при сборке
(`npm run licenses`) и доступны в приложении: «О программе → Лицензии сторонних компонентов».

Matrix и Element — товарные знаки их владельцев. JsMessenger — независимый проект и не связан с
The Matrix.org Foundation или Element.
