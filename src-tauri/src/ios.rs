//! iPhone: панель над клавиатурой и работа сразу после сворачивания.

use std::sync::atomic::{AtomicUsize, Ordering};

use block2::RcBlock;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};

extern "C-unwind" fn no_accessory(_this: *mut AnyObject, _cmd: Sel) -> *mut AnyObject {
    std::ptr::null_mut()
}

/// Убираем панель «↑ ↓ Готово», которую WKWebView показывает над клавиатурой, —
/// в мессенджере она только съедает место. Подменяем inputAccessoryView у WKContentView на nil.
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

/// UIBackgroundTaskInvalid
const NO_TASK: usize = 0;
static TASK: AtomicUsize = AtomicUsize::new(NO_TASK);

fn app() -> Option<*mut AnyObject> {
    let cls = AnyClass::get(c"UIApplication")?;
    let app: *mut AnyObject = unsafe { msg_send![cls, sharedApplication] };
    (!app.is_null()).then_some(app)
}

fn end_task() {
    let id = TASK.swap(NO_TASK, Ordering::SeqCst);
    if id == NO_TASK {
        return;
    }
    if let Some(app) = app() {
        let _: () = unsafe { msg_send![app, endBackgroundTask: id] };
    }
}

fn observe(name: &std::ffi::CStr, f: fn()) {
    let (Some(center_cls), Some(str_cls)) = (AnyClass::get(c"NSNotificationCenter"), AnyClass::get(c"NSString")) else { return };
    unsafe {
        let center: *mut AnyObject = msg_send![center_cls, defaultCenter];
        let name: *mut AnyObject = msg_send![str_cls, stringWithUTF8String: name.as_ptr()];
        let block = RcBlock::new(move |_note: *mut AnyObject| f());
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _token: *mut AnyObject = msg_send![center, addObserverForName: name, object: nil, queue: nil, usingBlock: &*block];
        // наблюдатель живёт всё время работы приложения
        std::mem::forget(block);
    }
}

/// После сворачивания iOS почти сразу замораживает приложение. Просим у системы фоновое время
/// (обычно до ~30 секунд): успеют прийти сообщения и уведомления о них, отправиться начатое.
pub fn keep_alive_after_background() {
    observe(c"UIApplicationDidEnterBackgroundNotification", || {
        end_task();
        let Some(app) = app() else { return };
        let expire = RcBlock::new(end_task);
        let id: usize = unsafe { msg_send![app, beginBackgroundTaskWithExpirationHandler: &*expire] };
        TASK.store(id, Ordering::SeqCst);
    });
    observe(c"UIApplicationWillEnterForegroundNotification", end_task);
}
