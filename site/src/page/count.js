// The site's one count (#10): that a page was opened. Each page view posts `{"event":"visit"}` to
// `/count` on this same site (the server passes it to Potyro's own counter; nobody else is asked),
// and what is kept is one number a month. Nothing about the visitor is in it: no id, no cookie, no
// referrer, not which page. Nothing is read from this browser and nothing is written to it, so the
// same person opening two pages is two posts; the counter itself takes one a day from an address,
// which it holds in memory, hashed, for that day and no longer (packages/ai-relay/src/counts.ts).
// A browser that asks not to be tracked is not counted at all. The privacy page and the terms load
// no script, so reading them is never counted.
(function () {
  "use strict";
  // Global Privacy Control, or Do Not Track: not counted.
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return;
  // A browser driven by a program is not a visit; a page not served over https (a preview on
  // someone's own machine) has no counter behind it.
  if (navigator.webdriver || location.protocol !== "https:") return;
  try {
    fetch("/count", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"event":"visit"}',
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      keepalive: true,
    }).catch(function () {
      /* not counted: the page is whole without it */
    });
  } catch (e) {
    /* a browser without fetch: not counted */
  }
})();
