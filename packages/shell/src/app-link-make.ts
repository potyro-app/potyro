// Making a link to one of an app's pages (`ctx.ui.share({ app })`, docs/24 §11): the app's demo link,
// with where to land on it.
//
// The demo link is what lets the link work for someone who does not have the app: they try it, keep
// it, and land where the link said. For someone who has it, the same link opens their own copy. It is
// made once per version of the app and kept on this device (an invite is sent again and again; a fresh
// share each time would be a new upload, and the service allows 30 a day), and made again when the app
// changes or its link was taken down from the share sheet.
//
// When no demo link can be made — the share service is not there and the app is too big to carry in a
// link — the link still opens the app for whoever has it, and says nothing to anyone else.
import { lineFor, withAppTarget, type AppTarget } from "./app-link.js";
import { siteBase } from "./demo-link.js";
import { currentSite } from "./site.js";
import type { UserApp } from "./user-apps.js";

const DEMOS_KEY = "potyro:app-link-demos";

interface KeptDemo {
  /** Which version of the app the link carries. */
  sig: string;
  link: string;
}

/** Which version of an app a demo link carries: its code and what it ships, never its records. */
export function demoSignature(app: Pick<UserApp, "source" | "lock" | "shipped" | "line" | "credit">): string {
  const text = JSON.stringify([app.source, app.lock ?? null, app.shipped ?? [], app.line ?? null, app.credit ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

function keptDemos(): Record<string, KeptDemo> {
  try {
    const raw = globalThis.localStorage?.getItem(DEMOS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, KeptDemo>) : {};
  } catch {
    return {};
  }
}

function keepDemo(appId: string, demo: KeptDemo): void {
  try {
    globalThis.localStorage?.setItem(DEMOS_KEY, JSON.stringify({ ...keptDemos(), [appId]: demo }));
  } catch {
    // the link works; the next invite makes another
  }
}

/** Where the site is, for a link with no demo in it. */
function siteRoot(): string {
  const site = currentSite();
  return site?.configured ? `${site.origin}${site.path}` : `${location.origin}${siteBase(location.pathname)}`;
}

export interface AppLinkDeps {
  /** The app's demo link; `makeDemoLink` by default. */
  demoLink?: (app: UserApp) => Promise<string>;
  /** Whether a hosted link is still up (not taken down from the share sheet). */
  stillShared?: (link: string) => boolean;
}

async function defaultDemoLink(app: UserApp): Promise<string> {
  const { makeDemoLink } = await import("./demo-share.js");
  return (await makeDemoLink(app)).link;
}

function defaultStillShared(link: string): boolean {
  if (!/\/s\/[^/#]+#/.test(link)) return true; // inline: nothing to take down
  const base = link.split("#")[0];
  try {
    const raw = globalThis.localStorage?.getItem("potyro:shares");
    const shares = raw ? (JSON.parse(raw) as Array<{ link?: unknown }>) : [];
    return Array.isArray(shares) && shares.some((s) => s?.link === base);
  } catch {
    return false;
  }
}

/** The demo link for this version of the app: the one made before, or a new one. Null when none can be made. */
async function demoLinkFor(app: UserApp, deps: AppLinkDeps): Promise<string | null> {
  const sig = demoSignature(app);
  const kept = keptDemos()[app.id];
  const stillShared = deps.stillShared ?? defaultStillShared;
  if (kept && kept.sig === sig && typeof kept.link === "string" && stillShared(kept.link)) return kept.link;
  try {
    const link = await (deps.demoLink ?? defaultDemoLink)(app);
    keepDemo(app.id, { sig, link });
    return link;
  } catch (e) {
    console.warn("[potyro] no demo link for this app; the link opens it only for someone who has it:", e);
    return null;
  }
}

/**
 * A link to `page` of this app with `params` (already checked against the page by the host). `declaredId`
 * is the app's declared id, which is its line when it has none of its own.
 */
export async function makeAppLink(
  app: UserApp,
  declaredId: string | undefined,
  target: { page: string; params: Record<string, string> },
  deps: AppLinkDeps = {},
): Promise<string> {
  const line = lineFor(app, declaredId);
  if (!line) throw new Error("This app has no id to make a link to it with");
  const to: AppTarget = { line, page: target.page, params: target.params };
  const demo = await demoLinkFor(app, deps);
  return withAppTarget(demo ?? siteRoot(), to);
}
