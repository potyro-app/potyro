// Text shared into Potyro from another app (#213) — what another AI made — and where it goes next.
//
// A share arrives while Potyro may be showing anything, so it is kept for this session, offered on the
// "Bring this into" page, and handed to the app the person picks, whose Ask opens with it filled in.
// sessionStorage, not localStorage: a share is something in hand, not something to keep.
//
// Which app fits best is judged here, on the device, with no model: the words of the shared text
// against each app's own words — its entity and field names, labels and options, read from its
// source. The person picks either way; this only orders the list.

const SHARE = "potyro:pending-share";
const HANDED = "potyro:ask-material";
const LABEL = "what you shared";

export interface Share {
  title?: string;
  text: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) globalThis.sessionStorage?.removeItem(key);
    else globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused: the share is lost with the page, and the person can share it again.
  }
}

export function rememberShare(share: Share): void {
  write(SHARE, share);
}

export function peekShare(): Share | null {
  return read<Share>(SHARE);
}

export function dropShare(): void {
  write(SHARE, null);
}

/** Give the pending share to `appId`'s Ask. */
export function handShareTo(appId: string): void {
  const share = peekShare();
  if (!share) return;
  write(HANDED, { appId, label: LABEL, text: share.text });
  dropShare();
}

/** What was handed to this app, if anything — without using it up (a render may run twice). */
export function peekAskMaterial(appId: string): { label: string; text: string } | null {
  const handed = read<{ appId: string; label: string; text: string }>(HANDED);
  if (!handed || handed.appId !== appId) return null;
  return { label: handed.label, text: handed.text };
}

/** Done with what was handed over: reopening the app does not bring it back. */
export function clearAskMaterial(): void {
  write(HANDED, null);
}

/** What was handed to this app, once. */
export function takeAskMaterial(appId: string): { label: string; text: string } | null {
  const handed = peekAskMaterial(appId);
  if (handed) clearAskMaterial();
  return handed;
}

/** Lower-case words of 3+ letters, with a trailing plural "s" taken off. */
function words(s: string): Set<string> {
  const out = new Set<string>();
  // Split camelCase keys ("repRange" → rep, range) before lower-casing.
  for (const w of s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)) {
    if (w.length < 3) continue;
    out.add(w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return out;
}

/** Words every app's source has, which say nothing about what it is for. */
const COMMON = new Set(["type", "text", "label", "field", "entitie", "entity", "name", "true", "false", "number", "the", "and", "for", "with", "from", "this", "that", "default", "required", "option", "page", "view", "list", "display", "primary", "secondary"]);

/** The words that describe an app's data, from its source: comments and code bodies say little about
 *  what it is for, so only object keys and short string literals count. */
function structureWords(source: string): string {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const keys = [...code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);
  const strings = [...code.matchAll(/"([^"\n]{2,40})"/g)].map((m) => m[1]);
  return [...keys, ...strings].join(" ");
}

/** App ids that fit the text, best first; none when no app shares any of its words. */
export function bestFits(apps: Array<{ id: string; name: string; source: string }>, text: string): string[] {
  const said = words(text);
  const scored = apps.map((app) => {
    const own = words(`${app.name} ${structureWords(app.source)}`);
    let score = 0;
    for (const w of said) if (own.has(w) && !COMMON.has(w)) score += 1;
    return { id: app.id, score };
  });
  return scored.filter((s) => s.score >= 1).sort((a, b) => b.score - a.score).map((s) => s.id);
}
