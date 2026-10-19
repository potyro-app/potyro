import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps, wordSlots } from "potyro";
import app from "../piano.app.js";

describe("the piano app", () => {
  it("is a valid Potyro app with no lesson text of its own", async () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(app.id).toBe("piano");
    expect(checkReferences(app)).toEqual([]);
    expect(app.pages.map((p) => p.id)).toEqual(["today", "log", "plan", "modules", "weeklog", "sessions", "session"]);
    expect(app.entities.weekLog!.fields).toMatchObject({ daysPractised: { type: "number" }, recorded: { type: "text" }, tempoBpm: { type: "number" }, fix: { type: "text" }, notes: { type: "text" } });
    // The UI must not hardcode lesson content: no "done when" or exercise text appears in the source.
    const source = await readFile(new URL("../piano.app.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/five-finger|flowkey|musictheory|Minuet/i);
  });
});

// There is no build step of its own any more (#258): `pnpm --filter @potyro/app-piano build` packs
// piano.app.tsx as written, its helpers in src/ and plan.json in files/ — checked by
// packages/shell/test/piano-package.test.ts, which also bundles the package the way the shell does.

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(["en", "pt-BR", "de", "es", "pl", "it"]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("carries a catalog for each other language, in step with its code, every word translated (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source, modules } = readAppSources(fileURLToPath(new URL("../piano.app.tsx", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source, modules, catalogs, same: /^(\S{1,5})$/ })).toEqual([]);
  });
});
