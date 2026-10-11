// App packages (#253): source + shipped files + a one-time seed, as one zip.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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

describe("pnpm pack:app", () => {
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
