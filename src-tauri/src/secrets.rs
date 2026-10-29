//! Секреты (токен входа) — в Связке ключей macOS. На других платформах Tauri хранилища нет:
//! интерфейс получает ошибку и оставляет токен в локальном хранилище, как раньше.

#[cfg(target_os = "macos")]
const SERVICE: &str = "io.github.jedysan.jsmessenger";

#[cfg(target_os = "macos")]
fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Прочитать секрет; None — такого нет.
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        match entry(&key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        entry(&key)?.set_password(&value).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (key, value);
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
        Err("unsupported".into())
    }
}
