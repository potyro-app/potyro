import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readAppPackage } from "@potyro/store";
import { bundleAppSource, bundleTrustedWith, type EsbuildLike } from "../src/app-bundler.js";
import { moduleFiles } from "../src/package-libraries.js";
import { memoryModules } from "../src/package-modules.js";

// An app made of several files with no build step of its own (#258): `pnpm pack:app` packs the entry
// as written, the modules it imports as the package's `src/`, and data files in `files/`. The shell
// bundles it — sealed and as the person's own — resolving `./plan.js` from `src/`.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};
const esbuild = { build } as unknown as EsbuildLike;

const ENTRY = `import { defineApp } from "potyro";
import { weeks } from "./plan.js";
import { label } from "./lib/label.js";
export default defineApp({ id: "practice", name: label(weeks), version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] } as never);
`;

function pack() {
  const dir = mkdtempSync(join(tmpdir(), "package-src-"));
  mkdirSync(join(dir, "lib"));
  writeFileSync(join(dir, "practice.app.tsx"), ENTRY);
  writeFileSync(join(dir, "plan.ts"), "export const weeks: number = 12;\n");
  writeFileSync(join(dir, "lib/label.ts"), 'export const label = (n: number): string => "Practice " + n + " weeks";\n');
  writeFileSync(join(dir, "plan.json"), '{"weeks":12}');
  execFileSync("node", [here("../../../scripts/pack-app.mjs"), "practice.app.tsx", "plan.json", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
  return readAppPackage(readFileSync(join(dir, "out.zip")));
}

describe("a package with its own modules", () => {
  it("carries the entry as written, its modules in src/ and its data in files/", () => {
    const pkg = pack();
    expect(pkg.source).toBe(ENTRY);
    expect(pkg.modules.map((m) => m.path).sort()).toEqual(["lib/label.ts", "plan.ts"]);
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("bundles in the sealed box and as the person's own, from its own modules", async () => {
    const pkg = pack();
    const own = await moduleFiles(pkg.modules);
    const modules = memoryModules(own.lock, new Map(own.files.map((f) => [f.path, f.data])));
    const g: Record<string, unknown> = {};
    new Function("globalThis", await bundleAppSource(pkg.source, esbuild, stubs, modules))(g);
    expect((g.__potyroApp as { name?: string }).name).toBe("Practice 12 weeks");
    expect(await bundleTrustedWith(pkg.source, esbuild, modules)).toContain('"Practice "');
  });

  it("without its modules it cannot be bundled", async () => {
    await expect(bundleAppSource(pack().source, esbuild, stubs)).rejects.toThrow(/This app imports "\.\/(plan|lib\/label)\.js" from another file/);
  });
});
