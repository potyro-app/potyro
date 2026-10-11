// App packages (#253): source + shipped files + a one-time seed, as one zip.
import { describe, expect, it } from "vitest";
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
