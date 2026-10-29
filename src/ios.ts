// iPhone (Tauri, WKWebView): то, что Android-WebView делает сам.
//  • без увеличения: iOS приближает страницу при фокусе на поле со шрифтом меньше 16px и не возвращает обратно;
//  • клавиатура: WKWebView не уменьшает страницу под клавиатуру, а сдвигает её — тогда поле ввода
//    уезжает под клавиатуру. Подгоняем высоту приложения под видимую область (visualViewport).
export function setupIOS() {
  const root = document.documentElement;
  root.dataset.platform = "ios";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

  const vv = window.visualViewport;
  if (!vv) return;
  let frame = 0;
  const fit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      // клавиатура открыта — снизу уже не нужен отступ под полоску «домой»
      root.classList.toggle("keyboard", window.innerHeight - vv.height > 120);
      // iOS прокручивает документ, чтобы показать поле ввода, — возвращаем на место
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    });
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  window.addEventListener("scroll", fit);
  fit();
}
