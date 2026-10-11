// The bundled examples are ordinary apps (#152). They used to be a separate kind: compiled modules
// behind a hardcoded tuple, with their own store namespace and a build-time sandbox bundle, that
// could not be opened in the Studio, renamed, shared or deleted. Now their SOURCE is seeded into
// the same registry every app lives in, once, and from then on they are yours: edit them in the
// Studio, share them, delete them. A deleted example stays deleted; an edited one keeps your edit.
//
// Seeded once was ALSO seeded forever, which is the bug this file grew a second half for: an
// example improved in a later build never reached anyone who had already opened it. Fixing how
// Groceries splits its aisles, or how Split divides a bill, changed nothing for the only people who
// had ever used them. So a copy that is still exactly as we seeded it is updated when the build
// carries a newer one — and a copy you have touched is never overwritten, which is the whole reason
// the seeded source's fingerprint is kept.
//
// Under `--mode sandbox` they are seeded untrusted, so `pnpm dev:sandbox` and the sandbox browser
// project keep exercising the isolate through the runtime bundler — the path a shared app takes.

import { getUserApp, saveUserApp } from "./user-apps.js";

/** The examples' source text, loaded only when one needs seeding. Never evaluated here. */
const SOURCES = import.meta.glob(["../../../examples/*.app.ts", "../../../examples/*.app.tsx"], { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const SEEDED_KEY = "potyro:examples:seeded";

export const EXAMPLE_IDS: readonly string[] = Object.keys(SOURCES)
  .map((p) => /\/([a-z0-9-]+)\.app\.tsx?$/.exec(p)?.[1])
  .filter((id): id is string => Boolean(id))
  .sort();

/** What was seeded for an example, and what it looked like — so an edit can be told from a stale copy. */
interface Seeded {
  /** Fingerprint of the source WE wrote. Absent on devices seeded before this was recorded. */
  hash?: string;
  version?: string;
}

function seededState(): Map<string, Seeded> {
  try {
    const raw = globalThis.localStorage?.getItem(SEEDED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    // The original form was a plain list of ids: those devices know WHAT was seeded but not which
    // bytes, so their copies are left alone until the next seeding records a fingerprint.
    if (Array.isArray(parsed)) return new Map(parsed.filter((x): x is string => typeof x === "string").map((id) => [id, {}]));
    if (parsed && typeof parsed === "object") return new Map(Object.entries(parsed as Record<string, Seeded>));
    return new Map();
  } catch {
    return new Map();
  }
}

function remember(state: Map<string, Seeded>): void {
  try {
    globalThis.localStorage?.setItem(SEEDED_KEY, JSON.stringify(Object.fromEntries(state)));
  } catch {
    // A device that cannot remember re-seeds nothing and re-updates nothing: annoying, never wrong.
  }
}

/**
 * A cheap, stable fingerprint of a source file (FNV-1a).
 *
 * Not a cryptographic hash and does not need to be: the only question it answers is "are these the
 * same bytes we wrote?", where the alternative to a collision is overwriting someone's edit —
 * and the sources being compared are our own files, not an adversary's.
 */
function fingerprint(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The app's declared name, read from the source the cheap way — these are our own files. */
function declaredName(source: string, fallback: string): string {
  return /^\s*name:\s*"([^"]+)"/m.exec(source)?.[1] ?? fallback;
}

/** Its declared version, same reasoning. */
function declaredVersion(source: string): string {
  return /^\s*version:\s*"([^"]+)"/m.exec(source)?.[1] ?? "0.0.0";
}

/** Is `a` a later version than `b`? Plain numeric compare, part by part. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Seed every example this device has never had, and update the ones it has that are still ours.
 *
 * Returns the ids it added (not the ones it updated: an update is not a new app on the home screen).
 * Idempotent — a second call adds nothing and updates nothing.
 */
