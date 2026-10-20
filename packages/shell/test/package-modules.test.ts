import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { lockEntryFor, moduleFileFor, srcKey, type AppLock } from "@potyro/store";
import { bundleAppSource, bundleTrustedWith, type EsbuildLike } from "../src/app-bundler.js";
import { memoryModules, standInNote, withLibrariesStoodIn, type ModuleSource } from "../src/package-modules.js";

// The bundler's second plugin (#266, #258): libraries imported by URL and the package's own modules
// are served from the app's file space, checked against the lock, and never fetched. Verified with
// the native esbuild and the real isolate stubs, then the bundle is run to see what the code computed.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;
const enc = (s: string) => new TextEncoder().encode(s);

const LIB = "https://esm.sh/fancy-sum@1.2.3?bundle";
const LIB_INNER = "https://esm.sh/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs";
const LIB_DEP = "https://esm.sh/tiny-twice@0.1.0/es2022/tiny-twice.mjs";

/** An app space holding the given modules and libraries, and the lock that vouches for them. */
async function space(opts: { src?: Record<string, string>; libs?: Record<string, string>; tamper?: string[] }): Promise<ModuleSource> {
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(opts.src ?? {})) {
    const file = `.src/${path}`;
    lock[srcKey(path)] = await lockEntryFor(file, enc(text));
    files.set(file, enc(text));
  }
  for (const [url, text] of Object.entries(opts.libs ?? {})) {
    const file = await moduleFileFor(enc(text));
    lock[url] = await lockEntryFor(file, enc(text));
    files.set(file, enc(text));
  }
  for (const key of opts.tamper ?? []) {
    const f = lock[key]!.file;
    files.set(f, enc(new TextDecoder().decode(files.get(f)!).replace("2", "3")));
  }
  return memoryModules(lock, files);
}

/** Run an isolate bundle the way QuickJS does: as a script, with its own global object. */
function run(code: string): { id?: string; name?: string } {
  const g: Record<string, unknown> = {};
  new Function("globalThis", code)(g);
  return (g.__potyroApp as { id?: string; name?: string }) ?? {};
}

const app = (imports: string, name: string) => `import { defineApp } from "potyro";
${imports}
export default defineApp({ id: "t", name: ${name}, version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] } as never);`;

const LIBRARY = {
  [LIB]: `/* esm.sh - fancy-sum@1.2.3 */\nexport * from "/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs";\n`,
  [LIB_INNER]: `import { twice } from "/tiny-twice@0.1.0/es2022/tiny-twice.mjs";\nexport const sum = (a, b) => twice(a + b) / 2;\nexport const label = "sum " + twice(21);\n`,
  [LIB_DEP]: `export const twice = (n) => n * 2;\n`,
};

describe("the package's own modules (#258)", () => {
  it("resolves ./plan.js to src/plan.ts, and a module's own imports from its folder", async () => {
    const mods = await space({
      src: {
        "plan.ts": `import { weeks } from "./data/weeks.js";\nexport const title = (n: number): string => "Plan of " + weeks(n);`,
        "data/weeks.ts": `import { unit } from "../unit";\nexport const weeks = (n: number) => n + " " + unit;`,
        "unit.ts": `export const unit = "weeks";`,
      },
    });
    const code = await bundleAppSource(app(`import { title } from "./plan.js";`, `title(12)`), esbuild, stubs, mods);
    expect(run(code).name).toBe("Plan of 12 weeks");
  });

  it("the trusted bundle resolves them the same way", async () => {
    const mods = await space({ src: { "plan.ts": `export const title = "Plan";` } });
    const esm = await bundleTrustedWith(app(`import { title } from "./plan.js";`, "title"), esbuild, mods);
    expect(esm).toContain('"Plan"');
  });

  it("names a module the app imports but does not have", async () => {
    const mods = await space({ src: {} });
    await expect(bundleAppSource(app(`import { x } from "./missing.js";`, `"x" + x`), esbuild, stubs, mods)).rejects.toThrow(/"\.\/missing\.js".*not one of its files/);
  });

  it("refuses an import that climbs out of the app's own folder", async () => {
    const mods = await space({ src: { "plan.ts": `export const t = 1;` } });
    await expect(bundleAppSource(app(`import { t } from "../plan.js";`, `"x" + t`), esbuild, stubs, mods)).rejects.toThrow(/outside the app/);
  });

  it("refuses a module whose bytes changed since install, by name", async () => {
    const mods = await space({ src: { "plan.ts": `export const title = "Plan 2";` }, tamper: [srcKey("plan.ts")] });
    await expect(bundleAppSource(app(`import { title } from "./plan.js";`, "title"), esbuild, stubs, mods)).rejects.toThrow(/plan\.ts.*changed/);
  });

  it("an app with no package says why a relative import cannot work", async () => {
    await expect(bundleAppSource(app(`import { t } from "./plan.js";`, `"x" + t`), esbuild, stubs)).rejects.toThrow(/"\.\/plan\.js"/);
  });
});

