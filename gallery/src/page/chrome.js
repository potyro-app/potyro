// The script every page of the site shares (the gallery and the home each add their own after it):
// the language (the browser's, or the one chosen here) and the theme. A page is whole without it,
// in English. It sends nothing anywhere; what it remembers (a chosen language or theme) stays in
// this browser, under one pair of keys for the whole site, so a choice made on one page holds on the next.
(function () {
  "use strict";
  var node = document.getElementById("page-data");
  var data = node ? JSON.parse(node.textContent || "{}") : {};
  var LANGS = data.languages || ["en"];
  var STRINGS = data.strings || { en: {} };
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
    var s = STRINGS[lang] || STRINGS.en;
    var apps = data.apps || {};
    var said = function (words) {
      return (words && (words[lang] || words.en)) || "";
    };
    var nameOf = function (id) {
      return said(apps[id] && apps[id].name);
    };
    /** What a sentence may name: the app the element is about, a number the page wrote down. */
    var varsOf = function (el) {
      return { name: nameOf(el.getAttribute("data-name-of")), count: el.getAttribute("data-count") || "" };
    };
    root.lang = lang;
    document.querySelectorAll("[data-t]").forEach(function (el) {
      var key = el.getAttribute("data-t");
      if (!s[key]) return;
      el.textContent = fill(s[key], varsOf(el));
    });
    document.querySelectorAll("[data-t-content]").forEach(function (el) {
      el.setAttribute("content", s[el.getAttribute("data-t-content")]);
    });
    // `data-t-attr="placeholder:promptPlaceholder aria-label:promptSend"`: attributes that are words.
    document.querySelectorAll("[data-t-attr]").forEach(function (el) {
      el.getAttribute("data-t-attr").split(/\s+/).forEach(function (pair) {
        var at = pair.indexOf(":");
        var key = pair.slice(at + 1);
        if (at > 0 && s[key]) el.setAttribute(pair.slice(0, at), fill(s[key], varsOf(el)));
      });
    });
    document.querySelectorAll("[data-app-name]").forEach(function (el) {
      el.textContent = nameOf(el.getAttribute("data-app-name"));
    });
    document.querySelectorAll("[data-app-line]").forEach(function (el) {
      el.textContent = said(apps[el.getAttribute("data-app-line")] && apps[el.getAttribute("data-app-line")].line);
    });
    document.querySelectorAll("[data-cat-name]").forEach(function (el) {
      el.textContent = said((data.categories || {})[el.getAttribute("data-cat-name")]);
    });
    document.querySelectorAll("[data-label]").forEach(function (el) {
      el.setAttribute("aria-label", fill(s[el.getAttribute("data-label")], varsOf(el)));
    });
    document.querySelectorAll("[data-t-alt]").forEach(function (el) {
      el.setAttribute("alt", fill(s[el.getAttribute("data-t-alt")], varsOf(el)));
    });
    document.querySelectorAll("[data-mail]").forEach(function (el) {
      el.setAttribute("href", "mailto:" + el.getAttribute("data-mail") + "?subject=" + encodeURIComponent(s.reportSubject));
    });
    // An example to start from carries its own words to the app, in the language they are read in.
    document.querySelectorAll("[data-new]").forEach(function (el) {
      el.setAttribute("href", el.getAttribute("data-new") + "?new=" + encodeURIComponent(el.textContent.trim()));
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
    var s = STRINGS[root.lang] || STRINGS.en;
    var isDark = current() === "dark";
    if (s.toLight && s.toDark) themeButton.setAttribute("aria-label", isDark ? s.toLight : s.toDark);
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

  apply(lang);
})();
