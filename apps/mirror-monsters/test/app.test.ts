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

  it("has no plain words in its declared slots", () => {
    const plain = wordSlots(app)
      .filter((s) => typeof s.value === "string")
      .map((s) => s.value as string);
    for (const p of plain) expect(p, p).toMatch(/^\S{1,5}$/);
  });

  it("says every word the screens show in all six languages", () => {
    // ctx.t({ en: …, … }) maps in the source: each has the five other languages beside English.
    const maps = [...source.matchAll(/\{\s*en: "[^"]*"[^{}]*\}/g)].map((m) => m[0]);
    expect(maps.length).toBeGreaterThan(20);
    for (const m of maps) for (const lang of ['"pt-BR":', "de:", "es:", "pl:", "it:"]) expect(m, m).toContain(lang);
  });
});
