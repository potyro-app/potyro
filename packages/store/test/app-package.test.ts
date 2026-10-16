// App packages (#253): source + shipped files + a one-time seed, as one zip.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { AppPackageError, isZip, packAppPackage, packBundle, readAppPackage } from "../src/index.js";

const SOURCE = `import { defineApp } from "potyro";\nexport default defineApp({ id: "piano" } as never);\n`;
const plan = strToU8('{"weeks":12}');

describe("app packages", () => {
  it("round-trip: source, files in folders, and the seed", () => {
    const zip = packAppPackage({
      source: SOURCE,
      sourceName: "piano.app.tsx",
      files: [
        { path: "plan.json", data: plan },
        { path: "img/hands.png", data: new Uint8Array([137, 80, 78, 71]) },
      ],
      seed: { session: [{ minutes: 20 }] },
    });
    expect(isZip(zip)).toBe(true);

    const pkg = readAppPackage(zip);
    expect(pkg.kind).toBe("package");
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.sourceName).toBe("app.tsx");
    expect(pkg.files.map((f) => f.path).sort()).toEqual(["img/hands.png", "plan.json"]);
    expect(pkg.files.find((f) => f.path === "img/hands.png")!.data).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(pkg.seed).toEqual({ session: [{ minutes: 20 }] });
  });

  it("carries how the app was made when the author chose to include it, and nothing when not (#261)", () => {
    const chat = { format: "potyro-chat/1", messages: [{ at: "2026-10-11T00:00:00.000Z", kind: "ask", text: "a piano practice log" }] };
    const withChat = readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], chat }));
    expect(withChat.chat).toEqual(chat);
    // `chat.json` is not one of the app's shipped files: it is about the app, not in it.
    expect(withChat.files).toEqual([]);
    expect(readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [] })).chat).toBeUndefined();

    // An export bundle carries it the same way.
    const bundle = packBundle({
      sqlite: new Uint8Array([1]),
      manifest: { format: "potyro-bundle/1" } as never,
      appSource: SOURCE,
      chat,
    });
    expect(readAppPackage(bundle).chat).toEqual(chat);
  });

  it("a conversation that is not JSON is dropped, never fatal — the app is what was asked for", () => {
    const zip = zipSync({ "app.tsx": strToU8(SOURCE), "chat.json": strToU8("{not json") });
    const pkg = readAppPackage(zip);
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.chat).toBeUndefined();
  });

  it("reads a zip made by hand: one wrapping folder, a *.app.tsx source, no manifest", () => {
    const zip = zipSync({ "piano/piano.app.tsx": strToU8(SOURCE), "piano/files/plan.json": plan });
    const pkg = readAppPackage(zip);
    expect(pkg.sourceName).toBe("piano.app.tsx");
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("reads an export bundle as an app to install, without its data files", () => {
    const zip = packBundle({
      sqlite: new Uint8Array([1, 2, 3]),
      manifest: { format: "potyro-bundle/1", appId: "piano", appVersion: "1", schemaVersion: 1, provenance: "trusted", grantedCaps: [], mode: "snapshot", exportedAt: "2026-10-11", entities: [] },
      appSource: SOURCE,
    });
    const pkg = readAppPackage(zip);
    expect(pkg.kind).toBe("bundle");
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.files).toEqual([]);
  });

  it("says what is wrong: not a zip, no source, a seed that is not records", () => {
    expect(() => readAppPackage(strToU8("hello"))).toThrow(AppPackageError);
    expect(() => readAppPackage(zipSync({ "readme.md": strToU8("x") }))).toThrow(/No app source/);
    expect(() => readAppPackage(zipSync({ "app.ts": strToU8(SOURCE), "seed.json": strToU8('{"a":1}') }))).toThrow(/"a" must be a list of records/);
  });
});

