// Страница «Свой сервер»: та же переписка, что на главной — язык, появление сообщений, вопросы, копирование команд.
(() => {
  document.documentElement.classList.add("js");

  const EN = {
    "head.sub": "Your own Matrix server with calls",
    "head.source": "Source code",
    "head.back": "Back to the app",
    day: "Today",
    "m.hello":
      "Want your chats and calls to live on your own server instead of someone else's? I'll set up everything with a single command — in about ten minutes.",
    "m.inside": "What ends up on the server:",
    "m.inside.1": "<b>Synapse</b> and PostgreSQL — the Matrix server: chats, files, encryption, federation with other servers;",
    "m.inside.2": "<b>LiveKit</b> — calls, video and screen sharing in JsMessenger, Element X and Element Call;",
    "m.inside.3": "<b>Jitsi Meet</b> — video meetings by link, even for people without Matrix;",
    "m.inside.4": "<b>Caddy</b> — HTTPS: it gets and renews Let's Encrypt certificates by itself.",
    "m.need": "You'll need an Ubuntu or Debian server and a domain. Point these A records at the server's IP:",
    "dns.1": "addresses like @name:example.ru",
    "dns.2": "the Matrix server",
    "dns.3": "calls",
    "dns.4": "Jitsi Meet",
    "m.need.note": "2 CPU cores and 2 GB of RAM without Jitsi, 4 GB with it. Ports 80 and 443 must be free.",
    "m.run": "Then it's three lines:",
    "m.run.after":
      "I'll ask for the domain and an email, check DNS and ports, make up the passwords, start everything and create an administrator. At the end I'll check from the outside that HTTPS, Matrix, calls and Jitsi respond.",
    copy: "Copy",
    copied: "Copied",
    "ask.hint": "Ask me:",
    "q.login": "How do I sign in afterwards?",
    "q.manage": "How do I add people?",
    "q.price": "How much is it?",
    "q.help": "Can you set it up for me?",
    "a.login.1":
      "Open JsMessenger, Element or Element X and enter the server <b>example.ru</b> — the one in user addresses. The app will find the calls on its own.",
    "a.login.2": "Jitsi Meet opens at <b>meet.example.ru</b>.",
    "a.login.link": "Download JsMessenger",
    "a.manage.1": "Registration is closed — the administrator adds people:",
    "a.price.1":
      "It's free. The kit is open source under AGPL-3.0: install it on your servers, at a company too. If you change it and let people use it, publish your changes.",
    "a.price.2": "Need closed modifications or to embed it into your product — a commercial license is possible.",
    "a.help.1": "Yes: turnkey installation, migration from another server, setup for your company, support. Write to me and we'll talk.",
    you: "You",
    typing: "JsMessenger is typing…",
    "ask.done": "That's all for now. Questions — by email.",
  };
  const RU = {
    copy: "Скопировать",
    copied: "Скопировано",
    you: "Вы",
    typing: "JsMessenger печатает…",
    "ask.done": "Пока это всё. Остальное — по почте.",
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
    // в этих строках есть <b> — тексты наши, не пользовательские
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const v = EN[el.getAttribute("data-i18n-html")];
      if (v) el.innerHTML = v;
    });
    root.querySelectorAll("[data-i18n-label]").forEach((el) => {
      const v = EN[el.getAttribute("data-i18n-label")];
      if (v) el.setAttribute("aria-label", v);
    });
  }
  document.documentElement.lang = lang;
  if (lang === "en") document.title = "Your own Matrix server with calls — JsMessenger Server";
  translate(document);
  const langBtn = document.getElementById("lang");
  langBtn.textContent = lang === "en" ? "RU" : "EN";
  langBtn.addEventListener("click", () => {
    try {
      localStorage.setItem("jsm.site.lang", lang === "en" ? "ru" : "en");
      sessionStorage.setItem("jsm.server.seen", "1");
    } catch {
      /* не страшно */
    }
    location.reload();
  });

  // ---------- копирование команд ----------
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".code-copy");
    if (!btn) return;
    const text = document.getElementById(btn.dataset.copy)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // старые браузеры: выделим текст, пусть скопируют сами
      const r = document.createRange();
      r.selectNodeContents(document.getElementById(btn.dataset.copy));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return;
    }
    btn.textContent = t("copied");
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = t("copy");
      btn.classList.remove("done");
    }, 1600);
  });

  // ---------- переписка ----------
  const timeline = document.getElementById("timeline");
  const now = new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll(".time").forEach((el) => (el.textContent = now));
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, calm ? 0 : ms));
  const scroll = (el) => el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });

  function typingEl() {
    const el = document.createElement("div");
    el.className = "msg grouped";
    el.innerHTML = `<div class="msg-main"><p class="typing"><span class="dots"><i></i><i></i><i></i></span><span></span></p></div>`;
    el.querySelector(".typing span:last-child").textContent = t("typing");
    return el;
  }

  async function intro() {
    const steps = [...document.querySelectorAll(".msg[data-step]")];
    let seen = false;
    try {
      seen = sessionStorage.getItem("jsm.server.seen") === "1";
      sessionStorage.setItem("jsm.server.seen", "1");
    } catch {
      /* без хранилища — проигрываем */
    }
    if (seen || calm) return;
    steps.forEach((s) => s.classList.add("pending"));
    const typing = typingEl();
    timeline.append(typing);
    for (const [i, s] of steps.entries()) {
      await wait(i === 0 ? 800 : 700);
      s.classList.remove("pending");
      s.classList.add("arrive");
      timeline.append(typing);
    }
    typing.remove();
  }

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
    a.innerHTML = `<img class="ava" src="../icon.png" alt="" width="36" height="36" /><div class="msg-main"><p class="who">JsMessenger <time class="time"></time></p></div>`;
    a.querySelector(".time").textContent = now;
    const body = a.querySelector(".msg-main");
    body.append(document.querySelector(`template[data-a="${btn.dataset.q}"]`).content.cloneNode(true));
    translate(body);
    body.querySelectorAll(".code-copy").forEach((b) => (b.textContent = t("copy")));
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

  document.querySelectorAll(".code-copy").forEach((b) => (b.textContent = t("copy")));
  intro();
})();
