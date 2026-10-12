import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { fileSpace, lockEntryFor, MemoryStore, moduleFileFor, type AppLock } from "@potyro/store";
import { bundleAppSource, type EsbuildLike } from "../src/app-bundler.js";
import type { HttpGet } from "../src/library-fetch.js";
import { memoryModules } from "../src/package-modules.js";
import { librariesToFetch, prepareStudioLibraries, writeLibraryFiles } from "../src/studio-libraries.js";

// A library in a Studio save (#266): the Studio says what it will fetch before it does, fetches once
// with the person's say-so, and the version it saves carries the lock. Nothing here reaches a network:
// `get` is a map of URL → body.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;
const enc = (s: string) => new TextEncoder().encode(s);

const url = (v: string) => `https://esm.sh/fancy-chart@${v}?bundle`;
const body = (v: string) => `export const chart = (n) => "chart ${v} of " + n;\n`;
const SITE: Record<string, string> = { [url("4.4.0")]: body("4.4.0"), [url("4.4.1")]: body("4.4.1") };
const net = () =>
  vi.fn<HttpGet>(async (u) => (SITE[u] === undefined ? { ok: false, status: 404, url: u, bytes: async () => new Uint8Array() } : { ok: true, status: 200, url: u, bytes: async () => enc(SITE[u]!) }));

const APP = (v: string) => `import { chart } from "${url(v)}";
import { defineApp } from "potyro";
export default defineApp({ id: "c", name: chart(3), entities: {}, pages: [] } as never);`;

async function haveLibrary(v: string) {
  const bytes = enc(body(v));
  const file = await moduleFileFor(bytes);
  const lock: AppLock = { [url(v)]: await lockEntryFor(file, bytes), "src/plan.ts": await lockEntryFor(".src/plan.ts", enc("export const n = 1;")) };
  return memoryModules(lock, new Map([[file, bytes], [".src/plan.ts", enc("export const n = 1;")]]));
}

describe("what a Studio save would fetch", () => {
  it("names each library the version imports that the app does not have yet", async () => {
    expect(await librariesToFetch(APP("4.4.1"), undefined)).toEqual({
      lines: [{ url: url("4.4.1"), label: "fancy-chart 4.4.1", host: "esm.sh", here: false }],
      issues: [],
    });
  });

  it("nothing, when the app already has it", async () => {
    expect((await librariesToFetch(APP("4.4.1"), await haveLibrary("4.4.1"))).lines).toEqual([]);
  });

  it("a URL with no exact version is a problem, not a fetch", async () => {
    const r = await librariesToFetch(`import x from "https://esm.sh/fancy-chart?bundle";`, undefined);
    expect(r.lines).toEqual([]);
    expect(r.issues[0]).toMatch(/exact version/);
  });
});

describe("preparing a Studio save", () => {
  it("fetches what is new, locks it beside the app's own modules, and the version bundles from it with no network", async () => {
    const get = net();
    const have = await haveLibrary("4.4.0");
    const planned = (await prepareStudioLibraries(APP("4.4.1"), have, { esbuild, get }))!;
    expect(get.mock.calls.map((c) => c[0])).toEqual([url("4.4.1")]);
    expect(Object.keys(planned.lock!).sort()).toEqual([url("4.4.1"), "src/plan.ts"].sort());
    expect(planned.fetched).toEqual([{ url: url("4.4.1"), label: "fancy-chart 4.4.1", host: "esm.sh", here: false, size: body("4.4.1").length }]);
    const code = await bundleAppSource(APP("4.4.1"), esbuild, stubs, planned.modules);
    expect(code).toContain("chart 4.4.1 of");
  });

  it("a library the app already has is not fetched again", async () => {
    const get = net();
    const planned = (await prepareStudioLibraries(APP("4.4.0"), await haveLibrary("4.4.0"), { esbuild, get }))!;
    expect(get).not.toHaveBeenCalled();
    expect(planned.fetched).toEqual([]);
    expect(planned.files).toEqual([]);
  });

  it("a version that stops importing a library drops it from the lock, and keeps the app's own modules", async () => {
    const planned = (await prepareStudioLibraries(`export default 1;`, await haveLibrary("4.4.0"), { esbuild, get: net() }))!;
    expect(Object.keys(planned.lock!)).toEqual(["src/plan.ts"]);
  });

  it("an app with no libraries, before or after, changes nothing", async () => {
    expect(await prepareStudioLibraries(`export default 1;`, undefined, { esbuild, get: net() })).toBeNull();
  });

  it("the fetched bytes land in the app's folder, where opening it reads them", async () => {
    const planned = (await prepareStudioLibraries(APP("4.4.1"), undefined, { esbuild, get: net() }))!;
    const store = new MemoryStore();
    await store.open("c");
    await writeLibraryFiles(store, planned.files);
    const file = planned.lock![url("4.4.1")]!.file;
    expect(await (await fileSpace(store).read(file))!.text()).toBe(body("4.4.1"));
  });
});
