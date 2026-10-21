import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps } from "potyro";
import app, { contentOf, EMPTY, fieldsOf, KINDS, suggestedLabel } from "../qr-maker.app.js";
import { W } from "../words.js";

const source = readFileSync(new URL("../qr-maker.app.ts", import.meta.url), "utf8");
const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;

describe("QR Maker", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps a code as a record with its picture in its own folder, and shares through ctx", () => {
    const fields = app.entities.code!.fields;
    expect(fields.label).toMatchObject({ type: "text", required: true });
    expect(fields.kind).toMatchObject({ type: "enum", options: KINDS });
    expect(fields.image).toMatchObject({ type: "file", folder: "codes" });
    expect(source).toContain("ctx.ui.share");
    expect(source).toContain("ctx.files.export");
    expect(source).not.toMatch(/fetch\(|navigator\.clipboard|import\(/);
  });

  it("has a Make screen first, a Kept screen, a tile and a demo", () => {
    expect(app.pages.map((p) => p.id)).toEqual(["make", "kept"]);
    expect(typeof app.tile).toBe("function");
    expect(typeof app.demo).toBe("function");
  });
});

describe("what a code says", () => {
  it("a link gets https:// when none was typed, and keeps a scheme that was", () => {
    expect(contentOf("link", { ...EMPTY, link: "potyro.app/gallery" })).toBe("https://potyro.app/gallery");
    expect(contentOf("link", { ...EMPTY, link: " http://example.org " })).toBe("http://example.org");
    expect(contentOf("link", { ...EMPTY, link: "mailto:a@b.c" })).toBe("mailto:a@b.c");
    expect(contentOf("link", EMPTY)).toBe("");
  });

  it("a Wi‑Fi network is the string phones read, with its special characters escaped", () => {
    expect(contentOf("wifi", { ...EMPTY, ssid: "Café Guest", password: "cr0issant!", security: "WPA" })).toBe("WIFI:T:WPA;S:Café Guest;P:cr0issant!;;");
    expect(contentOf("wifi", { ...EMPTY, ssid: "a;b", password: 'p"q', security: "WEP" })).toBe('WIFI:T:WEP;S:a\\;b;P:p\\"q;;');
    expect(contentOf("wifi", { ...EMPTY, ssid: "Open net", password: "ignored", security: "nopass" })).toBe("WIFI:T:nopass;S:Open net;;");
    expect(contentOf("wifi", { ...EMPTY, password: "x" })).toBe("");
  });

  it("a contact is a small vCard", () => {
    expect(contentOf("contact", { ...EMPTY, name: "Ana Lima", phone: "+351 912 345 678", email: "ana@example.org" })).toBe("BEGIN:VCARD\nVERSION:3.0\nN:Ana Lima;;;\nFN:Ana Lima\nTEL:+351 912 345 678\nEMAIL:ana@example.org\nEND:VCARD");
    expect(contentOf("contact", EMPTY)).toBe("");
  });

  it("suggests a name from what it says", () => {
    expect(suggestedLabel("link", { ...EMPTY, link: "https://www.potyro.app/x" })).toBe("potyro.app");
    expect(suggestedLabel("wifi", { ...EMPTY, ssid: "Home" })).toBe("Home");
    expect(suggestedLabel("contact", { ...EMPTY, phone: "123" })).toBe("123");
    expect(suggestedLabel("text", { ...EMPTY, text: "the quick brown fox jumps over the lazy dog" })).toBe("the quick brown fox jumps");
  });

  it("reads a kept code's content back into its fields, so Open in Make shows it as typed", () => {
    const wifi = fieldsOf("wifi", 'WIFI:T:WEP;S:a\\;b;P:p\\"q;;');
    expect(wifi).toMatchObject({ ssid: "a;b", password: 'p"q', security: "WEP" });
    expect(fieldsOf("wifi", "WIFI:T:nopass;S:Open net;;")).toMatchObject({ ssid: "Open net", security: "nopass" });
    expect(fieldsOf("contact", contentOf("contact", { ...EMPTY, name: "Ana", phone: "1", email: "a@b" }))).toMatchObject({ name: "Ana", phone: "1", email: "a@b" });
    expect(fieldsOf("link", "https://x.y").link).toBe("https://x.y");
    expect(fieldsOf("text", "hi").text).toBe("hi");
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual([...LANGS]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("says everything on its screens in every language", () => {
    for (const [key, words] of Object.entries(W)) {
      for (const l of LANGS) expect((words as Record<string, string>)[l], `${key}.${l}`).toBeTruthy();
    }
  });

  it("keeps the same {placeholders} in every language of a message", () => {
    for (const [key, words] of Object.entries(W)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
      const en = vars((words as Record<string, string>).en!);
      for (const l of LANGS) expect(vars((words as Record<string, string>)[l]!), `${key}.${l}`).toEqual(en);
    }
  });
});
