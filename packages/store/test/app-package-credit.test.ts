// Who made an app travels in its package (docs/24 §6): a name, a maker when they showed it, a remix chain.
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { CREDIT_DEPTH, packAppPackage, parseCredit, readAppPackage } from "../src/index.js";

const SOURCE = `import { defineApp } from "potyro";\nexport default defineApp({ id: "piano" } as never);\n`;

describe("package credit", () => {
  it("round-trips a credit with its remix chain", () => {
    const credit = { name: "Piano week", by: "Ana", remixOf: { name: "Piano", by: "Jo" } };
    const pkg = readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], seed: undefined, chat: undefined, credit }));
    expect(pkg.credit).toEqual(credit);
  });

  it("is absent when the package says nothing", () => {
    expect(readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], seed: undefined, chat: undefined })).credit).toBeUndefined();
  });

  it("ignores a credit that is not one, and never refuses the app for it", () => {
    const zip = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "potyro-app/1", credit: { by: 42 } })), "app.tsx": strToU8(SOURCE) });
    const pkg = readAppPackage(zip);
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.credit).toBeUndefined();
  });

  it("trims, caps the text, and cuts a chain at its depth", () => {
    let raw: Record<string, unknown> = { name: "root" };
    for (let i = 0; i < 12; i++) raw = { name: `  remix ${i}  `, by: "x".repeat(500), remixOf: raw };
    const credit = parseCredit(raw)!;
    expect(credit.name).toBe("remix 11");
    expect(credit.by!.length).toBe(80);
    let depth = 0;
    for (let c: typeof credit | undefined = credit; c; c = c.remixOf) depth++;
    expect(depth).toBe(CREDIT_DEPTH);
  });
});
