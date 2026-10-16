import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots } from "potyro";
import app from "../draw-guess.app.js";
import { W } from "../ui-words.js";

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && f !== "vitest.config.ts")
  .map((f) => ({ f, text: readFileSync(new URL(f, dir), "utf8") }));
const all = sources.map((s) => s.text).join("\n");

describe("Draw & Guess", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("reaches the network only through ctx.caps.network.room, and asks for Potyro's rooms and nothing else (CLAUDE.md rules 2, 6)", () => {
    expect(app.permissions).toEqual({ network: { rooms: true } });
    expect(all).toContain("ctx.caps.network?.room");
    expect(all).not.toMatch(/new WebSocket|fetch\(|XMLHttpRequest|EventSource|RTCPeerConnection|https?:\/\/(?!.*example)/);
  });

  it("draws on a canvas in a custom view, and keeps finished games as records a built-in list shows", () => {
    expect(app.pages.map((p) => [p.id, p.view.type])).toEqual([
      ["play", "custom"],
      ["games", "list"],
    ]);
    expect(Object.keys(app.entities.game!.fields)).toEqual(["title", "date", "players", "place", "score"]);
  });

  it("imports only potyro and its own modules (lint:boundaries)", () => {
    for (const { f, text } of sources) for (const m of text.matchAll(/from "([^"]+)"/g)) expect(m[1]!, f).toMatch(/^(potyro|\.\/[\w-]+\.js)$/);
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

  it("says every word the screens show in all six languages, with the same placeholders in each", () => {
    const entries = Object.entries(W);
    expect(entries.length).toBeGreaterThan(80);
    for (const [key, words] of entries) {
      expect(Object.keys(words).sort(), key).toEqual(["de", "en", "es", "it", "pl", "pt-BR"]);
      const holes = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
      for (const [lang, text] of Object.entries(words)) {
        expect(text.trim().length, `${key}.${lang}`).toBeGreaterThan(0);
        expect(holes(text), `${key}.${lang}`).toEqual(holes(words.en));
      }
    }
  });
});
