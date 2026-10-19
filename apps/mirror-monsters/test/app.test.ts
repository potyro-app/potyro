import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots } from "potyro";
import app from "../mirror-monsters.app.js";
import { MODES } from "../monsters.js";

const source = readFileSync(new URL("../mirror-monsters.app.ts", import.meta.url), "utf8");

describe("Mirror Monsters", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("declares the camera, and reaches it only through ctx.caps.camera.live (CLAUDE.md rule 2)", () => {
    expect(app.permissions?.camera).toBe(true);
    expect(source).toContain("ctx.caps.camera?.live");
    expect(source).not.toMatch(/navigator\.|mediaDevices|getUserMedia/);
    // Nothing leaves the device: no network, no AI, no URL import.
    expect(app.permissions?.network).toBeUndefined();
    expect(source).not.toMatch(/caps\.network|caps\.ai|https:\/\//);
  });

  it("stops the camera when its view goes, and listens for the shell stopping it", () => {
    expect(source).toContain("cam?.stop()");
    expect(source).toContain("onStop(onStopped)");
  });

  it("keeps a snap as a record pointing at a PNG in its own folder", () => {
    const fields = app.entities.snap!.fields;
    expect(fields.image).toMatchObject({ type: "file", folder: "snaps" });
    expect(fields.monster).toMatchObject({ type: "enum", options: [...MODES] });
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(["en", "pt-BR", "de", "es", "pl", "it"]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("carries a catalog for each other language, in step with its code, every word translated, every placeholder kept (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source: code, modules } = readAppSources(fileURLToPath(new URL("../mirror-monsters.app.ts", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source: code, modules, catalogs, same: /^(\S{1,5}|Mirror Monsters)$/ })).toEqual([]);
  });
});
