// The system's icons for an app's own things (DESIGN.md §3.5): an app names a Lucide icon
// ("shopping-cart") for itself, an entity, a page, an action, and the shell draws it with the stroke
// of the logo — in a tab bar, on a tile, as a row's lead, on the share image's canvas. The paths
// are one lazy chunk (src/lucide-paths.generated.ts, ~80 KB gzipped), fetched the first time a name
// is drawn and precached by the service worker, so an app on a plane still has its icons.
//
// Before the chunk is here nothing is known: `lucidePath` answers undefined, and whoever draws keeps
// the icon's room empty for the moment rather than flashing a fallback that is then replaced.

/** The shape of a Lucide name: kebab-case ASCII, as on lucide.dev ("map-pin", "gamepad-2"). */
export const LUCIDE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Whether a string is the shape of a Lucide icon name (not whether that icon exists). */
export function isLucideName(s: string | undefined | null): s is string {
  return typeof s === "string" && s.length >= 2 && s.length <= 48 && LUCIDE_NAME.test(s);
}

type Paths = Readonly<Record<string, string>>;

let paths: Paths | null = null;
let aliases: Paths = {};
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function settle(p: Paths, a: Paths): void {
  paths = p;
  aliases = a;
  for (const l of listeners) l();
}

/** Resolves once the paths are here. Safe to call any number of times; one load. */
export function lucideReady(): Promise<void> {
  if (paths) return Promise.resolve();
  pending ??= import("./lucide-paths.generated.js").then(
    (m) => settle(m.LUCIDE_PATHS, m.LUCIDE_ALIASES),
    // Offline before the chunk was ever fetched: the icons are the one thing missing, not the app.
    () => settle({}, {}),
  );
  return pending;
}

/** Whether the paths have been loaded (or failed to): `lucidePath` is decisive from then on. */
export function lucideLoaded(): boolean {
  return paths !== null;
}

/** The icon's path (a 24×24 box, stroke 2); undefined before the load, or for a name Lucide has not. */
export function lucidePath(name: string): string | undefined {
  if (!paths) return undefined;
  return paths[name] ?? (aliases[name] !== undefined ? paths[aliases[name]!] : undefined);
}

/**
 * Whether a name can be drawn: a Lucide-shaped name that exists — or, before the load, any
 * Lucide-shaped name (assumed, so a tile does not show a monogram for a moment and then the icon).
 */
export function lucideKnown(name: string | undefined | null): boolean {
  if (!isLucideName(name)) return false;
  return paths === null || lucidePath(name) !== undefined;
}

/** Hear the load, once it happens (for `useSyncExternalStore`). */
export function onLucide(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: make the paths known without a load. */
export function primeLucide(p: Paths, a: Paths = {}): void {
  pending = Promise.resolve();
  settle(p, a);
}
