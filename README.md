# JsMessenger

Настольный клиент [Matrix](https://matrix.org) для macOS со сквозным шифрованием и звонками через
[LiveKit](https://livekit.io) (MatrixRTC). Совместим с Element, Element X и Element Call: можно переписываться
и созваниваться вперемешку.

> Ранняя версия, пет-проект. Работает на macOS 13+ (Apple Silicon и Intel). Сборки пока не подписаны
> сертификатом Apple.

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

**macOS**
- Нативные уведомления (UNUserNotificationCenter) с переходом в чат по клику, счётчик в Dock
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

```bash
VITE_DEFAULT_SERVER=matrix.example.com ./scripts/build-mac.sh
```

### Установка неподписанной сборки

В `release/JsMessenger-<версия>-macOS.zip` лежат DMG, установщик `Установить JsMessenger.command`
(копирует приложение в «Программы» и снимает карантин macOS) и инструкция.
Когда появится сертификат Developer ID, укажите его в `bundle.macOS.signingIdentity`
в `src-tauri/tauri.conf.json` или в переменной `APPLE_SIGNING_IDENTITY`.

## Устройство

| | |
|---|---|
| Оболочка | Tauri 2 (Rust), системный WebKit |
| Интерфейс | React 19, TypeScript, Vite |
| Matrix | matrix-js-sdk + matrix-sdk-crypto (WASM) |
| Звонки | livekit-client + MatrixRTC |

```
src/matrix.ts          вход, сессия, шифрование, ключ восстановления
src/rooms.ts           пространства, личные чаты, создание, теги, роли
src/call.ts            звонки MatrixRTC + LiveKit
src/attachments.ts     шифрование и загрузка вложений
src/verification.ts    подтверждение сеансов
src/notifications.ts   уведомления, счётчик в Dock
src/components/        интерфейс
src-tauri/             оболочка macOS; src/notify_mac.rs — нативные уведомления
scripts/               сборка, генерация файла лицензий
```

## Планы

- Автообновление
- Входящие звонки с окном вызова
- Работа в фоне и автозапуск
- Хранение входа в Связке ключей macOS
- Голосовые сообщения, профиль, сборка для Windows

## Лицензия

[GNU AGPL-3.0-or-later](LICENSE). Тексты лицензий сторонних компонентов генерируются при сборке
(`npm run licenses`) и доступны в приложении: «О программе → Лицензии сторонних компонентов».

Matrix и Element — товарные знаки их владельцев. JsMessenger — независимый проект и не связан с
The Matrix.org Foundation или Element.
