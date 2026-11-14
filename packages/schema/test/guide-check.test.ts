import { describe, expect, it } from "vitest";
import { defineApp, guideProblems, type AppInput } from "../src/index.js";

// A guide is kept true (#80): a step that names, in quotes, something the app does not have is said.

const cellar = (guide: AppInput["guide"], extra: Partial<AppInput> = {}): AppInput => ({
  id: "cellar",
  name: "Wine Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  quickActions: [{ id: "new-bottle", label: "New bottle", entity: "bottle" }],
  entities: {
    bottle: {
      label: "Bottle",
      fields: { name: { type: "text" }, grape: { type: "enum", options: ["merlot", "syrah"], label: "Grape variety" }, dueDate: { type: "datetime" } },
      actions: { drink: { label: "Drink it", run: () => {} } },
    },
  },
  pages: [
    {
      id: "bottles",
      title: "Bottles",
      actions: [{ label: "📷 Scan label", run: () => {} }],
      view: { type: "list", entity: "bottle", filters: [{ label: "Country", param: "country", from: "grape" }] },
    },
  ],
  guide,
  ...extra,
});

const said = (guide: AppInput["guide"], extra?: Partial<AppInput>, source?: string): string[] => guideProblems(defineApp(cellar(guide, extra)), source);

describe("guideProblems", () => {
  it("passes an app without a guide, and a guide that quotes nothing", () => {
    expect(guideProblems(defineApp(cellar(undefined)))).toEqual([]);
    expect(said(["Scan a label on the Bottles page.", "Use the filter to find a bottle by country."])).toEqual([]);
  });

  it("passes names the app declares: a page, its button, a quick action, a record's button, a field, a filter", () => {
    expect(
      said([
        "Tap “Scan label” on the “Bottles” page and photograph a bottle.",
        "Or tap “New bottle” and fill in “Grape variety”.",
        "Open a bottle and tap “Drink it” when it is gone.",
        "Use “Country” to narrow the list.",
      ]),
    ).toEqual([]);
  });

  it("says the step and the name when nothing in the app is called that", () => {
    expect(said(["Tap “Scan label”.", "Then tap “Rate it” and choose from “Stars”."])).toEqual([
      "the guide's step 2 names “Rate it”, which no page, button or field of the app is called — a step quotes only what the app shows, as it is written there: use the real name, or say it without quotes",
      "the guide's step 2 names “Stars”, which no page, button or field of the app is called — a step quotes only what the app shows, as it is written there: use the real name, or say it without quotes",
    ]);
  });

  it("reads straight quotes and the other languages' quotation marks, whatever the case", () => {
    expect(said(['Tap "scan LABEL".', "Tippe auf „Bottles“.", "Toque em «Drink it»."])).toEqual([]);
    expect(said(['Tap "Scan wine".'])[0]).toContain("step 1 names “Scan wine”");
    expect(said(["Tippe auf „Etikett scannen“."])[0]).toContain("step 1 names “Etikett scannen”");
    expect(said(["Toque em « Ler rótulo »."])[0]).toContain("step 1 names “Ler rótulo”");
    // An apostrophe is not a quotation mark.
    expect(said(["Don't worry: it's saved as you type."])).toEqual([]);
  });

  it("knows the names the shell makes when no label is written, and its own add button for a kind of record", () => {
    expect(said(["Fill in “Name” and “Due date”.", "Tap “Add: Bottle”.", "Pick “Merlot”."])).toEqual([]);
    expect(said(["Tap “Add: Cork”."])[0]).toContain("names “Add: Cork”");
  });

  it("checks the language the app is written in, when a step is a map", () => {
    const languages = { language: "pl", languages: ["pl", "en"], name: { pl: "Piwniczka", en: "Cellar" } } as Partial<AppInput>;
    const pages = [{ id: "bottles", title: { pl: "Butelki", en: "Bottles" }, view: { type: "list", entity: "bottle" } }] as AppInput["pages"];
    expect(said([{ pl: "Otwórz „Butelki”.", en: "Open “Bottles”." }], { ...languages, pages })).toEqual([]);
    expect(said([{ pl: "Otwórz „Wina”.", en: "Open “Bottles”." }], { ...languages, pages })[0]).toContain("step 1 names “Wina”");
  });

  it("lets a name through that only the app's code shows: a custom view's button, a ctx.t label", () => {
    const guide = ["Tap “I parked here” when you leave the car."];
    const source = (step: string): string => `export default defineApp({ guide: [${JSON.stringify(step)}], pages: [{ view: { type: "custom", render: () => <button>{ctx.t("I parked here")}</button> } }] })`;
    expect(said(guide)[0]).toContain("names “I parked here”");
    expect(said(guide, undefined, source(guide[0]!))).toEqual([]);
    // The guide's own text is not evidence of itself, however the string was written.
    const alone = (written: string): string => `export default defineApp({ guide: [${written}] })`;
    expect(said(guide, undefined, alone(JSON.stringify(guide[0])))[0]).toContain("names “I parked here”");
    const straight = ['Tap "Park it" now.'];
    expect(said(straight, undefined, alone(JSON.stringify(straight[0])))[0]).toContain("names “Park it”");
    expect(said(straight, undefined, alone(`'Tap "Park it" now.'`))[0]).toContain("names “Park it”");
  });

  it("reads an app out of the sealed box too: functions as markers, never called", () => {
    const def = JSON.parse(JSON.stringify(defineApp(cellar(["Tap “Scan label”, then “Nope”."])), (_k, v: unknown) => (typeof v === "function" ? "__potyro_fn__" : v))) as unknown;
    expect(guideProblems(def)).toHaveLength(1);
    expect(guideProblems(null)).toEqual([]);
    expect(guideProblems({ guide: "nonsense" })).toEqual([]);
  });
});
