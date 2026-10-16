// Which sites are Potyro, and where an old one's people should go (docs/16 §Moving to a new home).
//
// Browser storage belongs to one origin. When Potyro's public home moved from apps.vaz.io to
// potyro.app, everything a person had made stayed behind on the old one, and the only way across is
// for the two sites to hand it over between two windows of the same browser. Each side of that
// hand-over trusts a message only because of the origin it came from, so the list of Potyro origins
// lives HERE, in one place, and nowhere else decides it.
//
// A build can add origins (`VITE_POTYRO_MOVE_ORIGINS`, comma-separated) for a self-hosted Potyro that
// moves too. A dev server adds `localhost`, on any port, and nothing else: two `pnpm dev` servers on
// two ports are two origins, which is how the hand-over is tested (e2e/move-home-trusted.spec.ts).

/** Potyro's public sites. Exact origins: scheme, host and port. */
export const POTYRO_ORIGINS: readonly string[] = ["https://potyro.app", "https://apps.vaz.io"];

/** Old home → new home. A site listed here shows its people the way across. */
export const NEW_HOMES: Readonly<Record<string, string>> = { "https://apps.vaz.io": "https://potyro.app" };

/** In dev only: where this dev server's "new home" is, so two dev servers can play both parts. */
export const DEV_NEW_HOME_KEY = "potyro:dev:new-home";

export interface OriginEnv {
  /** A dev server: `localhost` on any port counts as Potyro. */
  dev: boolean;
  /** `VITE_POTYRO_MOVE_ORIGINS`: more origins a build counts as Potyro. */
  extra?: string;
}

/** The origin of a URL, or null for anything that is not a plain http(s) one. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The origins a build adds, read strictly: an entry that is not exactly an origin is dropped. */
function extraOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && originOf(s) === s);
}

/**
 * Is `origin` a Potyro site? Pure.
 *
 * Compared as whole origins, never by prefix or suffix: `https://potyro.app.evil.test` and
 * `https://evilpotyro.app` are not Potyro, and an `http:` copy of a public site is not either.
 */
export function isPotyroOrigin(origin: string, env: OriginEnv): boolean {
  if (typeof origin !== "string" || !origin || origin === "null") return false;
  if (POTYRO_ORIGINS.includes(origin)) return true;
  if (extraOrigins(env.extra).includes(origin)) return true;
  if (env.dev) {
    const o = originOf(origin);
    if (o !== origin) return false;
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  }
  return false;
}

/** Every Potyro origin a message could be addressed to, for a page that does not know which opened it. */
export function knownOrigins(env: OriginEnv): string[] {
  return [...new Set([...POTYRO_ORIGINS, ...extraOrigins(env.extra)])];
}

/**
 * Where this site's people should move to, or null when this site is not an old home. Pure.
 *
 * `devNewHome` is the dev-only override (`DEV_NEW_HOME_KEY`), ignored outside dev and when it is not
 * itself a Potyro origin — a typo must not make a dev server hand someone's apps to a stranger.
 */
export function newHomeFor(here: string, env: OriginEnv & { configured?: string; devNewHome?: string | null }): string | null {
  const configured = env.configured?.trim();
  const candidate = configured ? originOf(configured) : env.dev && env.devNewHome ? originOf(env.devNewHome) : (NEW_HOMES[here] ?? null);
  if (!candidate || candidate === here) return null;
  return isPotyroOrigin(candidate, env) ? candidate : null;
}

/** This build's view of the world, read now. */
export function originEnv(): OriginEnv {
  return {
    dev: Boolean(import.meta.env?.DEV),
    extra: import.meta.env?.VITE_POTYRO_MOVE_ORIGINS as string | undefined,
  };
}

/** Where this site's people should move to, read now. */
export function currentNewHome(): string | null {
  const here = globalThis.location?.origin;
  if (!here) return null;
  let devNewHome: string | null = null;
  try {
    devNewHome = globalThis.localStorage?.getItem(DEV_NEW_HOME_KEY) ?? null;
  } catch {
    // storage blocked: no override
  }
  return newHomeFor(here, { ...originEnv(), configured: import.meta.env?.VITE_POTYRO_NEW_HOME as string | undefined, devNewHome });
}

/** `potyro.app` — an origin as a person reads it. */
export function siteName(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
