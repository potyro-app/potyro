import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
// @ts-expect-error — plain JS modules, no types
import { create, slugOf, titleOf } from "../index.mjs";
// @ts-expect-error — plain JS modules, no types
import { pack } from "../../schema/cli/pack.mjs";

// Scaffolded INSIDE this package, so `import … from "potyro"` in the new app resolves to the
// workspace's, as it will to the one npm installs beside a real one.
const root = mkdtempSync(join(import.meta.dirname, "..", ".scaffold-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("npm create potyro", () => {
  it("names the app after its folder", () => {
    expect(slugOf("Reading List")).toBe("reading-list");
    expect(slugOf("./apps/Café_Notes")).toBe("cafe-notes");
    expect(titleOf("reading-list")).toBe("Reading list");
  });

  it("writes an app that is valid, packs, and installs as itself", async () => {
    const dir = join(root, "reading-list");
    const written = create(dir);
    expect(written).toEqual([".gitignore", "README.md", "package.json", "reading-list.app.ts", "test/app.test.ts", "tsconfig.json"]);
    const source = readFileSync(join(dir, "reading-list.app.ts"), "utf8");
    expect(source).not.toMatch(/__[A-Z_]+__/);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.devDependencies.potyro).toMatch(/^\^\d+\.\d+\.\d+$/);

    // The app module itself: `defineApp` throws on a wrong shape, so importing it is the check.
    const app = (await import(join(dir, "reading-list.app.ts"))).default;
    expect(app.id).toBe("reading-list");
    expect(app.name).toBe("Reading list");

    const zip = await pack([], { cwd: dir, log: () => {}, warn: (m: string) => { throw new Error(m); } });
    expect(zip).toBe(join(dir, "reading-list.potyro-app.zip"));
    const entries = unzipSync(readFileSync(zip));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));
    expect(manifest.source).toBe("app.ts");
    expect(manifest.app.id).toBe("reading-list");
    expect(Object.keys(manifest.app.entities)).toEqual(["thing"]);
  });

  it("typechecks as written, under its own strict tsconfig", () => {
    const dir = join(root, "typed");
    create(dir);
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    // Throws with tsc's output when the template does not typecheck.
    execFileSync(process.execPath, [tsc, "--noEmit", "-p", join(dir, "tsconfig.json")], { encoding: "utf8" });
  }, 60_000);

  it("refuses a folder that already has something in it", () => {
    const dir = join(root, "taken");
    create(dir);
    expect(() => create(dir)).toThrow(/not empty/);
    expect(existsSync(join(dir, "taken.app.ts"))).toBe(true);
  });
});
