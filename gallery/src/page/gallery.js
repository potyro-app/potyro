// The gallery page's own script (docs/24 §10), after the one every page shares (chrome.js: the
// language and the theme): the category filter and the prompt box. The page is whole without it.
(function () {
  "use strict";

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

  // The prompt box sends what was typed to the app (the form's own address) as ?new=. Done here,
  // as a navigation, rather than as the form's submission: the site's policy allows no form
  // action, and a script may still go where the form says. Without the script, the form itself
  // does the same once the policy names the app. Enter sends; Shift+Enter is a new line, as the
  // Studio's own box behaves.
  var prompt = document.querySelector(".prompt-box");
  if (prompt && prompt.form) {
    var send = function () {
      var text = prompt.value.trim();
      if (text) location.assign(prompt.form.action + "?new=" + encodeURIComponent(text));
    };
    prompt.form.addEventListener("submit", function (e) {
      e.preventDefault();
      send();
    });
    prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
  }
})();
