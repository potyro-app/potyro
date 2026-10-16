// Links that open an app at one of its pages, with what that page should start from (docs/24 §11).
//
//   <site>/s/<id>#k=<key>&app=<line>&to=<page>&p.<name>=<value>…   a demo link, plus where to land
//   <site>/#try=<package>&app=<line>&to=<page>&p.<name>=<value>…   the same, inline
//   <site>/#app=<line>&to=<page>&p.<name>=<value>…                  no demo: only for someone who has it
//
// All of it in the fragment, which never reaches a server: a game's code is between the two people.
//
// Which app: its LINE, not its id on this device — a friend's copy is `draw-guess-2`, or a remix's
// `draw-guess-remix`. Every copy of an app carries the same line (in its package's manifest); an app
// that arrived without one is known by its declared id (`id:draw-guess`), which is what the examples
// and every package built from `apps/` are. An app made here, a duplicate and a remix get a line of
// their own: they are other apps from then on. A remix remembers the line it came from (`lineOf`), and
// is opened by a link to that app when it is the only copy there is.
//
// A line is a matching hint, never a credential: any package can say any line. What a link can do is
// small on purpose — open a page and hand it the text its `link.params` declare — so a wrong match
// shows the wrong app, and nothing runs.
import { LINK_LIMITS, LINK_PARAM_NAME } from "potyro";
import { parseLine } from "@potyro/store";
import { toBase64Url } from "./demo-link.js";

/** The fragment keys: the app's line, the page, and each param behind `p.`. */
export const APP_KEY = "app";
export const PAGE_KEY = "to";
export const PARAM_PREFIX = "p.";

/** A page id a link may name: the length is all that is checked here; the app says whether it has one. */
const MAX_PAGE_CHARS = 64;
/**
 * Params read from a link at most. More than a page may take (`LINK_LIMITS.params`): which of them it
 * takes is the page's to say (`acceptLinkParams`), so junk ahead of a real one does not push it out
 * unless there is a great deal of it.
 */
const MAX_READ_PARAMS = 32;

/** Where a link wants to land: which app, which of its pages (none: wherever it opens), and with what. */
export interface AppTarget {
  line: string;
  page?: string;
  params: Record<string, string>;
}

/** A line of its own, for an app made here: 128 random bits. */
export function newLine(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** The line of an app that never got one of its own: its declared id. */
export function derivedLine(declaredId: string | undefined): string | undefined {
  return declaredId ? parseLine(`id:${declaredId}`) : undefined;
}

/** An app's line: its own, else its declared id's. */
export function lineFor(app: { line?: string }, declaredId: string | undefined): string | undefined {
  return parseLine(app.line) ?? derivedLine(declaredId);
}

/**
 * Where a link wants to land, if it says (`app=` is there and is a line). Anyone can write a link, so
 * nothing in it is believed past its shape: a param with a name that is not one, a value longer than
 * `LINK_LIMITS.chars`, a second value for a name, and everything past the first `MAX_READ_PARAMS`,
 * are left out, silently. Which of the rest a page gets is the page's to say (`acceptLinkParams`).
 */
export function readAppTarget(hash: string): AppTarget | null {
  let fragment: URLSearchParams;
  try {
    fragment = new URLSearchParams(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  const line = parseLine(fragment.get(APP_KEY));
  if (!line) return null;
  const to = fragment.get(PAGE_KEY);
  const page = to && to.length <= MAX_PAGE_CHARS ? to : undefined;
  // A Map, then own properties: a name like `__proto__` is a name here, never the object's prototype.
  const read = new Map<string, string>();
  for (const [key, value] of fragment) {
    if (!key.startsWith(PARAM_PREFIX)) continue;
    const name = key.slice(PARAM_PREFIX.length);
    if (!LINK_PARAM_NAME.test(name) || read.has(name) || value.length > LINK_LIMITS.chars) continue;
    if (read.size >= MAX_READ_PARAMS) break;
    read.set(name, value);
  }
  return { line, ...(page ? { page } : {}), params: Object.fromEntries(read) };
}

/** A target as fragment text: `app=…&to=…&p.code=…`. */
export function targetFragment(target: AppTarget): string {
  const out = new URLSearchParams();
  out.set(APP_KEY, target.line);
  if (target.page) out.set(PAGE_KEY, target.page);
  for (const [name, value] of Object.entries(target.params)) out.set(`${PARAM_PREFIX}${name}`, value);
  return out.toString();
}

/** A link with a target put on it (replacing any it had); the rest of its fragment — a key, a package, `remix=1` — as it was. */
export function withAppTarget(link: string, target: AppTarget): string {
  const at = link.indexOf("#");
  const base = at < 0 ? link : link.slice(0, at);
  const ours = (part: string): boolean => {
    const key = part.split("=")[0] ?? "";
    return key === APP_KEY || key === PAGE_KEY || key.startsWith(PARAM_PREFIX);
  };
  const kept = at < 0 ? [] : link.slice(at + 1).split("&").filter((part) => part && !ours(part));
  return `${base}#${[...kept, targetFragment(target)].join("&")}`;
}

/** An app on this device, as matching sees it: its id here, its line, and the line it remixed. */
export interface LinkCandidate {
  id: string;
  line?: string;
  lineOf?: string;
}

/**
 * The app on this device a link's line opens, from candidates in the order to prefer them (the most
 * recently changed first): a copy of that app; else a remix of it; else none.
 */
export function matchLinkedApp<C extends LinkCandidate>(candidates: readonly C[], line: string): C | null {
  return candidates.find((c) => c.line === line) ?? candidates.find((c) => c.lineOf === line) ?? null;
}

// ---- landing, across a page load ----
//
// A link is read at boot, and the app it opens is shown after the page loads again (a match: the URL
// is put back to `?user=<id>`; a demo kept: Add an app opens the copy). What to land on goes along in
// this tab's session storage, for that app only, taken once.

const ARRIVAL_KEY = "potyro:link-arrival";

/** What an app is opened on from a link: the page (none: where it always opens) and its params. */
export interface Arrival {
  page?: string;
  params: Record<string, string>;
}

export function holdArrival(appId: string, target: Pick<AppTarget, "page" | "params">): void {
  try {
    globalThis.sessionStorage?.setItem(ARRIVAL_KEY, JSON.stringify({ appId, page: target.page, params: target.params }));
  } catch {
    // no session storage: the app opens where it always does
  }
}

/** Where to open this app, when a link said; cleared once read. What comes back is only its shape: the page checks the rest. */
export function takeArrival(appId: string | undefined): Arrival | null {
  if (!appId) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(ARRIVAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { appId?: unknown; page?: unknown; params?: unknown };
    if (parsed.appId !== appId) return null;
    globalThis.sessionStorage?.removeItem(ARRIVAL_KEY);
    const params: Record<string, string> =
      parsed.params && typeof parsed.params === "object" ? Object.fromEntries(Object.entries(parsed.params as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    return { ...(typeof parsed.page === "string" ? { page: parsed.page } : {}), params };
  } catch {
    return null;
  }
}
