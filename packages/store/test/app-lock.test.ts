import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  integrityOf,
  isPinned,
  isReservedPath,
  libraryHost,
  libraryLabel,
  LockError,
  moduleFileFor,
  parseLock,
  relativeImportsOf,
  sha256Hex,
  urlImportsOf,
} from "../src/index.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sha256", () => {
  it("matches node's own digest, with and without the platform's crypto", async () => {
    for (const s of ["", "abc", "a".repeat(1000), "é".repeat(77)]) {
      const want = createHash("sha256").update(s).digest("hex");
      expect(await sha256Hex(bytes(s))).toBe(want);
      expect(await sha256Hex(bytes(s), { platform: false })).toBe(want);
    }
  });

  it("names a module file by its digest and records SRI-style integrity", async () => {
    const data = bytes("export const x = 1;");
    const hex = createHash("sha256").update(data).digest("hex");
    const b64 = createHash("sha256").update(data).digest("base64");
    expect(await integrityOf(data)).toBe(`sha256-${b64}`);
    expect(await moduleFileFor(data)).toBe(`.modules/${hex}.js`);
  });
});

describe("library urls", () => {
  it("reads the name and exact version a URL pins", () => {
    expect(libraryLabel("https://esm.sh/chart.js@4.4.1?bundle")).toBe("chart.js 4.4.1");
    expect(libraryLabel("https://esm.sh/@kurkle/color@0.3.2/es2022/color.mjs")).toBe("@kurkle/color 0.3.2");
    expect(libraryLabel("https://cdn.example.test/lib.js")).toBe("cdn.example.test/lib.js");
    expect(libraryHost("https://esm.sh/chart.js@4.4.1?bundle")).toBe("esm.sh");
  });

  it("calls a URL pinned only when it names an exact version", () => {
    expect(isPinned("https://esm.sh/chart.js@4.4.1?bundle")).toBe(true);
    expect(isPinned("https://esm.sh/@kurkle/color@0.3.2")).toBe(true);
    expect(isPinned("https://esm.sh/tone@15.1.0-beta.2")).toBe(true);
    expect(isPinned("https://esm.sh/chart.js")).toBe(false);
    expect(isPinned("https://esm.sh/chart.js@4")).toBe(false);
    expect(isPinned("https://esm.sh/chart.js@^4.4.1")).toBe(false);
    expect(isPinned("https://esm.sh/chart.js@latest")).toBe(false);
  });

  it("finds the URL and relative imports a source makes, and nothing in comments or strings", () => {
    const source = `import { defineApp } from "potyro";
import Chart from "https://esm.sh/chart.js@4.4.1?bundle";
import { format } from 'https://esm.sh/date-fns@3.6.0?bundle';
import "https://esm.sh/side-effect@1.0.0";
export * from "./plan.js";
import type { Plan } from "./plan.js";
import { a } from "../outside.ts";
const lazy = () => import("https://esm.sh/lazy@2.0.0");
// import x from "https://esm.sh/commented@1.0.0";
const s = "from \\"https://esm.sh/in-a-string@1.0.0\\"";`;
    expect(urlImportsOf(source)).toEqual([
      "https://esm.sh/chart.js@4.4.1?bundle",
      "https://esm.sh/date-fns@3.6.0?bundle",
      "https://esm.sh/side-effect@1.0.0",
      "https://esm.sh/lazy@2.0.0",
    ]);
    expect(relativeImportsOf(source)).toEqual(["./plan.js", "../outside.ts"]);
  });
});

describe("the lock", () => {
  const entry = { file: ".modules/" + "a".repeat(64) + ".js", integrity: "sha256-abc=", size: 12 };

  it("reads a lock.json", () => {
    expect(parseLock(JSON.stringify({ "https://esm.sh/x@1.0.0": entry }))).toEqual({ "https://esm.sh/x@1.0.0": entry });
    expect(parseLock(JSON.stringify({ "https://esm.sh/x@1.0.0": { ...entry, base: "https://esm.sh/x@1.0.1" } }))["https://esm.sh/x@1.0.0"]!.base).toBe(
      "https://esm.sh/x@1.0.1",
    );
  });

  it("refuses a lock that could point outside the app's own module files", () => {
    expect(() => parseLock("[]")).toThrow(LockError);
    expect(() => parseLock("{")).toThrow(/not valid JSON/);
    expect(() => parseLock(JSON.stringify({ "https://esm.sh/x@1.0.0": { ...entry, file: "plan.json" } }))).toThrow(/\.modules/);
    expect(() => parseLock(JSON.stringify({ "https://esm.sh/x@1.0.0": { ...entry, integrity: "md5-x" } }))).toThrow(/sha256/);
    expect(() => parseLock(JSON.stringify({ "ftp://x": entry }))).toThrow(/https/);
  });

  it("reads the app's own modules from a lock too, each only at its own place in .src/ (#282)", () => {
    const own = { file: ".src/lib/plan.ts", integrity: "sha256-abc=", size: 3 };
    expect(parseLock(JSON.stringify({ "src/lib/plan.ts": own }))).toEqual({ "src/lib/plan.ts": own });
    expect(() => parseLock(JSON.stringify({ "src/plan.ts": { ...own, file: ".src/other.ts" } }))).toThrow(/\.src\/plan\.ts/);
    expect(() => parseLock(JSON.stringify({ "src/plan.ts": { ...own, file: "plan.json" } }))).toThrow(/\.src\/plan\.ts/);
    expect(() => parseLock(JSON.stringify({ "src/../plan.json": { ...own, file: ".src/../plan.json" } }))).toThrow(LockError);
    expect(() => parseLock(JSON.stringify({ "src/": { ...own, file: ".src/" } }))).toThrow(LockError);
  });

  it("keeps the app's code folders out of reach of the app", () => {
    expect(isReservedPath(".modules/abc.js")).toBe(true);
    expect(isReservedPath(".src/plan.ts")).toBe(true);
    expect(isReservedPath("plan.json")).toBe(false);
    expect(isReservedPath("notes/.modules.md")).toBe(false);
  });
});
