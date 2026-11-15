// What a version's card says changed (#72). A person was told "Applied 6 edits." about the turn that
// added the button they had asked for; the host now says what is different and where to find it,
// from the app itself.

import { describe, expect, it } from "vitest";
import { describeChange, describeNewApp, describedIn, explainChange, proseForCard, type Described } from "../src/studio-summary.js";

const run = async (): Promise<void> => {};

const cellar = (over: Partial<Described> = {}): Described =>
  ({
    name: "Wine Cellar",
    entities: {
      bottle: {
        label: "Bottle",
        fields: { name: { type: "text", required: true }, grape: { type: "enum", options: ["merlot", "syrah"] }, country: { type: "enum", options: ["fr", "it"], label: "Country" } },
        actions: { drink: { label: "Drink it", run } },
      },
    },
    pages: [
      { id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", filters: [{ label: "Country", param: "country", from: "country" }] } },
      { id: "bottle", title: "Bottle", hidden: true, view: { type: "detail", entity: "bottle" } },
    ],
    ...over,
  }) as Described;

const texts = (before: Described, after: Described): string[] => describeChange(before, after).map((l) => l.text);

describe("what changed, from the app before and after", () => {
  it("a button added to a page is said with the page it is on", () => {
    const before = cellar();
    const after = cellar({ pages: [{ ...before.pages[0]!, actions: [{ label: "Scan label", run }] }, before.pages[1]!] });
    expect(texts(before, after)).toEqual(["New on the “Bottles” page: a “Scan label” button."]);
    expect(describeChange(before, after)[0]!.names).toEqual(["Scan label", "Bottles"]);
  });

  it("several buttons on one page are one sentence; one gone and one new is a rename", () => {
    const before = cellar();
    const withTwo = cellar({ pages: [{ ...before.pages[0]!, actions: [{ label: "Scan label", run }, { label: "Export", run }] }, before.pages[1]!] });
    expect(texts(before, withTwo)).toEqual(["New on the “Bottles” page: the buttons “Scan label” and “Export”."]);
    const renamed = cellar({ pages: [{ ...before.pages[0]!, actions: [{ label: "Photograph a label", run }, { label: "Export", run }] }, before.pages[1]!] });
    expect(texts(withTwo, renamed)).toEqual(["On the “Bottles” page, “Scan label” is now called “Photograph a label”."]);
    expect(texts(withTwo, before)).toEqual(["Removed from the “Bottles” page: the buttons “Scan label” and “Export”."]);
  });

  it("pages: a new one, a renamed one, a removed one — and a hidden page's coming is not news", () => {
    const before = cellar();
    const stats = { id: "stats", title: "Stats", view: { type: "stats", entity: "bottle", stats: [] } } as unknown as Described["pages"][number];
    const hidden = { ...stats, id: "edit", title: "Edit", hidden: true };
    expect(texts(before, cellar({ pages: [...before.pages, stats, hidden] }))).toEqual(["New page: “Stats”."]);
    expect(texts(cellar({ pages: [...before.pages, stats] }), before)).toEqual(["Removed the page “Stats”."]);
    expect(texts(before, cellar({ pages: [{ ...before.pages[0]!, title: "Cellar" }, before.pages[1]!] }))).toEqual(["The page “Bottles” is now called “Cellar”."]);
  });

  it("a new name for the app", () => {
    expect(texts(cellar(), cellar({ name: "Cave" }))).toEqual(["The app is now called “Cave”."]);
  });

  it("a page whose title is worked out is called by its id, humanised", () => {
    const before = cellar();
    const after = cellar({ pages: [{ ...before.pages[0]!, id: "myBottles", title: () => "x", actions: [{ label: "Scan label", run }] }, before.pages[1]!] });
    expect(texts(cellar({ pages: [{ ...before.pages[0]!, id: "myBottles", title: () => "x" }, before.pages[1]!] }), after)).toEqual(["New on the “My Bottles” page: a “Scan label” button."]);
  });

  it("fields: added, removed, renamed, and changed in kind — each with the kind of record it is in", () => {
    const before = cellar();
    const bottle = before.entities.bottle!;
    const after = cellar({
      entities: {
        bottle: {
          ...bottle,
          fields: {
            name: { type: "text", required: true, label: "Wine" },
            grape: { type: "text" },
            vintage: { type: "number", label: "Vintage" },
          },
        },
      },
    } as Partial<Described>);
    expect(texts(before, after)).toEqual([
      "New in “Bottle”: a “Vintage” field.",
      "Removed from “Bottle”: the “Country” field.",
      "Changed in “Bottle”: the “Grape” field.",
      "In “Bottle”, “Name” is now called “Wine”.",
    ]);
  });

  it("says a new button in a form, and one taken out", () => {
    const before = cellar();
    const bottle = before.entities.bottle!;
    const withFill = cellar({ entities: { bottle: { ...bottle, fill: [{ label: "Scan label", run: () => ({}) }] } } } as Partial<Described>);
    expect(texts(before, withFill)).toEqual(["New in the “Bottle” form: a “Scan label” button."]);
    expect(texts(withFill, before)).toEqual(["Removed from the “Bottle” form: the “Scan label” button."]);
  });

  it("a record's buttons, the app's main buttons, filters and a new kind of record", () => {
    const before = cellar();
    const bottle = before.entities.bottle!;
    const after = cellar({
      quickActions: [{ id: "add", label: "Add a bottle", entity: "bottle" }],
      entities: {
        bottle: { ...bottle, actions: { ...bottle.actions, gift: run } },
        tasting: { label: "Tasting", fields: { note: { type: "text" } } },
        palette: { hidden: true, fields: {} },
      },
      pages: [{ ...before.pages[0]!, view: { ...before.pages[0]!.view, filters: [{ label: "Country", param: "country" }, { label: "Grape", param: "grape" }] } }, before.pages[1]!],
    } as Partial<Described>);
    expect(texts(before, after)).toEqual([
      "New among the app’s main buttons: “Add a bottle”.",
      "The app now also keeps: “Tasting”.",
      "New on each record of “Bottle”: a “Gift” button.",
      "New on the “Bottles” page: a “Grape” filter.",
    ]);
  });

  it("a change to how something is worked out leaves nothing to say", () => {
    const before = cellar();
    const bottle = before.entities.bottle!;
    expect(texts(before, cellar({ entities: { bottle: { ...bottle, actions: { drink: { label: "Drink it", run: async () => {} } } } } } as Partial<Described>))).toEqual([]);
  });
});

describe("the app's guide, when a change touches it (#80)", () => {
  const guide = ["Tap “Scan label”.", "Check what it filled in."];
  it("says in one sentence that it changed, and where it is read", () => {
    expect(texts(cellar({ guide }), cellar({ guide: [guide[0]!, "Check the details, then save."] }))).toEqual(["Its guide (“How to use it”, in the app’s menu) is updated to match."]);
    expect(texts(cellar(), cellar({ guide }))).toEqual(["The app now has a guide: “How to use it”, in its menu."]);
    expect(texts(cellar({ guide }), cellar())).toEqual(["The app no longer has a guide."]);
  });
  it("says nothing when it is the same, and is left out only when the model's words name it", () => {
    expect(texts(cellar({ guide }), cellar({ guide: [...guide] }))).toEqual([]);
    const lines = describeChange(cellar(), cellar({ guide }));
    expect(explainChange("Added a rating.", lines)).toBe("Added a rating. The app now has a guide: “How to use it”, in its menu.");
    expect(explainChange("Added a rating; “How to use it” says so.", lines)).toBe("Added a rating; “How to use it” says so.");
  });
});

describe("a new app: what it is and the first thing to do in it", () => {
  it("names its pages and the main button to start with", () => {
    const app = cellar({ quickActions: [{ id: "add", label: "Add a bottle", entity: "bottle" }] } as Partial<Described>);
    expect(describeNewApp({ ...app, pages: [...app.pages, { id: "stats", title: "Stats", view: { type: "list", entity: "bottle" } }] } as Described)).toBe(
      "Made “Wine Cellar”. It has 2 pages: “Bottles” and “Stats”. To start, tap “Add a bottle”.",
    );
  });

  it("with no main button, the first page's own: its frequent action before its first", () => {
    const base = cellar();
    const page = { ...base.pages[0]!, actions: [{ label: "Export", run }, { label: "Scan label", run }] };
    expect(describeNewApp(cellar({ pages: [page] }))).toBe("Made “Wine Cellar”. To start, tap “Export” on the “Bottles” page.");
    expect(describeNewApp(cellar({ pages: [{ ...page, primaryAction: 1 }] }))).toBe("Made “Wine Cellar”. To start, tap “Scan label” on the “Bottles” page.");
  });

  it("with no button of its own, the first page is where to add; an app that adds nothing by hand is not told to", () => {
    expect(describeNewApp(cellar())).toBe("Made “Wine Cellar”. To start, add your first entry on the “Bottles” page.");
    expect(describeNewApp(cellar({ quickActions: [] }))).toBe("Made “Wine Cellar”.");
  });

  it("with a guide of its own, the app's steps stand in for the host's guess at a first tap (#80)", () => {
    const app = cellar({
      quickActions: [{ id: "add", label: "Add a bottle", entity: "bottle" }],
      guide: ["Tap “Scan label” on the Bottles page and photograph a bottle.", "Check what it filled in, then save."],
    } as Partial<Described>);
    expect(describeNewApp(app)).toBe("Made “Wine Cellar”. How to use it: 1. Tap “Scan label” on the Bottles page and photograph a bottle. 2. Check what it filled in, then save.");
    // What is drawn is what the shell would draw: text, clamped; a guide with nothing in it is no guide.
    expect(describeNewApp(cellar({ guide: ["x".repeat(900)] } as Partial<Described>)).length).toBeLessThan(400);
    expect(describeNewApp(cellar({ guide: [] } as Partial<Described>))).toBe("Made “Wine Cellar”. To start, add your first entry on the “Bottles” page.");
  });

  it("is said in the person's language when the app carries it", () => {
    const app = { id: "w", version: "1", schemaVersion: 1, language: "en", languages: ["en", "pl"], name: { en: "Wine Cellar", pl: "Piwniczka" }, entities: {}, pages: [] };
    expect(describeNewApp(describedIn(app as never, ["pl"]))).toBe("Made “Piwniczka”.");
    expect(describeNewApp(describedIn(app as never, ["de"]))).toBe("Made “Wine Cellar”.");
  });
});

describe("the model's words lead; the host adds what they leave out", () => {
  const line = { text: "New on the “Bottles” page: a “Scan label” button.", names: ["Scan label", "Bottles"] };

  it("the model's prose is one paragraph, without its Not done list and the loop's own lines", () => {
    expect(proseForCard("I made **grape** free text.\n\nNot done:\n- country, it needs a list that grows\n\nNEEDS-PLATFORM: a list field that learns new values")).toBe("I made grape free text.");
    expect(proseForCard(undefined)).toBe("");
  });

  it("with no prose, the host's sentences are the card", () => {
    expect(explainChange("", [line])).toBe(line.text);
  });

  it("prose that does not say where is followed by the host's sentence", () => {
    expect(explainChange("I added label scanning.", [line])).toBe(`I added label scanning. ${line.text}`);
  });

  it("prose that already names the button and its page is not said twice", () => {
    expect(explainChange("There is now a scan label button on the Bottles page.", [line])).toBe("There is now a scan label button on the Bottles page.");
  });
});
