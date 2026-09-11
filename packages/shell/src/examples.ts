// The bundled examples are ordinary apps (#152). They used to be a separate kind: compiled modules
// behind a hardcoded tuple, with their own store namespace and a build-time sandbox bundle, that
// could not be opened in the Studio, renamed, shared or deleted. Now their SOURCE is seeded into
// the same registry every app lives in, once, and from then on they are yours: edit them in the
// Studio, share them, delete them. A deleted example stays deleted; an edited one keeps your edit.
//
// Under `--mode sandbox` they are seeded untrusted, so `pnpm dev:sandbox` and the sandbox browser
// project keep exercising the isolate through the runtime bundler — the path a shared app takes.

import { getUserApp, saveUserApp } from "./user-apps.js";

/** The examples' source text, loaded only when one needs seeding. Never evaluated here. */
const SOURCES = import.meta.glob(["../../../examples/*.app.ts", "../../../examples/*.app.tsx"], { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const SEEDED_KEY = "karta:examples:seeded";

export const EXAMPLE_IDS: readonly string[] = Object.keys(SOURCES)
  .map((p) => /\/([a-z0-9-]+)\.app\.tsx?$/.exec(p)?.[1])
  .filter((id): id is string => Boolean(id))
  .sort();

function seeded(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(SEEDED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** The app's declared name, read from the source the cheap way — these are our own files. */
function declaredName(source: string, fallback: string): string {
  return /^\s*name:\s*"([^"]+)"/m.exec(source)?.[1] ?? fallback;
}

/**
 * Seed every example that has never been seeded on this device and is not already present.
 * Returns the ids it added. Idempotent: a second call adds nothing.
 */
export async function seedExamples(opts: { trusted: boolean; now: string }): Promise<string[]> {
  const done = seeded();
  const added: string[] = [];
  for (const id of EXAMPLE_IDS) {
    if (done.has(id) || getUserApp(id)) continue;
    const load = SOURCES[`../../../examples/${id}.app.ts`] ?? SOURCES[`../../../examples/${id}.app.tsx`];
    if (!load) continue;
    const source = await load();
    await saveUserApp({ id, name: declaredName(source, id), source, trusted: opts.trusted, origin: "created", note: "example app" }, opts.now);
    done.add(id);
    added.push(id);
  }
  if (added.length) globalThis.localStorage?.setItem(SEEDED_KEY, JSON.stringify([...done]));
  return added;
}