describe("modules and libraries (#258, #266)", () => {
  const lib = strToU8("export const x = 1;");
  const libFile = ".modules/" + "b".repeat(64) + ".js";
  const lock = { "https://esm.sh/x@1.0.0?bundle": { file: libFile, integrity: "sha256-abc=", size: lib.byteLength } };

  it("round-trip: the package's own modules apart from its files, and the lock beside them", () => {
    const zip = packAppPackage({
      source: SOURCE,
      sourceName: "app.tsx",
      files: [
        { path: "plan.json", data: plan },
        { path: libFile, data: lib },
      ],
      modules: [
        { path: "plan.ts", data: strToU8("export const weeks = 12;") },
        { path: "lib/progress.ts", data: strToU8("export {};") },
      ],
      lock,
    });
    const pkg = readAppPackage(zip);
    expect(pkg.modules.map((m) => m.path).sort()).toEqual(["lib/progress.ts", "plan.ts"]);
    expect(pkg.files.map((f) => f.path).sort()).toEqual([libFile, "plan.json"]);
    expect(pkg.lock).toEqual(lock);
  });

  it("a package with neither has none", () => {
    const pkg = readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [] }));
    expect(pkg.modules).toEqual([]);
    expect(pkg.lock).toBeUndefined();
  });

  it("refuses a lock that would point a library at the app's data", () => {
    const zip = zipSync({
      "app.ts": strToU8(SOURCE),
      "lock.json": strToU8(JSON.stringify({ "https://esm.sh/x@1.0.0": { file: "plan.json", integrity: "sha256-a=", size: 1 } })),
    });
    expect(() => readAppPackage(zip)).toThrow(/\.modules/);
  });
});

describe("an export bundle carries the app's code (#282)", () => {
  const lib = strToU8("export const x = 1;");
  const libFile = ".modules/" + "c".repeat(64) + ".js";
  const plan = strToU8("export const weeks = 12;");
  const lock = {
    "https://esm.sh/x@1.0.0?bundle": { file: libFile, integrity: "sha256-abc=", size: lib.byteLength },
    "src/plan.ts": { file: ".src/plan.ts", integrity: "sha256-def=", size: plan.byteLength },
  };
  const bundle = (extra: Record<string, unknown> = {}) =>
    packBundle({
      sqlite: new Uint8Array([1, 2, 3]),
      manifest: { format: "potyro-bundle/1", appId: "piano", appVersion: "1", schemaVersion: 1, provenance: "trusted", grantedCaps: [], mode: "snapshot", exportedAt: "2026-10-13", entities: [] },
      appSource: SOURCE,
      ...extra,
    });

  it("reads back the whole lock, the library bytes and the app's own modules, as a package carries them", () => {
    const pkg = readAppPackage(
      bundle({
        lock,
        code: [
          { path: libFile, data: lib },
          { path: ".src/plan.ts", data: plan },
        ],
      }),
    );
    expect(pkg.kind).toBe("bundle");
    expect(pkg.lock).toEqual(lock);
    expect(pkg.files).toEqual([{ path: libFile, data: lib }]);
    expect(pkg.modules).toEqual([{ path: "plan.ts", data: plan }]);
    // A bundle has no seed: its records are its data, restored by Import.
    expect(pkg.seed).toBeUndefined();
  });

  it("carries only the app's code: a file of its data handed in as code is not packed", () => {
    const pkg = readAppPackage(bundle({ lock, code: [{ path: "notes/plan.json", data: plan }] }));
    expect(pkg.files).toEqual([]);
    expect(pkg.modules).toEqual([]);
  });

  it("a bundle of an app with no libraries or modules has no lock", () => {
    expect(readAppPackage(bundle()).lock).toBeUndefined();
    expect(readAppPackage(bundle({ lock: {}, code: [] })).lock).toBeUndefined();
  });
});

