import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { lockEntryFor, moduleFileFor, type AppLock, type PackagedFile } from "@potyro/store";
import { bundleAppSource, type EsbuildLike } from "../src/app-bundler.js";
import type { HttpGet } from "../src/library-fetch.js";
import { memoryModules } from "../src/package-modules.js";
import { describeLibrary } from "../src/package-libraries.js";
import { librariesForOpen } from "../src/open-libraries.js";

// An app that arrived by share link or from the account carries its lock, not its libraries' bytes
// (#281). Opening it is where those are fetched: once, with the person's say-so, every byte checked
// against the lock and kept on this device — and from then on it opens with no network at all.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;
const enc = (s: string) => new TextEncoder().encode(s);

const ROOT = "https://esm.sh/fancy-chart@4.4.1?bundle";
const BUNDLE = "https://esm.sh/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";
const SITE: Record<string, string> = {
  [ROOT]: `export * from "/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";\n`,
  [BUNDLE]: `export const chart = (n) => "chart of " + n;\n`,
};
const SOURCE = `import { chart } from "${ROOT}";
import { defineApp } from "potyro";
export default defineApp({ id: "c", name: chart(3), entities: {}, pages: [] } as never);`;

function network(site: Record<string, string>) {
  return vi.fn<HttpGet>(async (u) =>
    site[u] === undefined ? { ok: false, status: 404, url: u, bytes: async () => new Uint8Array() } : { ok: true, status: 200, url: u, bytes: async () => enc(site[u]!) },
  );
}

/** The lock the author's device made, which travels with the source. */
async function authorsLock(): Promise<AppLock> {
  const lock: AppLock = {};
  for (const [url, body] of Object.entries(SITE)) lock[url] = await lockEntryFor(await moduleFileFor(enc(body)), enc(body));
  return lock;
}

function device() {
  const kept = new Map<string, Uint8Array>();
  const keep = vi.fn(async (files: PackagedFile[]) => {
    for (const f of files) kept.set(f.path, f.data);
  });
  return { kept, keep };
}

describe("opening an app whose libraries are not on this device yet", () => {
  it("asks first — saying what it fetches, from where — then fetches, checks and keeps it", async () => {
    const lock = await authorsLock();
    const { kept, keep } = device();
    const get = network(SITE);
    const ask = vi.fn(async () => true);

    const ready = await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, kept), { esbuild, get, ask, keep });

    expect(ask).toHaveBeenCalledTimes(1);
    const [lines] = ask.mock.calls[0] as unknown as [Parameters<typeof describeLibrary>[0][]];
    expect(lines.map((l) => describeLibrary(l))).toEqual([`fetches fancy-chart 4.4.1, ${SITE[ROOT]!.length + SITE[BUNDLE]!.length} B, from esm.sh`]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.lock).toEqual(lock);
    expect([...kept.keys()].sort()).toEqual(Object.values(lock).map((e) => e.file).sort());
    // And it runs.
    const code = await bundleAppSource(SOURCE, esbuild, stubs, ready.modules);
    expect(code).toContain("chart of");
  });

  it("opens with no network at all once it has them", async () => {
    const lock = await authorsLock();
    const { kept, keep } = device();
    await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, kept), { esbuild, get: network(SITE), ask: async () => true, keep });

    const offline = network({});
    const ask = vi.fn(async () => true);
    const again = await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, kept), { esbuild, get: offline, ask, keep });
    expect(again.ok).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(offline).not.toHaveBeenCalled();
  });

  it("fetches nothing when the person says not now, and says what the app is waiting for", async () => {
    const lock = await authorsLock();
    const { keep } = device();
    const get = network(SITE);
    const ready = await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, new Map()), { esbuild, get, ask: async () => false, keep });
    expect(ready).toEqual({ ok: false, message: "“Chart” can’t open until it has fancy-chart 4.4.1. Open it again to fetch it." });
    expect(get).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
  });

  it("refuses a library whose address no longer serves the locked bytes, by name, and keeps nothing", async () => {
    const lock = await authorsLock();
    const { keep } = device();
    const changed = network({ ...SITE, [BUNDLE]: `export const chart = (n) => "pwned " + n;\n` });
    const ready = await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, new Map()), { esbuild, get: changed, ask: async () => true, keep });
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.message).toContain("fancy-chart 4.4.1 from esm.sh is not the copy this app was made with");
    expect(keep).not.toHaveBeenCalled();
  });

  it("an app shared before the lock travelled still opens: its libraries are fetched fresh, with consent, and locked", async () => {
    const { kept, keep } = device();
    const ask = vi.fn(async () => true);
    const ready = await librariesForOpen({ name: "Chart", source: SOURCE, lock: undefined }, undefined, { esbuild, get: network(SITE), ask, keep });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(Object.keys(ready.lock ?? {}).sort()).toEqual([BUNDLE, ROOT].sort());
    expect(kept.size).toBe(2);
  });

  it("keeps the app's own modules in the lock it opens with", async () => {
    const lock: AppLock = { ...(await authorsLock()), "src/plan.ts": await lockEntryFor(".src/plan.ts", enc("export const n = 1;")) };
    const { kept, keep } = device();
    kept.set(".src/plan.ts", enc("export const n = 1;"));
    const ready = await librariesForOpen({ name: "Chart", source: SOURCE, lock }, memoryModules(lock, kept), { esbuild, get: network(SITE), ask: async () => true, keep });
    expect(ready.ok && ready.lock?.["src/plan.ts"]).toEqual(lock["src/plan.ts"]);
  });

  it("asks nothing of an app with no libraries", async () => {
    const ask = vi.fn(async () => true);
    const ready = await librariesForOpen({ name: "Notes", source: `export default 1;`, lock: undefined }, undefined, { esbuild, get: network({}), ask, keep: async () => {} });
    expect(ready).toEqual({ ok: true, lock: undefined, modules: undefined, fetched: [] });
    expect(ask).not.toHaveBeenCalled();
  });
});
