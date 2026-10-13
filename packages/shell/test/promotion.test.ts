// Which failures to open a sealed app offer "Let it run as yours" (owner, 2026-10-13).
//
// Promotion is always reachable after install, but it is offered as the FIX for a failure only when
// running as yours would fix it: the sealed box lacks something the app or one of its libraries
// needs. Code that does not compile, an app's own mistake, and above all a library that does not
// match its lock are not fixed by promoting — and tampered code must never be one tap from full
// authority. The errors here are the real ones: the app bundled as the sealed box runs it, loaded in
// QuickJS.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { lockEntryFor, moduleFileFor } from "@potyro/store";
import { bundleAppSource, type AppBundler, type EsbuildLike } from "../src/app-bundler.js";
import { trySealed } from "../src/app-trial.js";
import { memoryModules, type ModuleSource } from "../src/package-modules.js";
import { promotionFixes } from "../src/promotion.js";
import { declaredPermissions } from "../src/app-source.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = { potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"), react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8") };
const bundler: AppBundler = (source, modules, opts) => bundleAppSource(source, { build } as unknown as EsbuildLike, stubs, modules, opts);

const app = (top = "", body = "() => 1") => `import { defineApp } from "potyro";
${top}
export default defineApp({
  id: "trial",
  name: "Trial",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { day: { label: "Day", displayField: "title", fields: { title: { type: "text" } }, computed: { shown: ${body} } } },
  pages: [{ id: "all", title: "Days", view: { type: "list", entity: "day" } }],
});
`;

const URL_ = "https://esm.sh/needs-window@1.0.0?bundle";

async function withLibrary(code: string, tamper = false): Promise<ModuleSource> {
  const bytes = new TextEncoder().encode(code);
  const file = await moduleFileFor(bytes);
  const entry = await lockEntryFor(file, bytes);
  const stored = tamper ? new TextEncoder().encode(code.replace("innerWidth", "innerHeight")) : bytes;
  return memoryModules({ [URL_]: entry }, new Map([[file, stored]]));
}

/** The error the sealed box gives opening this app, as main.tsx sees it. */
async function sealedFailure(source: string, modules?: ModuleSource): Promise<unknown> {
  try {
    await bundler(source, modules);
  } catch (e) {
    return e;
  }
  const trial = await trySealed(source, modules, { bundler });
  expect(trial.definition).toBeUndefined();
  return new Error(trial.loadFailed ?? trial.unreadable);
}

describe("which failures to open a sealed app offer to run it as yours", () => {
  it("a library that needs a full web page while it loads: yes", async () => {
    const mods = await withLibrary("export const width = window.innerWidth;\n");
    const e = await sealedFailure(app(`import { width } from "${URL_}";`, "() => String(width)"), mods);
    expect(String(e)).toMatch(/needs-window 1\.0\.0 needs a full web page to work/);
    expect(promotionFixes(e)).toBe(true);
  }, 60_000);

  it("the app's own top level reaching for a feature the box lacks (Intl, document): yes", async () => {
    expect(promotionFixes(await sealedFailure(app('const f = new Intl.DateTimeFormat("en");', "() => f.format(new Date())")))).toBe(true);
    expect(promotionFixes(await sealedFailure(app("const w = document.title;", "() => w")))).toBe(true);
  }, 60_000);

  it("a library whose bytes do not match its lock: never, though the same library would otherwise be offered", async () => {
    const mods = await withLibrary("export const width = window.innerWidth;\n", true);
    const e = await sealedFailure(app(`import { width } from "${URL_}";`, "() => String(width)"), mods);
    expect(String(e)).toMatch(/not the copy this app was installed with/);
    expect(promotionFixes(e)).toBe(false);
  }, 60_000);

  it("a tampered library's message is refused even when it is not a ModuleError any more", () => {
    expect(promotionFixes(new Error("needs-window 1.0.0 is not the copy this app was installed with, so it was not run. Add the app again to restore it."))).toBe(false);
    expect(promotionFixes("This app's file plan.ts was changed outside the app, so it was not run.")).toBe(false);
  });

  it("code that does not compile, a module that is not here, and the app's own mistake: no", async () => {
    expect(promotionFixes(await sealedFailure("export default {"))).toBe(false);
    expect(promotionFixes(await sealedFailure(app("const x = notDefinedAnywhere + 1;", "() => x")))).toBe(false);
    expect(promotionFixes(await sealedFailure(app('import { width } from "https://esm.sh/unknown@1.0.0?bundle";', "() => String(width)")))).toBe(false);
  }, 60_000);
});

describe("what an app declares it asks for, read without running it", () => {
  const src = (permissions?: string) => `import { defineApp } from "potyro";
export default defineApp({ id: "p", name: "P", version: "1.0.0", schemaVersion: 1,${permissions ? ` permissions: ${permissions},` : ""} entities: {}, pages: [] });`;

  it("names every capability set to true, and none when there is no permissions object", async () => {
    expect(await declaredPermissions(src("{ camera: true, geo: false, notifications: true }"))).toEqual(["camera", "notifications"]);
    expect(await declaredPermissions(src())).toEqual([]);
  });

  it("is null — not 'nothing' — when it cannot be read literally", async () => {
    expect(await declaredPermissions(src("PERMS"))).toBeNull();
    expect(await declaredPermissions(src("{ ...PERMS }"))).toBeNull();
    expect(await declaredPermissions(src("{ camera: isPhone }"))).toBeNull();
    expect(await declaredPermissions("not a module {")).toBeNull();
  });
});
