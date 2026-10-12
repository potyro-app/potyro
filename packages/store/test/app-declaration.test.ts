// The card never runs code (#271): a package says what the app is in its manifest, and every writer
// of a package or a bundle puts it there.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { FN_MARKER, declareApp, packAppPackage, packBundle, readAppPackage } from "../src/index.js";

const SOURCE = `import { defineApp } from "potyro";\nexport default defineApp({ id: "piano" } as never);\n`;

describe("what an app declares, in the manifest", () => {
  const definition = {
    id: "dates",
    name: "Dates",
    icon: "📅",
    version: "1.0.0",
    schemaVersion: 1,
    __potyroApp: true,
    permissions: { notifications: true },
    entities: { day: { label: "Day", fields: { when: { type: "datetime" } }, computed: { label: (r: unknown) => String(r) } } },
    pages: [{ id: "all", title: "Days", view: { type: "list", entity: "day", filter: () => true } }],
  };

  it("functions become the isolate's marker, the builder's brand is dropped, the rest is as written", () => {
    const declared = declareApp(definition)!;
    expect(declared.id).toBe("dates");
    expect((declared.entities.day as { computed: { label: unknown } }).computed.label).toBe(FN_MARKER);
    expect((declared.pages[0] as { view: { filter: unknown } }).view.filter).toBe(FN_MARKER);
    expect(declared).not.toHaveProperty("__potyroApp");
    expect(JSON.parse(JSON.stringify(declared))).toEqual(declared);
  });

  it("a cycle is cut rather than thrown, and something that is not an app is not a declaration", () => {
    const cyclic: Record<string, unknown> = { ...definition };
    cyclic.self = cyclic;
    expect(declareApp(cyclic)!.self).toBeUndefined();
    expect(declareApp({ id: "x" })).toBeUndefined();
    expect(declareApp(null)).toBeUndefined();
  });

  it("round-trips through a package and through an export bundle", () => {
    const declared = declareApp(definition)!;
    expect(readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], declared })).declared).toEqual(declared);
    const bundle = packBundle({ sqlite: new Uint8Array([1]), manifest: { format: "potyro-bundle/1", app: declared } as never, appSource: SOURCE });
    expect(readAppPackage(bundle).declared).toEqual(declared);
  });

  it("a package without one, or with one that is not an app, has none — the card then reads the app", () => {
    expect(readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [] })).declared).toBeUndefined();
    const bad = zipSync({ "app.tsx": strToU8(SOURCE), "manifest.json": strToU8(JSON.stringify({ format: "potyro-app/1", app: { id: 3, pages: "no" } })) });
    expect(readAppPackage(bad).declared).toBeUndefined();
  });
});

describe("pnpm pack:app, the declaration", () => {
  const script = new URL("../../../scripts/pack-app.mjs", import.meta.url).pathname;
  const APP = `import { defineApp } from "potyro";
import Chart from "https://esm.sh/chart.js@4.4.1?bundle";
import { useState } from "react";
// Fine where the author packs it; the sealed box has no Intl, and that must not matter to the card.
const months = new Intl.DateTimeFormat("en", { month: "long" });
export default defineApp({
  id: "dates",
  name: "Dates",
  icon: "📅",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { notifications: true },
  entities: { day: { label: "Day", displayField: "title", fields: { title: { type: "text" } }, computed: { month: () => months.format(new Date()) } } },
  pages: [
    { id: "all", title: "Days", view: { type: "list", entity: "day", display: { primary: "title" } } },
    { id: "chart", title: "Chart", view: { type: "custom", entity: "day", render: () => { const [n] = useState(0); return String(n) + String(Chart); } } },
  ],
});
`;

  it("writes what the app declares, read where the author packs it", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-decl-"));
    writeFileSync(join(dir, "dates.app.tsx"), APP);
    execFileSync("node", [script, "dates.app.tsx", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
    const pkg = readAppPackage(new Uint8Array(readFileSync(join(dir, "out.zip"))));
    expect(pkg.declared).toMatchObject({ id: "dates", name: "Dates", icon: "📅", permissions: { notifications: true } });
    expect(Object.keys(pkg.declared!.entities)).toEqual(["day"]);
    expect((pkg.declared!.pages as Array<{ id: string }>).map((p) => p.id)).toEqual(["all", "chart"]);
    expect((pkg.declared!.entities.day as { computed: { month: unknown } }).computed.month).toBe(FN_MARKER);
  });

  it("an app that cannot be read where it is packed is still packed, without a declaration", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-app-nodecl-"));
    writeFileSync(join(dir, "x.app.ts"), 'import { defineApp } from "potyro";\nthrow new Error("not today");\nexport default defineApp({} as never);\n');
    const out = execFileSync("node", [script, "x.app.ts", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" }).toString();
    expect(out).toMatch(/out\.zip/);
    expect(readAppPackage(new Uint8Array(readFileSync(join(dir, "out.zip")))).declared).toBeUndefined();
  });
});
