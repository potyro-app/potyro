import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { integrityOf, lockEntryFor, moduleFileFor, type AppLock } from "@potyro/store";
import { bundleAppSource, type EsbuildLike } from "../src/app-bundler.js";
import { fetchLibraries, type HttpGet } from "../src/library-fetch.js";
import { memoryModules } from "../src/package-modules.js";

// Fetching a library at install (#266): the whole import graph, once, every file locked — or a clear
// refusal. The network is a map of URL → body here; nothing leaves the machine.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;
const enc = (s: string) => new TextEncoder().encode(s);

const ROOT = "https://esm.sh/fancy-chart@4.4.1?bundle";
const BUNDLE = "https://esm.sh/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";
const COLOR = "https://esm.sh/@kurkle/color@0.3.2/es2022/color.mjs";
const HELPER = "https://esm.sh/@kurkle/color@0.3.2/es2022/helper.mjs";

const SITE: Record<string, string> = {
  [ROOT]: `/* esm.sh - fancy-chart@4.4.1 */\nexport * from "/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";\n`,
  [BUNDLE]: `import { mix } from "/@kurkle/color@0.3.2/es2022/color.mjs";\nexport const chart = (a, b) => "chart of " + mix(a, b);\nexport const lazy = () => import("/@kurkle/color@0.3.2/es2022/helper.mjs");\n`,
  [COLOR]: `import { hex } from "./helper.mjs";\nexport const mix = (a, b) => hex(a) + "+" + hex(b);\n`,
  [HELPER]: `export const hex = (n) => "#" + n.toString(16);\n`,
};

/** A network that serves `site`, counting requests; `redirects` answers a URL with another's body. */
function network(site: Record<string, string>, redirects: Record<string, string> = {}) {
  const get = vi.fn<HttpGet>(async (url) => {
    const real = redirects[url] ?? url;
    const body = site[real];
    if (body === undefined) return { ok: false, status: 404, url: real, bytes: async () => new Uint8Array() };
    return { ok: true, status: 200, url: real, bytes: async () => enc(body) };
  });
  return get;
}

describe("fetchLibraries", () => {
  it("follows the whole import graph — absolute paths, relative paths, literal dynamic imports — and locks every file", async () => {
    const get = network(SITE);
    const { lock, files } = await fetchLibraries([ROOT], { esbuild, get });

    expect(Object.keys(lock).sort()).toEqual([BUNDLE, COLOR, HELPER, ROOT].sort());
    expect(get).toHaveBeenCalledTimes(4);
    for (const [url, entry] of Object.entries(lock)) {
      expect(entry.integrity).toBe(await integrityOf(enc(SITE[url]!)));
      expect(entry.file).toBe(await moduleFileFor(enc(SITE[url]!)));
      expect(files.find((f) => f.path === entry.file)?.data).toEqual(enc(SITE[url]!));
    }
  });

  it("what it locked is enough to run the app with no network at all", async () => {
    const { lock, files } = await fetchLibraries([ROOT], { esbuild, get: network(SITE) });
    const mods = memoryModules(lock, new Map(files.map((f) => [f.path, f.data])));
    const source = `import { chart } from "${ROOT}";\nexport default { name: chart(10, 255) };`;
    const g: Record<string, unknown> = {};
    new Function("globalThis", await bundleAppSource(source, esbuild, stubs, mods))(g);
    expect((g.__potyroApp as { name: string }).name).toBe("chart of #a+#ff");
  });

  it("records where a redirected file really came from, so its own imports resolve the same offline", async () => {
    // `./fancy-chart.bundle.mjs` means /v135/… only against the URL the file really came from; against
    // the URL that was asked for it is a file this site does not have.
    const ROOT2 = "https://esm.sh/fancy-chart@4.4.1/moved";
    const site = {
      "https://esm.sh/v135/fancy-chart@4.4.1/es2022/index.mjs": `export { chart } from "./fancy-chart.bundle.mjs";\n`,
      "https://esm.sh/v135/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs": `export const chart = () => "from v135";\n`,
    };
    const get = network(site, { [ROOT2]: "https://esm.sh/v135/fancy-chart@4.4.1/es2022/index.mjs" });
    const { lock, files } = await fetchLibraries([ROOT2], { esbuild, get });

    expect(lock[ROOT2]!.base).toBe("https://esm.sh/v135/fancy-chart@4.4.1/es2022/index.mjs");
    const mods = memoryModules(lock, new Map(files.map((f) => [f.path, f.data])));
    const g: Record<string, unknown> = {};
    new Function("globalThis", await bundleAppSource(`import { chart } from "${ROOT2}";\nexport default { name: chart() };`, esbuild, stubs, mods))(g);
    expect((g.__potyroApp as { name: string }).name).toBe("from v135");
  });

  it("refuses a URL with no exact version before fetching anything", async () => {
    const get = network(SITE);
    await expect(fetchLibraries(["https://esm.sh/fancy-chart?bundle"], { esbuild, get })).rejects.toThrow(/exact version/);
    await expect(fetchLibraries(["http://esm.sh/fancy-chart@4.4.1"], { esbuild, get })).rejects.toThrow(/https/);
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses, naming the library, when a file it imports cannot be fetched — nothing half-locked comes back", async () => {
    const { [HELPER]: _gone, ...site } = SITE;
    await expect(fetchLibraries([ROOT], { esbuild, get: network(site) })).rejects.toThrow(/@kurkle\/color 0\.3\.2.*404/);
  });

  it("refuses a library that imports a bare package name it cannot fetch", async () => {
    const site = { ...SITE, [COLOR]: `import x from "left-pad";\nexport const mix = x;\n` };
    await expect(fetchLibraries([ROOT], { esbuild, get: network(site) })).rejects.toThrow(/@kurkle\/color 0\.3\.2 imports "left-pad"/);
  });

  it("refuses a library that decides at run time what else to load", async () => {
    const site = { ...SITE, [HELPER]: `const which = "x" + Date.now();\nexport const hex = (n) => import(which);\n` };
    await expect(fetchLibraries([ROOT], { esbuild, get: network(site) })).rejects.toThrow(/fancy-chart 4\.4\.1.*while it runs/);
  });

  it("reuses bytes the app already has, and fetches only what is missing", async () => {
    const have: AppLock = {};
    const kept = new Map<string, Uint8Array>();
    for (const url of [ROOT, BUNDLE]) {
      const file = await moduleFileFor(enc(SITE[url]!));
      have[url] = await lockEntryFor(file, enc(SITE[url]!));
      kept.set(file, enc(SITE[url]!));
    }
    const get = network(SITE);
    const { lock } = await fetchLibraries([ROOT], { esbuild, get, have: memoryModules(have, kept) });
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual([COLOR, HELPER].sort());
    expect(Object.keys(lock)).toHaveLength(4);
  });

  it("a package that says what a library must hash to refuses different bytes from the network", async () => {
    const pinned: AppLock = { [ROOT]: await lockEntryFor(await moduleFileFor(enc("something else")), enc("something else")) };
    await expect(fetchLibraries([ROOT], { esbuild, get: network(SITE), pinned })).rejects.toThrow(/fancy-chart 4\.4\.1.*not the copy this app was made with/);
  });
});
