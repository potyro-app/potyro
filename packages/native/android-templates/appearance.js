// Tell the Android app which theme the shell is SHOWING, at once and whenever it changes.
//
// Run in the page by AppearancePlugin.java after every page load (scripts/patch-android.mjs writes
// this file into that class as a string). It reads only what the shell already puts on the page:
//   · `data-theme` on <html> — "light" or "dark" when the person chose one, or while an app that has
//     its own theme is open; absent when the phone decides (look.ts, app-theme.ts);
//   · the Look the person chose for Potyro itself, kept in localStorage under `potyro:look`
//     (look.ts; test/appearance.test.ts fails if that key moves).
// and says two things:
//   · `dark` — what is on the screen now. The status and navigation bars are drawn for it.
//   · `look` — the person's own choice for Potyro ("system" when there is none). The app remembers
//     it so the next start's splash wears it. An app's own theme is not a choice for Potyro, so it
//     changes `dark` and never `look`.
// It watches (a MutationObserver on the attribute, the media query's change event); it never polls.
(function () {
  if (window.__potyroAppearanceWatched) return;
  window.__potyroAppearanceWatched = true;

  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var told = "";

  function look() {
    try {
      var kept = JSON.parse(window.localStorage.getItem("potyro:look") || "{}");
      return kept && (kept.appearance === "light" || kept.appearance === "dark") ? kept.appearance : "system";
    } catch (e) {
      return "system";
    }
  }

  function tell() {
    var shown = root.getAttribute("data-theme");
    var dark = shown === "dark" || (shown !== "light" && media.matches);
    var choice = look();
    var now = dark + ":" + choice;
    if (now === told) return;
    var cap = window.Capacitor;
    if (!cap || typeof cap.nativePromise !== "function") return;
    told = now;
    var quiet = function () {};
    // Capacitor's own SystemBars remembers the style and puts it back after a rotation; ours colours
    // the bars where Android still lets an app do that, and remembers the choice for the splash.
    cap.nativePromise("SystemBars", "setStyle", { style: dark ? "DARK" : "LIGHT" }).catch(quiet);
    cap.nativePromise("PotyroAppearance", "show", { dark: dark, look: choice }).catch(quiet);
  }

  // One line in the app's log (Capacitor prints the console), so a start that went wrong can be read.
  console.log("[potyro] appearance: watching; data-theme=" + root.getAttribute("data-theme") + ", phone dark=" + media.matches + ", look=" + look() + ", bridge=" + !!(window.Capacitor && window.Capacitor.nativePromise));

  new MutationObserver(tell).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (media.addEventListener) media.addEventListener("change", tell);
  tell();
})();
