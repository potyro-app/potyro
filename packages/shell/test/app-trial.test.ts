// The test load at install, for real (#271): the app bundled as the sealed box runs it, loaded in
// QuickJS, and put through the smoke run. What QuickJS lacks is named the way the card names it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleAppSource, type AppBundler, type EsbuildLike } from "../src/app-bundler.js";
import { trySealed as trySealedWith, type TrialOptions } from "../src/app-trial.js";
import { memoryModules } from "../src/package-modules.js";
import { lockEntryFor, moduleFileFor } from "@potyro/store";

// The isolate bundle as the browser makes it, with Node's esbuild in place of esbuild-wasm.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = { potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"), react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8") };
const bundler: AppBundler = (source, modules, opts) => bundleAppSource(source, { build } as unknown as EsbuildLike, stubs, modules, opts);
const trySealed = (source: string, _modules: undefined, opts: TrialOptions) => trySealedWith(source, undefined, { ...opts, bundler });

const app = (body: string, top = "") => `import { defineApp } from "potyro";
${top}
export default defineApp({
  id: "trial",
  name: "Trial",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { day: { label: "Day", displayField: "title", fields: { title: { type: "text" }, amount: { type: "number" } }, computed: { shown: ${body} } } },
  pages: [{ id: "all", title: "Days", view: { type: "list", entity: "day", display: { primary: "title", secondary: "shown" } } }],
});
`;

describe("a test load in the sealed box", () => {
  it("an app that only needs what the box has loads, and nothing is missing", async () => {
    const trial = await trySealed(app("(d) => String(d.amount ?? 0)"), undefined, { smoke: true });
    expect(trial.loadFailed).toBeUndefined();
    expect(trial.issues).toEqual([]);
    expect((trial.definition as { name: string }).name).toBe("Trial");
    expect(trial.missing).toEqual([]);
  }, 60_000);

  it("a computed value that formats numbers is caught by running it on sample records", async () => {
    const trial = await trySealed(app('(d) => new Intl.NumberFormat("en").format(d.amount ?? 0)'), undefined, { smoke: true });
    expect(trial.loadFailed).toBeUndefined();
    expect(trial.missing).toEqual(["date and number formatting (Intl)"]);
  }, 60_000);

  it("a top level that needs Intl does not load there, and says what it lacks", async () => {
    const trial = await trySealed(app("() => months.format(new Date())", 'const months = new Intl.DateTimeFormat("en", { month: "long" });'), undefined, { smoke: true });
    expect(trial.definition).toBeUndefined();
    expect(trial.loadFailed).toMatch(/Intl/);
    expect(trial.missing).toEqual(["date and number formatting (Intl)"]);
  }, 60_000);

  it("a library that needs Intl while it loads is named, with what it lacks", async () => {
    const url = "https://esm.sh/month-names@1.0.0?bundle";
    const bytes = new TextEncoder().encode('export const months = new Intl.DateTimeFormat("en", { month: "long" });\n');
    const file = await moduleFileFor(bytes);
    const modules = memoryModules({ [url]: await lockEntryFor(file, bytes) }, new Map([[file, bytes]]));
    const source = app("() => String(months)", `import { months } from "${url}";`);
    const trial = await trySealedWith(source, modules, { smoke: true, bundler });
    expect(trial.libraryProblem).toBe(
      "month-names 1.0.0 uses a feature shared apps don’t have yet: date and number formatting (Intl). Apps in the sealed box do not get it, so this app can only run as yours.",
    );
    expect(trial.missing).toEqual(["date and number formatting (Intl)"]);
  }, 60_000);

  it("source that does not compile is unreadable, not a failure to load", async () => {
    const trial = await trySealed("export default {", undefined, { smoke: true });
    expect(trial.unreadable).toBeTruthy();
    expect(trial.loadFailed).toBeUndefined();
  }, 60_000);
});
