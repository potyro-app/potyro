import { describe, expect, it } from "vitest";
import { LANGS, WORD_COUNT, blankMask, chooseWords, distance, hintCount, hintPlan, judge, normalize, seeded, wordAt, wordsIn } from "../words.js";

describe("the words to draw", () => {
  it("a few hundred in each of the six languages, the same things in the same order", () => {
    expect(WORD_COUNT).toBeGreaterThanOrEqual(250);
    for (const lang of LANGS) {
      const words = wordsIn(lang);
      expect(words).toHaveLength(WORD_COUNT);
      for (const w of words) {
        expect(w.trim()).toBe(w);
        expect(w.length).toBeGreaterThan(1);
        expect(w.length).toBeLessThanOrEqual(30);
      }
    }
    expect(wordAt("en", 0)).toBe("cat");
    expect(wordAt("de", 0)).toBe("Katze");
    expect(wordAt("pl", 0)).toBe("kot");
  });

  it("no two things in one language are the same word once typed (or a guess would win two)", () => {
    for (const lang of LANGS) {
      const seen = new Map<string, string>();
      for (const w of wordsIn(lang)) {
        const n = normalize(w, lang);
        expect(seen.get(n), `${lang}: ${w} vs ${seen.get(n)}`).toBeUndefined();
        seen.set(n, w);
      }
    }
  });

  it("offers three different words not drawn yet this game", () => {
    const random = seeded(7);
    const used = [0, 1, 2, 3];
    for (let i = 0; i < 200; i++) {
      const c = chooseWords(3, used, random);
      expect(new Set(c).size).toBe(3);
      for (const row of c) {
        expect(used).not.toContain(row);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(WORD_COUNT);
      }
    }
  });

  it("when nearly every word is drawn, it starts over rather than offering nothing", () => {
    const used = Array.from({ length: WORD_COUNT - 1 }, (_, i) => i);
    expect(chooseWords(3, used, seeded(1))).toHaveLength(3);
  });

  it("is spread over the whole list (a fair shuffle, not the first few)", () => {
    const random = seeded(42);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) for (const r of chooseWords(3, [], random)) seen.add(r);
    expect(seen.size).toBeGreaterThan(WORD_COUNT * 0.9);
  });
});

describe("checking a guess", () => {
  it("forgives case, accents, a leading article, spaces and hyphens", () => {
    expect(judge("cat", "The CAT ", "en")).toBe("yes");
    expect(judge("ice cream", "icecream", "en")).toBe("yes");
    expect(judge("Schildkröte", "schildkrote", "de")).toBe("yes");
    expect(judge("Katze", "die katze", "de")).toBe("yes");
    expect(judge("Fuß", "fuss", "de")).toBe("yes");
    expect(judge("żółw", "zolw", "pl")).toBe("yes");
    expect(judge("łyżka", "lyzka", "pl")).toBe("yes");
    expect(judge("maçã", "maca", "pt-BR")).toBe("yes");
    expect(judge("lecca-lecca", "lecca lecca", "it")).toBe("yes");
    expect(judge("araña", "la arana", "es")).toBe("yes");
    expect(judge("l'ape", "ape", "it")).toBe("yes");
  });

  it("one letter off is close — said to the guesser, never scored", () => {
    expect(judge("elephant", "elefant", "en")).toBe("close");
    expect(judge("giraffe", "girafe", "en")).toBe("close");
    expect(judge("butterfly", "buterfli", "en")).toBe("close");
    expect(judge("cat", "car", "en")).toBe("no"); // short words have no "close"
    expect(judge("tiger", "lion", "en")).toBe("no");
    expect(judge("cat", "", "en")).toBe("no");
    expect(judge("cat", "the", "en")).toBe("no"); // an article alone is not dropped
  });

  it("counts edits, and stops early once past the limit", () => {
    expect(distance("kitten", "sitting")).toBe(3);
    expect(distance("abc", "abc")).toBe(0);
    expect(distance("a", "abcdefgh", 2)).toBe(3);
  });
});

describe("hint letters", () => {
  it("blanks letters only, keeping spaces and hyphens", () => {
    expect(blankMask("ice cream")).toBe("___ _____");
    expect(blankMask("U-Boot")).toBe("_-____");
  });

  it("none for a short word, at most three, never half the word", () => {
    expect(hintCount("cat")).toBe(0);
    expect(hintCount("tiger")).toBe(1);
    expect(hintCount("elephant")).toBe(2);
    expect(hintCount("butterfly")).toBe(3);
    for (const lang of LANGS) for (const w of wordsIn(lang)) expect(hintCount(w)).toBeLessThanOrEqual(Math.floor([...w].filter((c) => /[\p{L}\p{N}]/u.test(c)).length / 2));
  });

  it("show over the turn, from 40 % to 85 %, one more letter each time, ending well short of the word", () => {
    const plan = hintPlan("butterfly", 80_000, seeded(3));
    expect(plan.map((h) => h.at)).toEqual([32_000, 50_000, 68_000]);
    let shown = 0;
    for (const h of plan) {
      const now = [...h.mask].filter((c) => c !== "_").length;
      expect(now).toBe(shown + 1);
      shown = now;
      [...h.mask].forEach((c, i) => c !== "_" && expect(c).toBe("butterfly"[i]));
    }
    expect(plan.at(-1)!.mask).not.toBe("butterfly");
    expect(hintPlan("tiger", 60_000, seeded(1))).toHaveLength(1);
    expect(hintPlan("tiger", 60_000, seeded(1))[0]!.at).toBe(33_000);
    expect(hintPlan("cat", 60_000, seeded(1))).toEqual([]);
  });

  it("the same seed gives the same hints", () => {
    expect(hintPlan("dinosaur", 70_000, seeded(9))).toEqual(hintPlan("dinosaur", 70_000, seeded(9)));
  });
});
