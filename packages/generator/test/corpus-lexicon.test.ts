// The request's words in the corpus's terms (corpus-lexicon.ts): pairings mined from translation maps
// and from keys beside their labels, never from a hand-written dictionary.

import { describe, expect, it } from "vitest";
import { buildLexicon, englishFor, pairsIn, splitKey, withSource, wordsOf } from "../src/corpus-lexicon.js";

describe("wordsOf / splitKey", () => {
  it("keeps a word whole in any script", () => {
    expect(wordsOf("Ćwiczenie, zdjęcie — Avaliação!")).toEqual(["ćwiczenie", "zdjęcie", "avaliação"]);
  });
  it("reads a key as words", () => {
    expect(splitKey("caloriesPerServing")).toBe("calories Per Serving");
    expect(splitKey("opening_hours")).toBe("opening hours");
  });
});

describe("pairsIn", () => {
  it("pairs each language of a translation map with its English, on one line or several", () => {
    const src = `label: { en: "Rating", pl: "Ocena", "pt-BR": "Avaliação" },
      title: {
        en: "Rolling best",
        pl: "Ostatni rekord",
      },`;
    const pairs = pairsIn(src);
    expect(pairs).toContainEqual({ words: ["ocena"], english: ["rating"] });
    expect(pairs).toContainEqual({ words: ["avaliação"], english: ["rating"] });
    expect(pairs).toContainEqual({ words: ["ostatni", "rekord"], english: ["rolling", "best"] });
  });

  it("pairs a label with its key, so an app written only in Polish teaches its words too", () => {
    const pairs = pairsIn(`fields: { rating: { type: "number", label: "Ocena" }, openingHours: { type: "text", label: "Godziny otwarcia" } }`);
    expect(pairs).toContainEqual({ words: ["ocena"], english: ["rating"] });
    expect(pairs).toContainEqual({ words: ["godziny", "otwarcia"], english: ["opening", "hours"] });
  });

  it("ignores a map with no English", () => {
    expect(pairsIn(`label: { pl: "Ocena", de: "Bewertung" }`)).toEqual([]);
  });
});

describe("englishFor", () => {
  const lex = buildLexicon([
    `recipe: { label: { en: "Recipe", pl: "Przepis", "pt-BR": "Receita" } }`,
    `title: { en: "Recipes", pl: "Przepisy" }`,
    `help: { en: "Tap a recipe to open it in the cook view", pl: "Stuknij przepis, aby otworzyć go w widoku gotowania" }`,
  ]);

  it("reads an inflected word through the forms the sources paired", () => {
    expect(englishFor(lex, "przepisu")).toContain("recipe");
    expect(englishFor(lex, "receita")).toEqual(["recipe"]);
  });

  it("does not pair every word of one long phrase with every other", () => {
    expect(englishFor(lex, "stuknij")).toEqual([]);
    expect(englishFor(lex, "widoku")).toEqual([]);
  });

  it("knows nothing of a word no source paired", () => {
    expect(englishFor(lex, "bluetooth")).toEqual([]);
  });

  it("learns from Potyro's own catalog words and from the app being edited", () => {
    const withWords = buildLexicon([], [["pl", "Mapa", "Map"], ["pl", "Wykres", "Chart"]]);
    expect(englishFor(withWords, "mapę")).toEqual(["map"]);
    const edited = withSource(withWords, `fields: { rating: { type: "number", label: "Ocena" } }`);
    expect(englishFor(edited, "oceną")).toEqual(["rating"]);
    expect(englishFor(withWords, "oceną")).toEqual([]); // the base is left as it was
  });
});
