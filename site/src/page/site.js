// The home's only script. The page is whole without it: with it, blocks and phones enter as they
// come into view, a recording plays while it is on screen and stops when it leaves or when it is
// pressed, Enter sends the box, and Copy link copies. Nothing is sent anywhere and nothing is
// remembered.
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (x) {
          if (x.isIntersecting) {
            x.target.classList.add("in");
            io.unobserve(x.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("in");
    });
  }

  // A recording plays only while it is on screen, never under reduced motion (its poster stays), and
  // never again by itself once a person has stopped it: a press on a recording, or on its block's
  // button, stops it and starts it (WCAG 2.2.2), and what they chose holds while they scroll. The
  // two phones of a pair stop and start together.
  var clips = document.querySelectorAll("video.rec");
  var start = function (v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  };
  document.querySelectorAll(".block").forEach(function (block) {
    var group = Array.prototype.slice.call(block.querySelectorAll("video.rec"));
    if (!group.length) return;
    var button = block.querySelector(".rec-toggle");
    var playing = function () {
      return group.some(function (v) {
        return !v.paused;
      });
    };
    var toggle = function () {
      var stop = playing();
      group.forEach(function (v) {
        if (stop) {
          v.setAttribute("data-held", "");
          v.pause();
        } else {
          v.removeAttribute("data-held");
          start(v);
        }
      });
    };
    var show = function () {
      if (button) button.classList.toggle("playing", playing());
    };
    group.forEach(function (v) {
      v.addEventListener("click", toggle);
      v.addEventListener("play", show);
      v.addEventListener("pause", show);
    });
    if (!button) return;
    button.addEventListener("click", toggle);
    button.hidden = false;
    show();
  });
  if (clips.length && !reduce && "IntersectionObserver" in window) {
    var vio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (x) {
          var v = x.target;
          if (!x.isIntersecting) v.pause();
          else if (!v.hasAttribute("data-held")) start(v);
        });
      },
      { threshold: 0.4 },
    );
    clips.forEach(function (v) {
      vio.observe(v);
    });
  }

  // What is typed here is sent as a link that tells the app it came from this site, and nothing more
  // than that (`referrerpolicy="origin"`; every other link on the site says nothing). The app starts
  // making the app at once only for a visit it can see came from here (#53); a plain form post
  // carries no such word, so without this script the app fills its box and waits for a press.
  var form = document.querySelector("form.prompt");
  if (form) {
    form.addEventListener("submit", function (e) {
      var words = form.elements["new"] && form.elements["new"].value.trim();
      if (!words) return;
      e.preventDefault();
      var go = document.createElement("a");
      go.referrerPolicy = "origin";
      go.href = form.action + (form.action.indexOf("?") < 0 ? "?" : "&") + "new=" + encodeURIComponent(words);
      form.appendChild(go);
      go.click();
    });
  }

  // The box sends on Enter; Shift+Enter is a new line, as the Studio's own box behaves.
  var box = document.querySelector(".prompt-box");
  if (box && box.form) {
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (box.value.trim()) box.form.requestSubmit ? box.form.requestSubmit() : box.form.submit();
      }
    });
  }

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy") || "";
      var done = function () {
        var was = button.textContent;
        button.textContent = button.getAttribute("data-copied") || "Copied";
        setTimeout(function () {
          button.textContent = was;
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
})();
