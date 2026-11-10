// What the site's prompt box sent (#53): `?new=<words>` opens the Studio on them — and when the
// visit really came from the site's own page, starts making the app at once.
//
// The words in an address are whoever made the link's, not the person's. Making an app from them
// unasked would spend the person's allowance and run what a model wrote from a stranger's sentence
// as the person's own app. So a bare link only ever fills the box. The one case that starts by
// itself is the person having typed the words (or tapped a suggestion) on the site a moment ago,
// and the only thing that proves it is the browser's own account of where the visit came from:
// `document.referrer`, which a page cannot forge for another origin. The site sends its origin on
// exactly these links and nowhere else (site/src/home.mjs, site/src/page/site.js); with no
// referrer — scripts off there, a privacy setting, a link from anywhere else — the box is filled
// and the person presses the button.

export interface NewFromUrl {
  /** The words to put in the box, trimmed; empty for a bare `?new=`. */
  text: string;
  /** Start making the app without another press. */
  start: boolean;
}

/** Read `?new=` from a query string. `referrer` is `document.referrer`; `site` is the site's address. */
export function readNewFromUrl(search: string, referrer: string, site: string): NewFromUrl | null {
  const raw = new URLSearchParams(search).get("new");
  if (raw === null) return null;
  const text = raw.trim();
  return { text, start: text.length > 0 && sameOrigin(referrer, site) };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const one = new URL(a);
    return one.protocol !== "null:" && one.origin !== "null" && one.origin === new URL(b).origin;
  } catch {
    return false;
  }
}
