# Code signing policy

Windows builds of JsMessenger are **not code-signed yet**. The CI workflow is prepared for signing
via [SignPath](https://about.signpath.io/); this policy describes how signing will work once it is enabled.

## What is signed

- `JsMessenger.exe` — the application;
- `JsMessenger-<version>-Setup.exe` — the installer.

Only binaries built by GitHub Actions from this repository
([`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)) on a published release tag are submitted for signing.
Nothing built on a developer machine is signed with this certificate.

## Team roles

- Committer and reviewer: [JedySan](https://github.com/JedySan)
- Approver (approves each release signing request): [JedySan](https://github.com/JedySan)

## Privacy

JsMessenger connects only to the Matrix homeserver the user signs in to, to the LiveKit server
announced by that homeserver for calls, and to GitHub Releases to check for updates.
It does not collect analytics or telemetry and does not transfer any other data.

---

# Подпись Windows через SignPath — как включить

> Заявка в SignPath Foundation (29.10.2026) отклонена: фонд берёт проекты с заметной аудиторией
> (звёзды, форки, упоминания). Повторить можно, когда у проекта она появится; либо платная подписка SignPath.

Сборка уже готова: шаги подписи в `desktop.yml` включаются сами, как только в репозитории появятся
переменная и секрет SignPath. Пока их нет — установщик собирается без подписи, как раньше.

## 1. Заявка в SignPath Foundation (бесплатно для open source)

Форма: <https://signpath.org/apply> (на английском). Что указать:

| Поле | Значение |
|---|---|
| Project name | JsMessenger |
| Repository | https://github.com/JedySan/JsMessenger |
| Homepage | https://jsmassenger.ru |
| License | AGPL-3.0-or-later (OSI-approved) |
| Description | Free and open-source Matrix messenger with end-to-end encryption and LiveKit (MatrixRTC) voice/video calls and screen sharing. Desktop app for macOS, Windows and Linux, plus Android. |
| Build system | GitHub Actions (`.github/workflows/desktop.yml`), Electron + electron-builder (NSIS) |
| Artifacts to sign | `JsMessenger.exe` and the NSIS installer `JsMessenger-<version>-Setup.exe` |
| Code signing policy | https://github.com/JedySan/JsMessenger/blob/main/docs/CODE_SIGNING.md |

Требования фонда: открытая лицензия без ограничений на коммерческое использование (AGPL подходит),
публичный репозиторий, сборка на CI, опубликованная политика подписи (этот файл) и упоминание SignPath
на сайте или в README. Рассмотрение обычно занимает от нескольких дней; одобряют не всех.

## 2. После одобрения — настроить проект в SignPath

1. Установить GitHub App **SignPath** на репозиторий `JedySan/JsMessenger` (SignPath проверяет,
   что файлы собраны именно этим репозиторием).
2. В проекте SignPath (slug `JsMessenger`) создать две **Artifact configurations**:

   `app-exe` — программа (GitHub отдаёт артефакт zip-архивом):
   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="JsMessenger.exe">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   `installer` — установщик:
   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="JsMessenger-*-Setup.exe">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```
3. Политика подписи — `release-signing` (её создаёт фонд). Если slug другой — задайте переменную
   `SIGNPATH_POLICY_SLUG`.
4. Создать в SignPath пользователя CI и его **API token**.

## 3. Включить в GitHub

Settings → Secrets and variables → Actions:

- **Variables:** `SIGNPATH_ORGANIZATION_ID` — ID организации из SignPath
  (необязательно: `SIGNPATH_PROJECT_SLUG`, если не `JsMessenger`; `SIGNPATH_POLICY_SLUG`, если не `release-signing`);
- **Secrets:** `SIGNPATH_API_TOKEN` — токен пользователя CI.

Или из терминала:

```bash
gh variable set SIGNPATH_ORGANIZATION_ID --body "<id организации>"
gh secret set SIGNPATH_API_TOKEN --body "<токен>"
```

Со следующего релиза сборка Windows сама отправит программу и установщик на подпись. В политике
`release-signing` каждую подпись нужно подтвердить в SignPath (придёт письмо) — сборка ждёт до 10 минут.
После подписи `latest.yml` пересчитывается (`scripts/win-update-latest.mjs`), так что автообновление
продолжает работать, а шаг «Подпись: проверка» показывает статус подписи в отчёте сборки.
