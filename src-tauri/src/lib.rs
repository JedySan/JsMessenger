#[cfg(target_os = "macos")]
mod notify_mac;
mod secrets;
#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "macos")]
use tauri::{Emitter, RunEvent};
use tauri::{Manager, WindowEvent};

/// Аргумент, с которым приложение запускается при входе в систему: стартуем без окна.
const HIDDEN_ARG: &str = "--hidden";

/// Системное уведомление. На macOS — через UNUserNotificationCenter;
/// false означает «не получилось», и интерфейс использует запасной плагин.
#[tauri::command]
fn native_notify(title: String, body: String, room_id: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        notify_mac::show(&title, &body, &room_id).is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, body, room_id);
        false
    }
}

/// Состояние для экрана проверки: available — работает ли механизм, authorized — ответ пользователя.
#[tauri::command]
fn native_notify_status() -> (bool, Option<bool>) {
    #[cfg(target_os = "macos")]
    {
        (notify_mac::available(), notify_mac::authorized())
    }
    #[cfg(not(target_os = "macos"))]
    {
        (false, None)
    }
}

/// Включено ли автообновление в этой сборке (задаётся ключом подписи при сборке).
#[tauri::command]
fn updater_enabled(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(desktop)]
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// macOS усыпляет фоновые приложения (App Nap) — тогда сообщения и уведомления приходят с опозданием.
#[cfg(target_os = "macos")]
fn disable_app_nap() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &NSString::from_str("Получение новых сообщений"),
    );
    // активность длится, пока жив токен, — держим его до выхода из приложения
    std::mem::forget(token);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // Плагин обновлений требует ключ в конфигурации; его добавляет scripts/build-mac.sh,
    // если на машине сборки есть ключ подписи. Без ключа обновления просто выключены.
    #[cfg(desktop)]
    let with_updater = context.config().plugins.0.contains_key("updater");

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(
            // на macOS — LaunchAgent в ~/Library/LaunchAgents (вариант по умолчанию)
            tauri_plugin_autostart::Builder::new()
                .args([HIDDEN_ARG])
                .build(),
        );
        if with_updater {
            builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        }
    }

    let app = builder
        .invoke_handler(tauri::generate_handler![
            native_notify,
            native_notify_status,
            updater_enabled,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete
        ])
        .setup(|app| {
            // Окно создаётся скрытым (см. tauri.conf.json); при автозапуске так и оставляем
            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            if !hidden {
                show_main(app.handle());
            }

            #[cfg(target_os = "ios")]
            ios::hide_keyboard_bar();

            #[cfg(target_os = "macos")]
            {
                disable_app_nap();
                let handle = app.handle().clone();
                // Клик по уведомлению: показать окно и открыть нужный чат
                notify_mac::init(move |room_id| {
                    show_main(&handle);
                    let _ = handle.emit("notification-click", room_id);
                });
            }
            Ok(())
        })
        // Крестик прячет окно, приложение продолжает работать и получать сообщения
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(context)
        .expect("ошибка запуска JsMessenger");

    app.run(|handle, event| match event {
        // Клик по иконке в Dock, когда окно спрятано
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                show_main(handle);
            }
        }
        _ => {
            let _ = handle;
        }
    });
}
