// The home's only script. The page is whole without it: with it, blocks and phones enter as they
// come into view, a recording plays while it is on screen and stops when it leaves, Enter sends the
// box, and Copy link copies. Nothing is sent anywhere and nothing is remembered.
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

  // A recording plays only while it is on screen, never under reduced motion (its poster stays).
  var clips = document.querySelectorAll("video.rec");
  if (clips.length && !reduce && "IntersectionObserver" in window) {
    var vio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (x) {
          var v = x.target;
          if (x.isIntersecting) {
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
          } else v.pause();
        });
      },
      { threshold: 0.4 },
    );
    clips.forEach(function (v) {
      vio.observe(v);
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
        button.textContent = "Copied";
        setTimeout(function () {
          button.textContent = was;
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
})();
