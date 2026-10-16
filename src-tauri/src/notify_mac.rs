//! Системные уведомления macOS через UNUserNotificationCenter — современный механизм,
//! который работает и у приложений без подписи Apple (в отличие от устаревшего
//! NSUserNotification, на котором построен плагин уведомлений Tauri).
//!
//! Модуль не зависит от Tauri: связь с приложением — через колбэк `set_click_handler`.

use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

type ClickHandler = Box<dyn Fn(String) + Send + Sync>;
static ON_CLICK: OnceLock<ClickHandler> = OnceLock::new();
static AUTH: Mutex<Option<bool>> = Mutex::new(None);

define_class!(
    // SAFETY: NSObject не требует особой инициализации, Drop не реализуем.
    #[unsafe(super(NSObject))]
    #[thread_kind = AllocAnyThread]
    #[name = "JsMessengerNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// Показывать баннер, даже когда приложение на переднем плане.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        /// Клик по уведомлению: в threadIdentifier лежит ID комнаты.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let room_id = response.notification().request().content().threadIdentifier().to_string();
            if let Some(cb) = ON_CLICK.get() {
                cb(room_id);
            }
            handler.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        // SAFETY: обычный init у NSObject.
        unsafe { msg_send![super(this), init] }
    }
}

/// Работает только в собранном .app: без идентификатора бандла центр уведомлений падает.
pub fn available() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

/// Вызывается один раз при запуске: делегат, клики и запрос разрешения.
pub fn init(on_click: impl Fn(String) + Send + Sync + 'static) {
    if !available() {
        return;
    }
    let _ = ON_CLICK.set(Box::new(on_click));
    let center = UNUserNotificationCenter::currentNotificationCenter();

    // Центр держит делегата слабой ссылкой — делаем его «вечным».
    let delegate = Delegate::new();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    std::mem::forget(delegate);

    let done = RcBlock::new(|granted: Bool, _err: *mut NSError| {
        if let Ok(mut a) = AUTH.lock() {
            *a = Some(granted.as_bool());
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
}

/// Результат запроса разрешения: None — ещё не ответили.
pub fn authorized() -> Option<bool> {
    AUTH.lock().ok().and_then(|a| *a)
}

/// Показать уведомление. Уведомления одной комнаты группируются в Центре уведомлений.
pub fn show(title: &str, body: &str, room_id: &str) -> Result<(), String> {
    if !available() {
        return Err("уведомления macOS доступны только в собранном приложении".into());
    }
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setThreadIdentifier(&NSString::from_str(room_id));
    content.setSound(Some(&UNNotificationSound::defaultSound()));

    let id = format!(
        "jsm-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    );
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id), &content, None);
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
    Ok(())
}
