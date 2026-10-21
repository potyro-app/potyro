// tokens.css is the designer's file with the fonts made local. It is generated; this fails while it
// is stale (`pnpm gen:tokens`), and when the designer's source changes without a regeneration.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FONT_FACES, generate } from "../scripts/tokens.mjs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("tokens.css", () => {
  it("is the designer's tokens with the fonts self-hosted", () => {
    expect(read("../tokens.css")).toBe(generate(read("../source/potyro-tokens.css")));
  });
  it("fetches nothing from anyone", () => {
    expect(read("../tokens.css")).not.toMatch(/https?:\/\//);
  });
  it("names only font files that exist", () => {
    for (const [, file] of FONT_FACES.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)) {
      expect(existsSync(new URL(`../fonts/${file}`, import.meta.url)), file).toBe(true);
    }
  });
  it("carries the twenty-two logo variations", () => {
    const logos = ["wordmark-rosa", "wordmark-rosa-on-dark", "wordmark-mono", "wordmark-mono-on-dark", "wordmark-large", "tagline", "symbol-rosa", "symbol-rosa-on-dark", "symbol-circle-dark", "symbol-square-dark", "symbol-circle-light", "symbol-square-light"];
    for (const name of logos) expect(existsSync(new URL(`../logo/${name}.svg`, import.meta.url)), name).toBe(true);
  });
});
