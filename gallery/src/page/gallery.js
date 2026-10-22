// The gallery page's only script (docs/24 §10): the language — the browser's, or the one chosen here —
// the theme, and the category filter. The page is whole without it, in English. It sends nothing
// anywhere; what it remembers (a chosen language or theme) stays in this browser.
(function () {
  "use strict";
  var node = document.getElementById("gallery-data");
  if (!node) return;
  var data = JSON.parse(node.textContent || "{}");
  var LANGS = data.languages || ["en"];
  var root = document.documentElement;

  function load(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* a browser that keeps nothing still shows the page */
    }
  }

  /** The best of Potyro's languages for a tag: exact, then the same language ("pt" → "pt-BR"). */
  function match(tag) {
    if (!tag) return null;
    var lower = String(tag).toLowerCase();
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].toLowerCase() === lower) return LANGS[i];
    var base = lower.split("-")[0];
    for (var j = 0; j < LANGS.length; j++) if (LANGS[j].toLowerCase().split("-")[0] === base) return LANGS[j];
    return null;
  }
  function pickLanguage() {
    var asked = match(new URLSearchParams(location.search).get("lang"));
    if (asked) return asked;
    var saved = match(load("potyro-gallery:lang"));
    if (saved) return saved;
    var device = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < device.length; i++) {
      var m = match(device[i]);
      if (m) return m;
    }
    return "en";
  }

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return k in vars ? vars[k] : m;
    });
  }

  function apply(lang) {
    var s = data.strings[lang] || data.strings.en;
    var said = function (words) {
      return (words && (words[lang] || words.en)) || "";
    };
    var nameOf = function (id) {
      return said(data.apps[id] && data.apps[id].name);
    };
    root.lang = lang;
    document.querySelectorAll("[data-t]").forEach(function (el) {
      var key = el.getAttribute("data-t");
      if (s[key]) el.textContent = s[key];
    });
    document.querySelectorAll("[data-t-content]").forEach(function (el) {
      el.setAttribute("content", s[el.getAttribute("data-t-content")]);
    });
    document.querySelectorAll("[data-app-name]").forEach(function (el) {
      el.textContent = nameOf(el.getAttribute("data-app-name"));
    });
    document.querySelectorAll("[data-app-line]").forEach(function (el) {
      el.textContent = said(data.apps[el.getAttribute("data-app-line")] && data.apps[el.getAttribute("data-app-line")].line);
    });
    document.querySelectorAll("[data-cat-name]").forEach(function (el) {
      el.textContent = said(data.categories[el.getAttribute("data-cat-name")]);
    });
    document.querySelectorAll("[data-label]").forEach(function (el) {
      el.setAttribute("aria-label", fill(s[el.getAttribute("data-label")], { name: nameOf(el.getAttribute("data-name-of")) }));
    });
    document.querySelectorAll("[data-t-alt]").forEach(function (el) {
      el.setAttribute("alt", fill(s[el.getAttribute("data-t-alt")], { name: nameOf(el.getAttribute("data-name-of")) }));
    });
    document.querySelectorAll("[data-mail]").forEach(function (el) {
      el.setAttribute("href", "mailto:" + el.getAttribute("data-mail") + "?subject=" + encodeURIComponent(s.reportSubject));
    });
    themeLabel();
  }

  // Language
  var lang = pickLanguage();
  var select = document.getElementById("lang");
  if (select) {
    select.value = lang;
    select.parentElement.hidden = false;
    select.addEventListener("change", function () {
      save("potyro-gallery:lang", select.value);
      apply(select.value);
    });
  }

  // Theme: the device's, until one is chosen here.
  var themeButton = document.getElementById("theme");
  var dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function current() {
    return root.getAttribute("data-theme") || (dark && dark.matches ? "dark" : "light");
  }
  function themeLabel() {
    if (!themeButton) return;
    var s = data.strings[root.lang] || data.strings.en;
    var isDark = current() === "dark";
    themeButton.setAttribute("aria-label", isDark ? s.toLight : s.toDark);
    themeButton.setAttribute("aria-pressed", isDark ? "true" : "false");
  }
  var savedTheme = load("potyro-gallery:theme");
  if (savedTheme === "dark" || savedTheme === "light") root.setAttribute("data-theme", savedTheme);
  if (themeButton) {
    themeButton.hidden = false;
    themeButton.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      save("potyro-gallery:theme", next);
      themeLabel();
    });
  }
  if (dark && dark.addEventListener) dark.addEventListener("change", themeLabel);

  // Categories
  var filters = document.querySelector(".filters");
  if (filters) {
    filters.hidden = false;
    filters.addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest("[data-filter]") : null;
      if (!chip) return;
      var want = chip.getAttribute("data-filter");
      filters.querySelectorAll("[data-filter]").forEach(function (c) {
        c.setAttribute("aria-pressed", c === chip ? "true" : "false");
      });
      document.querySelectorAll(".card").forEach(function (card) {
        card.hidden = Boolean(want) && card.getAttribute("data-category") !== want;
      });
    });
  }

  // The prompt box: Enter sends, Shift+Enter is a new line — as the Studio's own box behaves.
  var prompt = document.querySelector(".prompt-box");
  if (prompt && prompt.form) {
    prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (prompt.value.trim()) prompt.form.requestSubmit ? prompt.form.requestSubmit() : prompt.form.submit();
      }
    });
  }

  apply(lang);
})();
