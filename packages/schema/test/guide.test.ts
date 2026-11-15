import { describe, expect, it } from "vitest";
import { attachCatalogs, defineApp, GUIDE_LIMITS, guideSteps, localize, ValidationError, wordSlots, wordsPathText, type AppInput } from "../src/index.js";

// An app carries a guide (#80): how to use it, in a few steps, words like the rest of its words.

const cellar = (extra: Partial<AppInput> = {}): AppInput => ({
  id: "cellar",
  name: "Wine Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  entities: { bottle: { fields: { name: { type: "text" } } } },
  pages: [{ id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle" } }],
  ...extra,
});

const issuesOf = (def: AppInput): string[] => {
  try {
    defineApp(def);
    return [];
  } catch (e) {
    return (e as ValidationError).issues;
  }
};

describe("guide", () => {
  it("is optional, and a list of steps is kept as written", () => {
    expect(defineApp(cellar()).guide).toBeUndefined();
    const guide = ["Tap “Scan label” on the Bottles page and photograph a bottle.", "Check what it filled in, then save."];
    expect(defineApp(cellar({ guide })).guide).toEqual(guide);
  });

  it("refuses too many steps, in words that say how many it takes", () => {
    const guide = Array.from({ length: GUIDE_LIMITS.steps + 1 }, (_, i) => `Step ${i + 1}.`);
    expect(issuesOf(cellar({ guide }))).toEqual([`guide: a guide has at most 6 steps — keep the ones a first visit needs`]);
    expect(issuesOf(cellar({ guide: [] }))).toEqual(["guide: a guide has at least one step; with nothing to say, leave `guide` out"]);
  });

  it("refuses a step that is too long, empty, or more than one line, naming the step", () => {
    const long = "x".repeat(GUIDE_LIMITS.chars + 1);
    expect(issuesOf(cellar({ guide: ["Fine.", long] }))).toEqual(["guide.1: this step is 161 characters; a step is one sentence of at most 160 — shorten it, or split it in two"]);
    expect(issuesOf(cellar({ guide: ["x".repeat(GUIDE_LIMITS.chars)] }))).toEqual([]);
    expect(issuesOf(cellar({ guide: [""] }))).toEqual(["guide.0: a step says one thing to do; an empty one says nothing — write it or take it out"]);
    expect(issuesOf(cellar({ guide: ["   "] }))[0]).toMatch(/^guide\.0: a step says one thing to do/);
    expect(issuesOf(cellar({ guide: ["Add a bottle.\nThen rate it."] }))[0]).toMatch(/^guide\.0: a step is one line of plain text/);
  });

  it("refuses anything that is not words: no nested structure, no markup objects", () => {
    expect(issuesOf(cellar({ guide: [{ title: "Scan", body: "…" }] as never }))[0]).toMatch(/^guide\.0/);
    expect(issuesOf(cellar({ guide: "Tap Scan label." as never }))[0]).toMatch(/^guide: /);
    expect(issuesOf(cellar({ guide: [3] as never }))[0]).toMatch(/^guide\.0: expected text/);
  });

  it("checks every language of a step written as a map", () => {
    const long = "x".repeat(GUIDE_LIMITS.chars + 1);
    expect(issuesOf(cellar({ languages: ["en", "pl"], guide: [{ en: "Add a bottle.", pl: long }] }))[0]).toMatch(/^guide\.0: this step is 161 characters/);
  });

  it("each step is a words slot: listed with the app's words, and shown through its catalog", () => {
    const app = defineApp(cellar({ languages: ["en", "de"], guide: ["Add a bottle.", "Rate it."] }));
    expect(wordSlots(app).map((s) => wordsPathText(s.path))).toEqual(expect.arrayContaining(["guide.0", "guide.1"]));
    attachCatalogs(app, { de: { "Add a bottle.": "Füge eine Flasche hinzu." } });
    expect(localize(app, "de").guide).toEqual(["Füge eine Flasche hinzu.", "Rate it."]);
    expect(localize(app, "en").guide).toEqual(["Add a bottle.", "Rate it."]);
  });
});

describe("guideSteps", () => {
  it("gives the steps to draw: text only, trimmed, never more or longer than the shell shows", () => {
    expect(guideSteps(undefined)).toEqual([]);
    expect(guideSteps("Tap here")).toEqual([]);
    expect(guideSteps(["  Add a\n bottle. ", "", 3, { en: "x" }, null, "Rate it."])).toEqual(["Add a bottle.", "Rate it."]);
    expect(guideSteps(Array.from({ length: 20 }, (_, i) => `Step ${i}`))).toHaveLength(GUIDE_LIMITS.steps);
    const [cut] = guideSteps(["y".repeat(1000)]);
    expect(cut).toHaveLength(GUIDE_LIMITS.shownChars);
    expect(cut!.endsWith("…")).toBe(true);
    // Markup is text like any other: nothing here interprets it, and the shell draws it as text.
    expect(guideSteps(['<img src=x onerror="alert(1)"> [a link](https://example.com)'])).toEqual(['<img src=x onerror="alert(1)"> [a link](https://example.com)']);
  });
});