describe("pnpm pack:app", () => {
  const script = new URL("../../../scripts/pack-app.mjs", import.meta.url).pathname;

  it("packs the modules the source imports into src/, following their own imports, and only those", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-src-"));
    writeFileSync(
      join(dir, "piano.app.tsx"),
      'import { defineApp } from "potyro";\nimport { weeks } from "./plan.js";\nimport type { P } from "./types";\nexport default defineApp({ id: "piano", weeks } as never);\n',
    );
    writeFileSync(join(dir, "plan.ts"), 'import { clamp } from "./util/clamp.ts";\nexport const weeks = clamp(12);\n');
    mkdirSync(join(dir, "util"));
    writeFileSync(join(dir, "util", "clamp.ts"), "export const clamp = (n: number) => n;\n");
    writeFileSync(join(dir, "types.ts"), "export type P = number;\n");
    writeFileSync(join(dir, "unused.ts"), "export const nope = 1;\n");
    writeFileSync(join(dir, "plan.json"), '{"weeks":12}');

    execFileSync("node", [script, "piano.app.tsx", "plan.json", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir } });

    const pkg = readAppPackage(new Uint8Array(readFileSync(join(dir, "out.zip"))));
    // `types.ts` is imported for a type only: nothing of it runs, so it is not part of the app.
    expect(pkg.modules.map((m) => m.path).sort()).toEqual(["plan.ts", "util/clamp.ts"]);
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("refuses a module import that leaves the app's folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-out-"));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "x.app.ts"), 'import { y } from "../y.ts";\nexport default y;\n');
    writeFileSync(join(dir, "y.ts"), "export const y = 1;\n");
    expect(() => execFileSync("node", [script, "app/x.app.ts", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" })).toThrow(/outside/);
  });

  // An app in six languages names itself with a Words map (#302): its description must still travel.
  it("describes an app whose name is a name per language, and says the real reason when it cannot", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-words-"));
    writeFileSync(
      join(dir, "mm.app.ts"),
      'import { defineApp } from "potyro";\nexport default defineApp({ id: "mm", name: { en: "Mirror Monsters", de: "Spiegelmonster" }, version: "1.0.0", schemaVersion: 1, language: "en", languages: ["en", "de"], entities: {}, pages: [] } as never);\n',
    );
    const run = (file: string) => execFileSync("node", [script, file, "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe", encoding: "utf8" });
    const warned = (file: string) => {
      const r = spawnSync("node", [script, file, "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, encoding: "utf8" });
      return r.stderr;
    };
    expect(warned("mm.app.ts")).not.toMatch(/packed without a description/);
    run("mm.app.ts");
    const pkg = readAppPackage(new Uint8Array(readFileSync(join(dir, "out.zip"))));
    expect(pkg.declared?.name).toEqual({ en: "Mirror Monsters", de: "Spiegelmonster" });

    // One that is not an app is told why, and is never told it does not export one when it does.
    writeFileSync(join(dir, "noid.app.ts"), 'import { defineApp } from "potyro";\nexport default defineApp({ name: "No id", entities: {}, pages: [] } as never);\n');
    expect(warned("noid.app.ts")).toMatch(/Invalid app definition: - id: Required/);
    expect(warned("noid.app.ts")).not.toMatch(/does not export an app/);
    writeFileSync(join(dir, "none.app.ts"), "export default undefined;\n");
    expect(warned("none.app.ts")).toMatch(/does not export an app/);
  });
});

describe("pnpm pack:app, files", () => {
  it("makes a zip the real reader installs: source, loose files, a folder, and the seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-"));
    writeFileSync(join(dir, "piano.app.tsx"), SOURCE);
    writeFileSync(join(dir, "plan.json"), '{"weeks":12}');
    mkdirSync(join(dir, "assets", "img"), { recursive: true });
    writeFileSync(join(dir, "assets", "img", "hands.png"), new Uint8Array([137, 80]));
    writeFileSync(join(dir, "seed.json"), '{"session":[{"minutes":20}]}');
    const script = new URL("../../../scripts/pack-app.mjs", import.meta.url).pathname;

    execFileSync("node", [script, "piano.app.tsx", "plan.json", "--files", "assets", "--seed", "seed.json", "-o", "out.zip"], {
      cwd: dir,
      env: { ...process.env, INIT_CWD: dir },
    });

    const pkg = readAppPackage(new Uint8Array(readFileSync(join(dir, "out.zip"))));
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.sourceName).toBe("app.tsx");
    expect(pkg.files.map((f) => f.path).sort()).toEqual(["img/hands.png", "plan.json"]);
    expect(pkg.seed).toEqual({ session: [{ minutes: 20 }] });
  });
});
