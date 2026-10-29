//! Секреты (токен входа) — в Связке ключей macOS и iOS. На других платформах Tauri хранилища нет:
//! интерфейс получает ошибку и оставляет токен в локальном хранилище, как раньше.

#[cfg(any(target_os = "macos", target_os = "ios"))]
const SERVICE: &str = "io.github.jedysan.jsmessenger";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Прочитать секрет; None — такого нет.
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match entry(&key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = key;
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        entry(&key)?.set_password(&value).map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (key, value);
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = key;
        Err("unsupported".into())
    }
}
