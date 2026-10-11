import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkReferences, isKartaApp } from "karta";
import app from "../piano.app.js";
import { build } from "../build.mjs";

describe("the piano app", () => {
  it("is a valid Karta app with no lesson text of its own", async () => {
    expect(isKartaApp(app)).toBe(true);
    expect(app.id).toBe("piano");
    expect(checkReferences(app)).toEqual([]);
    expect(app.pages.map((p) => p.id)).toEqual(["today", "log", "plan", "modules", "weeklog", "sessions", "session"]);
    expect(app.entities.weekLog!.fields).toMatchObject({ daysPractised: { type: "number" }, recorded: { type: "text" }, tempoBpm: { type: "number" }, fix: { type: "text" }, notes: { type: "text" } });
    // The UI must not hardcode lesson content: no "done when" or exercise text appears in the source.
    const source = await readFile(new URL("../piano.app.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/five-finger|flowkey|musictheory|Minuet/i);
  });
});

describe("the built file", () => {
  it("is a single module importing only karta and react", async () => {
    const text = await build();
    const imports = [...text.matchAll(/^import\s[\s\S]*?\sfrom\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.every((s) => s === "karta" || s === "react" || s.startsWith("react/"))).toBe(true);
    expect(text).not.toMatch(/^export\s(?!default)/m);
    expect(text).toContain('"id": "piano-6-months"');
    expect(text).toContain("function validatePlan(");
    expect(text).toContain("function goalMet(");
  });

  it("still defines the same app once inlined", async () => {
    // Built into dist/ for real: it is the file that gets imported, and `pnpm typecheck` covers it.
    const file = fileURLToPath(new URL("../dist/piano.app.tsx", import.meta.url));
    await mkdir(fileURLToPath(new URL("../dist/", import.meta.url)), { recursive: true });
    await writeFile(file, await build());
    const built = (await import(/* @vite-ignore */ file)) as { default: typeof app };
    expect(isKartaApp(built.default)).toBe(true);
    expect(checkReferences(built.default)).toEqual([]);
    expect(built.default.pages.map((p) => p.id)).toEqual(app.pages.map((p) => p.id));
  });
});
