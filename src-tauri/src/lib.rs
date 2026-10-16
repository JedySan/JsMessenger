#[cfg(target_os = "macos")]
mod notify_mac;

#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![native_notify, native_notify_status])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                // Клик по уведомлению: показать окно и открыть нужный чат
                notify_mac::init(move |room_id| {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = handle.emit("notification-click", room_id);
                });
            }
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ошибка запуска JsMessenger");
}