describe("libraries by URL (#266)", () => {
  it("serves a locked library and everything it imports from the app's space, offline", async () => {
    const mods = await space({ libs: LIBRARY });
    const code = await bundleAppSource(app(`import { sum, label } from "${LIB}";`, `label + " / " + sum(2, 3)`), esbuild, stubs, mods);
    expect(run(code).name).toBe("sum 42 / 5");
  });

  it("a library loaded from one of the app's modules is served the same way", async () => {
    const libs = await space({ libs: LIBRARY, src: { "maths.ts": `import { sum } from "${LIB}";\nexport const seven = sum(3, 4);` } });
    const code = await bundleAppSource(app(`import { seven } from "./maths.js";`, `"seven=" + seven`), esbuild, stubs, libs);
    expect(run(code).name).toBe("seven=7");
  });

  it("refuses a library whose bytes do not match the lock, naming the library", async () => {
    const mods = await space({ libs: LIBRARY, tamper: [LIB_INNER] });
    const failing = bundleAppSource(app(`import { sum } from "${LIB}";`, `"x" + sum(1, 1)`), esbuild, stubs, mods);
    await expect(failing).rejects.toThrow(/fancy-sum 1\.2\.3/);
    await expect(failing).rejects.toThrow(/not the copy this app was installed with/);
  });

  it("refuses the same in a trusted bundle", async () => {
    const mods = await space({ libs: LIBRARY, tamper: [LIB_DEP] });
    await expect(bundleTrustedWith(app(`import { sum } from "${LIB}";`, `"x" + sum(1, 1)`), esbuild, mods)).rejects.toThrow(/tiny-twice 0\.1\.0/);
  });

  it("names a library the app imports but has not fetched", async () => {
    const mods = await space({});
    await expect(bundleAppSource(app(`import { sum } from "${LIB}";`, `"x" + sum(1, 2)`), esbuild, stubs, mods)).rejects.toThrow(/fancy-sum 1\.2\.3.*not part of this app yet/);
  });

  it("names a library whose bytes are not on this device", async () => {
    const full = await space({ libs: LIBRARY });
    const missing = memoryModules(full.lock, new Map());
    await expect(bundleAppSource(app(`import { sum } from "${LIB}";`, `"x" + sum(1, 2)`), esbuild, stubs, missing)).rejects.toThrow(/fancy-sum 1\.2\.3.*not on this device/);
  });

  it("a library that needs a web page fails in the sealed box with a message naming it", async () => {
    const DOM = "https://esm.sh/needs-dom@2.0.0?bundle";
    const mods = await space({ libs: { [DOM]: `export const width = window.innerWidth;\n` } });
    const code = await bundleAppSource(app(`import { width } from "${DOM}";`, `"w" + width`), esbuild, stubs, mods);
    expect(() => run(code)).toThrow(/needs-dom 2\.0\.0 needs a full web page/);
  });

  it("the same library imported where it is used — `await import(url)` in a view — loads in the sealed box, and its code is in the bundle (#388)", async () => {
    const DOM = "https://esm.sh/needs-dom@2.0.0?bundle";
    const mods = await space({ libs: { [DOM]: `export const width = window.innerWidth;\n` } });
    const source = `import { defineApp } from "potyro";
const later = async () => (await import("${DOM}")).width;
export default defineApp({ id: "t", name: "Lazy", version: "1.0.0", schemaVersion: 1, entities: {}, pages: [], tile: later } as never);`;
    const code = await bundleAppSource(source, esbuild, stubs, mods);
    // The library's code is carried, not fetched: the box has no network, and the lock still vouches for it.
    expect(code).toContain("window.innerWidth");
    expect(code).not.toMatch(/import\("https:/);
    // It only runs when a screen asks for it: loading the app touches no `window`.
    expect(run(code).name).toBe("Lazy");
  });

  it("an app's own crash after its libraries loaded is not blamed on them", async () => {
    const mods = await space({ libs: LIBRARY });
    const code = await bundleAppSource(`import { sum } from "${LIB}";\nconst boom = (globalThis as any).nope.x;\nexport default sum;`, esbuild, stubs, mods);
    expect(() => run(code)).toThrow(TypeError);
    expect(() => run(code)).not.toThrow(/fancy-sum/);
  });

  it("for the Studio's checks, every library the app has stands in, its own modules stay real, and one it lacks is still refused", async () => {
    const DOM = "https://esm.sh/needs-dom@2.0.0?bundle";
    const mods = withLibrariesStoodIn(await space({ libs: { [DOM]: `export const width = window.innerWidth;\n` }, src: { "plan.ts": `export const name = "Planned";\n` } }));
    const code = await bundleAppSource(app(`import { width } from "${DOM}";\nimport { name } from "./plan.js";\nvoid width;`, `name`), esbuild, stubs, mods);
    expect(run(code).name).toBe("Planned");
    expect(standInNote(mods)).toMatch(/^needs-dom 2\.0\.0 was not run here/);
    await expect(bundleAppSource(app(`import x from "${LIB}";\nvoid x;`, `"x"`), esbuild, stubs, mods)).rejects.toThrow(/fancy-sum 1\.2\.3.*not part of this app yet/);
  });

  it("a stand-in's prototype chain ends, so asking `instanceof` of it — as the isolate's marshalling does — returns", async () => {
    const DOM = "https://esm.sh/needs-dom@2.0.0?bundle";
    const mods = withLibrariesStoodIn(await space({ libs: { [DOM]: `export const width = window.innerWidth;\n` } }));
    const code = await bundleAppSource(app(`import { width } from "${DOM}";\nconst isDate = String(width instanceof Date);`, `isDate`), esbuild, stubs, mods);
    expect(run(code).name).toBe("false");
  });

  it("while inspecting, a library not fetched yet stands in as an inert value, so the card can be drawn", async () => {
    const mods = await space({});
    const code = await bundleAppSource(app(`import Chart, { registerables } from "${LIB}";\nChart.register(...registerables);`, `"Charts"`), esbuild, stubs, mods, { standIns: true });
    expect(run(code).name).toBe("Charts");
  });
});
