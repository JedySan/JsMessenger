// JsMessenger — сайт-переписка: язык, система посетителя, установщики из последнего релиза GitHub,
// вопросы и ответы. Без JavaScript страница остаётся читаемой (тексты в разметке).
(() => {
  const REPO = "JedySan/JsMessenger";
  const RELEASES = `https://github.com/${REPO}/releases/latest`;
  document.documentElement.classList.add("js");

  // ---------- язык ----------
  const EN = {
    "head.sub": "A Matrix messenger with calls",
    "head.source": "Source code",
    day: "Today",
    "m.hello":
      "Hi! I'm JsMessenger, a free Matrix client. Your chats are encrypted right on your device, calls and screen sharing go through your own LiveKit, and I get along fine with Element and Element X.",
    "m.yours": "Here's the installer for your system:",
    "m.pick": "Pick your system:",
    "m.others": "And these are for the others:",
    "m.ios": "There's no iPhone version yet — Element X will do, it works with the same server.",
    "ask.hint": "Ask me:",
    "q.features": "What can you do?",
    "q.install": "How do I install it?",
    "q.free": "Is it free?",
    "q.server": "What server do I need?",
    "a.features.1": "In short:",
    "a.features.2": "direct chats, groups and spaces, threads, pinned messages;",
    "a.features.3": "voice and video calls, full-screen screen sharing and a mini call window on top of other apps;",
    "a.features.4": "files and screenshots, voice messages, polls, reactions, replies, forwarding, search across messages and people;",
    "a.features.5": "read receipts, notifications and running in the background;",
    "a.features.6": "I update myself and speak Russian and English.",
    "a.free":
      "Yes. I'm free software under the AGPL-3.0 license: the source code is open, you can read it, build it yourself and improve it.",
    "a.free.link": "github.com/JedySan/JsMessenger",
    "a.server.1": "Any Matrix server — Synapse, for example. For calls it needs LiveKit and lk-jwt-service.",
    "a.server.2":
      "If your server already works with Element Call or Element X, there's nothing to set up for me: I'll find the LiveKit address myself.",
    "head.server": "Your server",
    "a.server.3": "No server of your own yet? I'll install Matrix, calls and Jitsi with one command:",
    "a.server.link": "Your own server in 10 minutes →",
    you: "You",
    typing: "JsMessenger is typing…",
    download: "Download",
    "ask.done": "That's all I know for now. Everything else is on GitHub.",
    "install.mine": "On your system:",
    "install.other": "Other systems",
    mb: "MB",
  };
  const RU = {
    you: "Вы",
    typing: "JsMessenger печатает…",
    download: "Скачать",
    "m.pick": "Выберите свою систему:",
    "ask.done": "Пока это всё, что я знаю. Остальное — на GitHub.",
    "install.mine": "Для вашей системы:",
    "install.other": "Другие системы",
    mb: "МБ",
  };

  let lang;
  try {
    lang = localStorage.getItem("jsm.site.lang");
  } catch {
    /* без хранилища — по языку браузера */
  }
  if (lang !== "ru" && lang !== "en") lang = /^(ru|be|uk|kk)\b/i.test(navigator.language || "") ? "ru" : "en";
  const t = (key) => (lang === "en" ? EN[key] : RU[key]) ?? key;

  function translate(root) {
    if (lang !== "en") return;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = EN[el.getAttribute("data-i18n")];
      if (v) el.textContent = v;
    });
  }
  document.documentElement.lang = lang;
  if (lang === "en") document.title = "JsMessenger — a Matrix messenger with calls";
  translate(document);
  const langBtn = document.getElementById("lang");
  langBtn.textContent = lang === "en" ? "RU" : "EN";
  langBtn.addEventListener("click", () => {
    try {
      localStorage.setItem("jsm.site.lang", lang === "en" ? "ru" : "en");
      sessionStorage.setItem("jsm.site.seen", "1"); // после смены языка переписку не проигрываем заново
    } catch {
      /* не страшно */
    }
    location.reload();
  });

  // ---------- система посетителя и установщики ----------
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : /Mac/i.test(ua)
        ? "mac"
        : /Win/i.test(ua)
          ? "win"
          : /Linux|X11/i.test(ua)
            ? "linux"
            : null;

  const FILES = [
    { key: "mac", os: "macOS", ext: "ZIP", re: /-macOS\.zip$/, name: "JsMessenger-macOS.zip", for: "mac" },
    { key: "win", os: "Windows", ext: "EXE", re: /-Setup\.exe$/, name: "JsMessenger-Setup.exe", for: "win" },
    { key: "deb", os: "Ubuntu, Debian", ext: "DEB", re: /\.deb$/, name: "JsMessenger-amd64.deb", for: "linux" },
    { key: "apk", os: "Android", ext: "APK", re: /\.apk$/, name: "JsMessenger.apk", for: "android" },
    { key: "appimage", os: "Linux", ext: "APP", re: /\.AppImage$/, name: "JsMessenger-x86_64.AppImage", for: null },
  ];
  const assets = {}; // key → { url, name, size }

  function fileEl(f, main) {
    const a = document.createElement("a");
    a.className = "file" + (main ? " main" : "") + (assets[f.key] ? "" : " loading");
    a.href = assets[f.key]?.url ?? RELEASES;
    a.dataset.key = f.key;
    const size = assets[f.key] ? `, ${Math.round(assets[f.key].size / 1048576)} ${t("mb")}` : "";
    a.innerHTML = `<span class="file-ext"></span><span class="file-text"><span class="file-os"></span><span class="file-name"></span><span class="file-size"></span></span><span class="file-get"></span>`;
    a.querySelector(".file-ext").textContent = f.ext;
    a.querySelector(".file-os").textContent = f.os;
    a.querySelector(".file-name").textContent = (assets[f.key]?.name ?? f.name) + size;
    a.querySelector(".file-size").textContent = size ? size.slice(2) : f.ext.toLowerCase();
    a.querySelector(".file-get").textContent = t("download");
    return a;
  }

  function renderFiles() {
    const mine = FILES.find((f) => f.for === os);
    const main = document.getElementById("file-main");
    const others = document.getElementById("file-others");
    main.replaceChildren();
    others.replaceChildren();
    if (mine) {
      main.append(fileEl(mine, true));
      FILES.filter((f) => f !== mine).forEach((f) => others.append(fileEl(f, false)));
    } else {
      // iPhone или неизвестная система: все установщики сразу, без «остальных»
      document.getElementById("yours-text").textContent = t("m.pick");
      FILES.forEach((f) => main.append(fileEl(f, false)));
      others.closest(".msg").querySelector("[data-i18n='m.others']").remove();
    }
  }

  async function loadRelease() {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return;
      const r = await res.json();
      for (const a of r.assets ?? [])
        for (const f of FILES) if (f.re.test(a.name)) assets[f.key] = { url: a.browser_download_url, name: a.name, size: a.size };
      renderFiles();
    } catch {
      /* ссылки ведут на страницу релизов — тоже работает */
    }
  }

  // ---------- переписка ----------
  const timeline = document.getElementById("timeline");
  const now = new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll(".time").forEach((el) => (el.textContent = now));
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, calm ? 0 : ms));

  function typingEl() {
    const el = document.createElement("div");
    el.className = "msg grouped";
    el.innerHTML = `<div class="msg-main"><p class="typing"><span class="dots"><i></i><i></i><i></i></span><span></span></p></div>`;
    el.querySelector(".typing span:last-child").textContent = t("typing");
    return el;
  }
  const scroll = (el) => el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });

  async function intro() {
    const steps = [...document.querySelectorAll(".msg[data-step]")];
    let seen = false;
    try {
      seen = sessionStorage.getItem("jsm.site.seen") === "1";
      sessionStorage.setItem("jsm.site.seen", "1");
    } catch {
      /* без хранилища — проигрываем */
    }
    if (seen || calm) return;
    steps.forEach((s) => s.classList.add("pending"));
    const typing = typingEl();
    timeline.append(typing);
    for (const [i, s] of steps.entries()) {
      await wait(i === 0 ? 900 : 650);
      s.classList.remove("pending");
      s.classList.add("arrive");
      timeline.append(typing);
    }
    typing.remove();
  }

  // вопросы
  const asked = new Set();
  let busy = false;
  document.getElementById("asks").addEventListener("click", async (e) => {
    const btn = e.target.closest(".ask");
    if (!btn || busy || asked.has(btn.dataset.q)) return;
    busy = true;
    asked.add(btn.dataset.q);
    btn.disabled = true;

    const q = document.createElement("article");
    q.className = "msg mine arrive";
    q.innerHTML = `<span class="ava you"></span><div class="msg-main"><p class="who"><span></span><time class="time"></time></p><p><span class="q"></span><span class="ticks" aria-hidden="true"></span></p></div>`;
    q.querySelector(".ava").textContent = t("you").slice(0, 1);
    q.querySelector(".who span").textContent = t("you");
    q.querySelector(".time").textContent = now;
    q.querySelector(".q").textContent = btn.textContent;
    timeline.append(q);
    scroll(q);

    const typing = typingEl();
    await wait(450);
    timeline.append(typing);
    scroll(typing);
    await wait(900);
    typing.remove();

    const a = document.createElement("article");
    a.className = "msg arrive";
    a.innerHTML = `<img class="ava" src="icon.png" alt="" width="36" height="36" /><div class="msg-main"><p class="who">JsMessenger <time class="time"></time></p></div>`;
    a.querySelector(".time").textContent = now;
    const body = a.querySelector(".msg-main");
    body.append(document.querySelector(`template[data-a="${btn.dataset.q}"]`).content.cloneNode(true));
    translate(body);
    if (btn.dataset.q === "install") fillSteps(body.querySelector(".steps"));
    timeline.append(a);
    scroll(a);

    if (asked.size === document.querySelectorAll(".ask").length) {
      const done = document.createElement("p");
      done.className = "ask-all";
      done.textContent = t("ask.done");
      document.getElementById("asks").replaceWith(done);
    }
    busy = false;
  });

  // шаги установки: своя система — сразу, остальные — свёрнуты
  const STEPS = {
    mac: {
      title: "macOS",
      ru: [
        "Распакуйте архив и дважды щёлкните «Установить JsMessenger.command».",
        "Если macOS не даёт открыть файл, нажмите на нём правой кнопкой и выберите «Открыть».",
        "Я окажусь в «Программах», а дальше буду обновляться сам.",
      ],
      en: [
        "Unzip the archive and double-click “Установить JsMessenger.command” (Install JsMessenger).",
        "If macOS won't open it, right-click the file and choose Open.",
        "I'll end up in Applications and will update myself from then on.",
      ],
    },
    win: {
      title: "Windows",
      ru: [
        "Запустите установщик: права администратора не нужны.",
        "Если появится «Windows защитила ваш компьютер», нажмите «Подробнее» и «Выполнить в любом случае».",
        "Я открою себя сам и появлюсь в меню «Пуск».",
      ],
      en: [
        "Run the installer: no administrator rights needed.",
        "If you see “Windows protected your PC”, click More info and then Run anyway.",
        "I'll open on my own and show up in the Start menu.",
      ],
    },
    linux: {
      title: "Linux",
      ru: [
        "Ubuntu и Debian: <code>sudo apt install ./JsMessenger-…-amd64.deb</code>",
        "Другие дистрибутивы: <code>chmod +x</code> для AppImage и запустите его.",
        "Мой значок появится в трее — оттуда возвращается закрытое окно.",
      ],
      en: [
        "Ubuntu and Debian: <code>sudo apt install ./JsMessenger-…-amd64.deb</code>",
        "Other distributions: <code>chmod +x</code> the AppImage and run it.",
        "My icon appears in the tray — a closed window comes back from there.",
      ],
    },
    android: {
      title: "Android",
      ru: [
        "Скачайте APK на телефоне и откройте его из уведомления о загрузке.",
        "Разрешите установку из этого источника, когда Android спросит.",
        "Новые версии я предложу сам.",
      ],
      en: [
        "Download the APK on your phone and open it from the download notification.",
        "Allow installs from this source when Android asks.",
        "I'll offer new versions myself.",
      ],
    },
  };
  function fillSteps(box) {
    const block = (key) => {
      const s = STEPS[key];
      return `<ol>${s[lang].map((li) => `<li>${li}</li>`).join("")}</ol>`;
    };
    const order = Object.keys(STEPS);
    let html = "";
    if (STEPS[os]) html += `<p>${t("install.mine")}</p>` + block(os);
    const rest = order.filter((k) => k !== os);
    html += rest.map((k) => `<details><summary>${STEPS[k].title}</summary>${block(k)}</details>`).join("");
    box.innerHTML = html;
  }

  renderFiles();
  intro();
  loadRelease();
})();
