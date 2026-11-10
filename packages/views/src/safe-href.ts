// Where a link built from DATA may lead.
//
// A record's value, a page a model cited, an address a server answered with: none of it is the
// person's own typing by the time it is rendered, and records arrive from other people through a
// shared space. Put into `href` as it is, a `javascript:` or `data:` address becomes something that
// runs or opens in the page that holds the person's apps. So a link is only ever made for an
// address that goes OUT: the web, or a mail program. Anything else is shown as the text it is.

const OUTWARD = new Set(["http:", "https:", "mailto:"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** `example.com/page`, typed without the scheme: a host with a dot, nothing that needs guessing. */
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i;

/** The address to put in `href`, or `null` when no link may be made from this value. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Read the address the way a browser does: tabs and line breaks are dropped wherever they are
  // (`java\nscript:`), and control characters and spaces around it are ignored.
  const text = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (!text) return null;
  const candidate = HAS_SCHEME.test(text) ? text : BARE_HOST.test(text) ? `https://${text}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return OUTWARD.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
