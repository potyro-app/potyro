// The eval's language half (#301): the hand-checked translations cover the corpus and read as their
// language, the checks tell a Polish label from an English one, and the scripted engines prove the
// runners' language columns with no model.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODIFY_CASES, type DefinitionShape } from "../src/modify-corpus.js";
import { PROMPTS } from "../src/prompts.js";
import { WILD_PROMPTS } from "../src/wild-prompts.js";
import { CREATE_REQUESTS, EVAL_LANGUAGES, MODIFY_REQUESTS, localizeCreatePrompt, localizeModifyCase } from "../src/translated-cases.js";
import { checkLabels, newLabels, replyLanguage, summarizeLanguage } from "../src/language-eval.js";
import { classifyText } from "../src/language.js";
import { scriptedLoopEngine } from "../src/loop-eval.js";
import { runModifyLoop } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";

const RECIPES = readFileSync(fileURLToPath(new URL("../../../examples/recipes.app.tsx", import.meta.url)), "utf8");

describe("the translated requests", () => {
  for (const lang of EVAL_LANGUAGES) {
    it(`${lang}: every modify case and every create prompt has one, and nothing else does`, () => {
      expect(Object.keys(MODIFY_REQUESTS[lang]).sort()).toEqual(MODIFY_CASES.map((c) => c.id).sort());
      expect(Object.keys(CREATE_REQUESTS[lang]).sort()).toEqual([...WILD_PROMPTS, ...PROMPTS].map((p) => p.id).sort());
    });

    it(`${lang}: each reads as ${lang} and is not the English left in place`, () => {
      const english = new Map<string, string>([...MODIFY_CASES.map((c) => [c.id, c.instruction] as const), ...[...WILD_PROMPTS, ...PROMPTS].map((p) => [p.id, p.description] as const)]);
      for (const [id, text] of [...Object.entries(MODIFY_REQUESTS[lang]), ...Object.entries(CREATE_REQUESTS[lang])]) {
        expect(text, id).not.toBe(english.get(id));
        expect(classifyText(text), `${id}: ${text}`).toBe(lang);
      }
    });

    it(`${lang}: a localized case keeps its checks, and a partial case's Not done patterns read the language`, () => {
      for (const c of MODIFY_CASES) {
        const local = localizeModifyCase(c, lang);
        expect(local.id).toBe(c.id);
        expect(Boolean(local.landed)).toBe(Boolean(c.landed));
        expect(local.notDone?.length).toBe(c.notDone?.length);
      }
      const chart = localizeModifyCase(MODIFY_CASES.find((c) => c.id === "recipes-chart")!, lang);
      const line = lang === "pl" ? "wykres liczby ugotowanych przepisów, bo Potyro nie ma widoku wykresu" : "o gráfico das receitas, porque o Potyro não tem gráficos";
      expect(chart.notDone!.every((re) => new RegExp(re, "i").test(line))).toBe(true);
      // ...and the English line still matches: the patterns were widened, not replaced.
      expect(chart.notDone!.every((re) => new RegExp(re, "i").test("the chart itself, because no view draws one"))).toBe(true);
    });

    it(`${lang}: the spiciness case lands with the options written in the language`, () => {
      const c = localizeModifyCase(MODIFY_CASES.find((x) => x.id === "recipes-put-spice-back")!, lang);
      const options = lang === "pl" ? ["łagodna", "średnia", "ostra"] : ["suave", "média", "picante"];
      const after: DefinitionShape = { entities: { recipe: { fields: { spice: { type: "enum", options } } } }, pages: [] };
      expect(c.landed!(after, { entities: { recipe: { fields: {} } }, pages: [] })).toBe(true);
    });

    it(`${lang}: a create prompt carries its language`, () => {
      expect(localizeCreatePrompt(PROMPTS[0]!, lang)).toMatchObject({ id: PROMPTS[0]!.id, language: lang, description: CREATE_REQUESTS[lang][PROMPTS[0]!.id] });
    });
  }
});

describe("the label check", () => {
  it("counts only the words the change added", () => {
    const after = RECIPES.replace('name: "Recipes",', 'name: "Recipes",\n  // x') + '\nconst extra = { label: "Ocena" };';
    expect(newLabels(after, RECIPES)).toEqual(["Ocena"]);
  });

  it("passes when every label it can read is in the expected language, and names the ones that are not", () => {
    expect(checkLabels(["Ocena", "Pokój", "Link"], "pl")).toMatchObject({ inExpected: 2, inOther: 0, unknown: 1, passed: true });
    const mixed = checkLabels(["Ocena", "Rating"], "pl");
    expect(mixed).toMatchObject({ inExpected: 1, inOther: 1, passed: false, offenders: ["Rating (en)"] });
    expect(checkLabels(["Link"], "pl").passed).toBeNull();
  });

  it("reads a reply's language with code and markers left out", () => {
    expect(replyLanguage("Dodałem pole `rating` do przepisu.\n\nNot done:\n- wykres, bo nie ma takiego widoku")).toBe("pl");
    expect(replyLanguage("Added a `rating` field to the recipe.")).toBe("en");
    expect(replyLanguage("```ts\nconst a = 1;\n```")).toBeNull();
  });

  it("summarises cases, leaving out the ones it could not read", () => {
    const s = summarizeLanguage([
      { labels: checkLabels(["Ocena"], "pl"), reply: { passed: true } },
      { labels: checkLabels(["Rating"], "pl"), reply: { passed: false } },
      { labels: checkLabels(["Link"], "pl"), reply: { passed: null } },
    ]);
    expect(s).toMatchObject({ labelsChecked: 2, labelsPassed: 1, repliesChecked: 2, repliesPassed: 1, labels: { inExpected: 1, inOther: 1, unknown: 1 } });
  });
});

describe("the scripted language engine", () => {
  const run = (language?: "pl" | "pt-BR", appLanguage?: "pl") =>
    runModifyLoop({
      engine: scriptedLoopEngine("scripted-loop-language"),
      tools: buildDiscoveryTools({ check: async () => [], source: RECIPES }),
      system: "contract",
      instruction: "Dodaj ocenę.",
      source: RECIPES,
      check: async () => [],
      shapeOf: async () => ({ entities: {}, pages: [] }),
      before: { entities: {}, pages: [] },
      ...(language ? { language } : {}),
      ...(appLanguage ? { appLanguage } : {}),
    });

  it("writes the reply and the new name in the languages the first message asked for", async () => {
    const out = await run("pl", "pl");
    expect(out.kind).toBe("source");
    if (out.kind !== "source") return;
    expect(replyLanguage(out.rationale ?? "")).toBe("pl");
    expect(checkLabels(newLabels(out.source, RECIPES), "pl").passed).toBe(true);
  });

  it("replies in Polish but keeps an English app's new name English", async () => {
    const out = await run("pl");
    if (out.kind !== "source") throw new Error(out.kind);
    expect(replyLanguage(out.rationale ?? "")).toBe("pl");
    expect(checkLabels(newLabels(out.source, RECIPES), "en").passed).toBe(true);
  });

  it("writes English when no language line reached it", async () => {
    const out = await run();
    if (out.kind !== "source") throw new Error(out.kind);
    expect(replyLanguage(out.rationale ?? "")).toBe("en");
    expect(checkLabels(newLabels(out.source, RECIPES), "pl").passed).toBe(false);
  });
});
