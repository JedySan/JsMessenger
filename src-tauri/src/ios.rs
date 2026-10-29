//! iPhone: убираем панель «↑ ↓ Готово», которую WKWebView показывает над клавиатурой —
//! в мессенджере она только съедает место. Подменяем inputAccessoryView у WKContentView на nil.

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};

extern "C-unwind" fn no_accessory(_this: *mut AnyObject, _cmd: Sel) -> *mut AnyObject {
    std::ptr::null_mut()
}

pub fn hide_keyboard_bar() {
    let Some(cls) = AnyClass::get(c"WKContentView") else { return };
    unsafe {
        let imp: Imp = std::mem::transmute::<extern "C-unwind" fn(*mut AnyObject, Sel) -> *mut AnyObject, Imp>(no_accessory);
        objc2::ffi::class_replaceMethod(
            cls as *const AnyClass as *mut AnyClass,
            objc2::sel!(inputAccessoryView),
            imp,
            c"@@:".as_ptr(),
        );
    }
}
