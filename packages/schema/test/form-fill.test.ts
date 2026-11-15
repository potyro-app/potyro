import { describe, expect, it } from "vitest";
import { defineApp, FILL_MAX, guideProblems, localize, ValidationError, wordSlots, type AppDefinition } from "../src/index.js";

// A form's fill button (#81): `entities.x.fill: [{ label, icon?, description?, run }]`. `run` is an
// ordinary function of the draft and `ctx` that returns values; the declaration around it is data,
// validated like the rest, with words a model can act on.

const cellar = (fill: unknown, extra: Record<string, unknown> = {}): AppDefinition =>
  ({
    id: "cellar",
    name: "Cellar",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { bottle: { label: "Bottle", displayField: "name", fields: { name: { type: "text" }, year: { type: "number" } }, fill } },
    pages: [{ id: "all", title: "Bottles", view: { type: "list", entity: "bottle" } }],
    ...extra,
  }) as AppDefinition;

const issues = (fill: unknown): string[] => {
  try {
    defineApp(cellar(fill));
    return [];
  } catch (e) {
    if (e instanceof ValidationError) return e.issues;
    throw e;
  }
};

describe("a form's fill buttons", () => {
  it("accepts a label and a function, with an icon and a line of description", () => {
    const run = async () => ({ name: "Catena" });
    const app = defineApp(cellar([{ label: "Scan label", icon: "camera", description: "Reads the label with AI", run }]));
    expect(app.entities.bottle!.fill).toEqual([{ label: "Scan label", icon: "camera", description: "Reads the label with AI", run }]);
  });

  it("accepts the sealed box's placeholder where the function was", () => {
    expect(issues([{ label: "Scan label", run: "__potyro_fn__" }])).toEqual([]);
  });

  it("says what `run` must be when it is missing or not a function", () => {
    for (const fill of [[{ label: "Scan label" }], [{ label: "Scan label", run: "scan" }], [{ label: "Scan label", run: { page: "scan" } }]]) {
      expect(issues(fill)).toEqual(["entities.bottle.fill.0.run: a form's fill button needs `run`: a function `(draft, ctx) => ({ field: value })` that returns the values to fill"]);
    }
  });

  it("needs a label, takes no unknown key, and is a list", () => {
    expect(issues([{ run: () => ({}) }]).join("\n")).toMatch(/entities\.bottle\.fill\.0\.label/);
    expect(issues([{ label: "", run: () => ({}) }]).join("\n")).toMatch(/entities\.bottle\.fill\.0\.label/);
    expect(issues([{ label: "Scan", run: () => ({}), input: { photo: { type: "media" } } }]).join("\n")).toMatch(/entities\.bottle\.fill\.0.*input/);
    expect(issues({ scan: { label: "Scan", run: () => ({}) } })).toEqual(["entities.bottle.fill: `fill` is a list of buttons: [{ label, run: (draft, ctx) => ({ field: value }) }]"]);
  });

  it(`takes at most ${FILL_MAX}, and says what to do instead`, () => {
    const one = { label: "Scan", run: () => ({}) };
    expect(issues(Array.from({ length: FILL_MAX }, () => one))).toEqual([]);
    expect(issues(Array.from({ length: FILL_MAX + 1 }, () => one))).toEqual([
      `entities.bottle.fill: a form takes at most ${FILL_MAX} fill buttons — one button can offer a choice with ctx.ui.sheet`,
    ]);
  });

  it("its label and description are words: found by the walker, and shown in the person's language", () => {
    const app = defineApp(
      cellar([{ label: { en: "Scan label", de: "Etikett scannen" }, description: { en: "Reads it with AI", de: "Liest es mit KI" }, run: () => ({}) }], { language: "en", languages: ["en", "de"] }),
    );
    expect(wordSlots(app).map((s) => s.path.join("."))).toEqual(expect.arrayContaining(["entities.bottle.fill.0.label", "entities.bottle.fill.0.description"]));
    const shown = localize(app, "de");
    expect(shown.entities.bottle!.fill![0]).toMatchObject({ label: "Etikett scannen", description: "Liest es mit KI" });
    expect(typeof shown.entities.bottle!.fill![0]!.run).toBe("function");
  });

  it("a guide may name a fill button: it is something the app shows", () => {
    const withGuide = (step: string) => defineApp(cellar([{ label: "Scan label", run: () => ({}) }], { guide: [step] }));
    expect(guideProblems(withGuide("Adding a bottle? Tap “Scan label” and check what it read."))).toEqual([]);
    expect(guideProblems(withGuide("Tap “Read the label” first.")).join("\n")).toMatch(/names “Read the label”/);
  });
});
