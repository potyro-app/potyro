// The request's words in the corpus's terms (corpus-lexicon.ts): pairings mined from translation maps
// and from keys beside their labels, never from a hand-written dictionary.

import { describe, expect, it } from "vitest";
import { buildLexicon, englishFor, englishView, pairsIn, splitKey, translationLanguages, withSource, wordsOf } from "../src/corpus-lexicon.js";

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

describe("forms and meanings, on sources that say many words in many sentences", () => {
  it("does not read a short word as a form of a long one that starts the same way", () => {
    // "przy" shares "prz" with "przepisu"; read as a form of it, its sentences drowned "recipe".
    const lex = buildLexicon([
      `a: { en: "Recipe", pl: "Przepis" }`,
      `b: { en: "Closer to the light", pl: "Bliżej przy świetle" }`,
      `c: { en: "Hold it closer", pl: "Trzymaj przy sobie" }`,
      `d: { en: "Light by the window", pl: "Światło przy oknie" }`,
    ]);
    expect(englishFor(lex, "przepisu")).toEqual(["recipe"]);
  });

  it("does not read an English word as a form of another language's", () => {
    // "receipt" (a key and its English label) is not "receita".
    const lex = buildLexicon([`recipe: { label: { en: "Recipe", "pt-BR": "Receita" } }`, `receipt: { label: "Receipt" }`, `x: { label: "Receipt" }`, `y: { label: "Receipt" }`]);
    expect(englishFor(lex, "receita")).toEqual(["recipe"]);
  });

  it("counts an English word's forms as one meaning", () => {
    const lex = buildLexicon([`a: { en: "Page", pl: "Strona" }`, `b: { en: "Pages", pl: "Strony" }`, `c: { en: "Name", pl: "Strona" }`]);
    // "page" 1, "pages" 1, "name" 1 of three: no single word has half, the word "page" has two thirds.
    expect(englishFor(lex, "stronę")).toEqual(["page"]);
  });

  it("reads a word by its labels when it has them, not by the sentences it is also in", () => {
    const lex = buildLexicon([
      `rating: { label: { en: "Rating", pl: "Ocena" } }`,
      `a: { en: "Hard to tell from this photo", pl: "Trudno ocenić po tym zdjęciu" }`,
      `b: { en: "Probably fine, hard to tell", pl: "Chyba dobrze, trudno ocenić" }`,
      `c: { en: "Possibly dry, hard to tell", pl: "Może sucho, trudno ocenić" }`,
    ]);
    expect(englishFor(lex, "oceną")).toEqual(["rating"]);
  });

  it("does not read a common word by the odd label it is in", () => {
    const said = [
      ["The photo did not load", "Zdjęcie nie załadowało się"],
      ["Could not save", "Nie udało się zapisać"],
      ["The game is over", "Gra skończyła się"],
      ["Starts tomorrow", "Zaczyna się jutro"],
      ["Something went wrong", "Coś poszło nie tak, stało się"],
      ["Wait a moment", "Zatrzymaj się na chwilę"],
      ["Meet at noon", "Spotkajmy się w południe"],
      ["Learn the notes", "Naucz się nut"],
    ];
    const sentences = said.map(([en, pl], i) => `s${i}: { en: "${en}", pl: "${pl}" }`);
    const lex = buildLexicon([...sentences, `h: { en: "Say hello", pl: "Przywitaj się" }`]);
    expect(englishFor(lex, "się")).toEqual([]);
  });
});

describe("translationLanguages / englishView", () => {
  const src = `title: { en: "Recipes", pl: "Przepisy", "pt-BR": "Receitas" },
    hint: {
      en: "Tap a recipe",
      pl: "Stuknij przepis",
      "pt-BR": "Toque numa receita",
    },
    page: { id: "pl", sampl: "x", it: "kept: not a language here" }`;

  it("finds the languages translation maps carry beside English, not keys that look like one", () => {
    expect([...translationLanguages([src])].sort()).toEqual(["pl", "pt-BR"]);
    expect(translationLanguages([`a: { en: "A", it: "B" }`]).size).toBe(0); // one map is not a language
  });

  it("leaves what a passage says in English, and everything that is not a translation", () => {
    const view = englishView(src, translationLanguages([src]));
    expect(view).toContain('en: "Recipes"');
    expect(view).toContain('en: "Tap a recipe"');
    expect(view).not.toMatch(/Przepisy|Receitas|Stuknij|numa/);
    expect(view).toContain('id: "pl", sampl: "x", it: "kept: not a language here"');
  });
});