export async function seedExamples(opts: { trusted: boolean; now: string }): Promise<string[]> {
  const state = seededState();
  const added: string[] = [];
  let changed = false;

  for (const id of EXAMPLE_IDS) {
    const load = SOURCES[`../../../examples/${id}.app.ts`] ?? SOURCES[`../../../examples/${id}.app.tsx`];
    if (!load) continue;
    const installed = getUserApp(id);
    const known = state.get(id);

    // Never seeded, never deleted: this is a fresh device, or a new example in an old install.
    if (!known && !installed) {
      const source = await load();
      await saveUserApp({ id, name: declaredName(source, id), source, trusted: opts.trusted, origin: "created", note: "example app" }, opts.now);
      state.set(id, { hash: fingerprint(source), version: declaredVersion(source) });
      added.push(id);
      changed = true;
      continue;
    }

    // Deleted on purpose stays deleted; an app that was never ours is not ours to touch.
    if (!installed) continue;
    if (known === undefined) continue;

    // A copy whose bytes are no longer the ones we wrote is someone's work, whatever the version
    // says.
    //
    // A device seeded before fingerprints were recorded knows WHICH examples it was given but not
    // what they looked like. Refusing to touch those meant every example fix stopped at the door of
    // every device that had ever used Potyro — which is not caution, it is the feature not working.
    // So they are updated when the app has no HISTORY: the Studio records a version on every save,
    // so an app with none has never been edited here, and replacing it takes nothing from anybody.
    if (known.hash === undefined) {
      const { listVersions } = await import("./app-history.js");
      const edited = (await listVersions(id)).length > 0;
      if (edited) {
        state.set(id, { hash: fingerprint(installed.source), version: declaredVersion(installed.source) });
        changed = true;
        continue;
      }
    } else if (known.hash !== fingerprint(installed.source)) {
      continue;
    }

    const source = await load();
    if (fingerprint(source) === fingerprint(installed.source)) continue;
    // Same bytes as we seeded, and the build has a NEWER version: replace it. Records are untouched
    // — the store is keyed by app id, and a schema change travels as the app's own migrations.
    if (!isNewer(declaredVersion(source), declaredVersion(installed.source))) continue;
    await saveUserApp(
      { ...installed, name: declaredName(source, id), source, trusted: opts.trusted, note: "example app" },
      opts.now,
    );
    state.set(id, { hash: fingerprint(source), version: declaredVersion(source) });
    changed = true;
  }

  if (changed) remember(state);
  return added;
}

/** The bundled examples this device does not currently have — deleted, or never seeded. */
export function missingExamples(): string[] {
  return EXAMPLE_IDS.filter((id) => !getUserApp(id));
}

/**
 * Put a bundled example back.
 *
 * Deleting one is meant to stick — that is why `seedExamples` never re-adds it, and why nothing
 * here happens on its own. But "stays deleted" has to mean "until you ask for it back", or deleting
 * Recipes to clear the screen is a decision nobody can undo. Asking for it is what this is.
 */
export async function addExample(id: string, opts: { trusted: boolean; now: string }): Promise<boolean> {
  const load = SOURCES[`../../../examples/${id}.app.ts`] ?? SOURCES[`../../../examples/${id}.app.tsx`];
  if (!load) return false;
  const source = await load();
  await saveUserApp({ id, name: declaredName(source, id), source, trusted: opts.trusted, origin: "created", note: "example app" }, opts.now);
  const state = seededState();
  state.set(id, { hash: fingerprint(source), version: declaredVersion(source) });
  remember(state);
  return true;
}

/** Every bundled example's id and declared name, for a list of what can be added back. */
export async function exampleNames(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const id of EXAMPLE_IDS) {
    const load = SOURCES[`../../../examples/${id}.app.ts`] ?? SOURCES[`../../../examples/${id}.app.tsx`];
    if (load) out.push({ id, name: declaredName(await load(), id) });
  }
  return out;
}
