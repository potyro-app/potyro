import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readAppPackage } from "@potyro/store";
import { bundleAppSource, bundleTrustedWith, type EsbuildLike } from "../src/app-bundler.js";
import { moduleFiles } from "../src/package-libraries.js";
import { memoryModules } from "../src/package-modules.js";

// The piano app with no build step of its own (#258): `pnpm pack:app` packs piano.app.tsx as it is in
// the repo, its helpers as the package's `src/`, and plan.json as data in `files/`. The shell then
// bundles it — in the sealed box and as the person's own — resolving `./plan.js` from `src/`.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const PIANO = here("../../../apps/piano");
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;

function pack() {
  const out = join(mkdtempSync(join(tmpdir(), "piano-")), "piano.potyro-app.zip");
  execFileSync("node", [here("../../../scripts/pack-app.mjs"), "piano.app.tsx", "plan.json", "-o", out], { cwd: PIANO, env: { ...process.env, INIT_CWD: PIANO }, stdio: "pipe" });
  return readAppPackage(readFileSync(out));
}

describe("the piano app's package", () => {
  it("carries the source as written, its helpers in src/ and the plan in files/", () => {
    const pkg = pack();
    expect(pkg.source).toBe(readFileSync(join(PIANO, "piano.app.tsx"), "utf8"));
    expect(pkg.modules.map((m) => m.path).sort()).toEqual(["plan.ts", "progress.ts", "styles.ts"]);
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
    expect(pkg.lock).toBeUndefined();
  });

  it("bundles in the sealed box and as the person's own, from its own modules and nothing else", async () => {
    const pkg = pack();
    const own = await moduleFiles(pkg.modules);
    const modules = memoryModules(own.lock, new Map(own.files.map((f) => [f.path, f.data])));
    const sealed = await bundleAppSource(pkg.source, esbuild, stubs, modules);
    expect(sealed).toContain("function validatePlan(");
    expect(sealed).toContain("function goalMet(");
    const g: Record<string, unknown> = {};
    new Function("globalThis", sealed)(g);
    expect((g.__potyroApp as { id?: string }).id).toBe("piano");
    const trusted = await bundleTrustedWith(pkg.source, esbuild, modules);
    expect(trusted).toContain("function validatePlan(");
  });

  it("without its modules the shell cannot bundle it — the reason the old build step inlined them", async () => {
    await expect(bundleAppSource(pack().source, esbuild, stubs)).rejects.toThrow(/plan\.js/);
  });
});
