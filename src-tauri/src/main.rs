// Не открывать консольное окно на Windows в релизе
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jsmessenger_lib::run()
}
