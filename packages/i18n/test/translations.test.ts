// Every translation is still the same message (#300): it parses as ICU, it uses exactly the source's
// placeholders, its plurals have the arms the language needs, and its selects keep their arms.
//
// The drafts are written by a model (owner decision, #297), so this is the one place a slip shows
// before a person reads it: a placeholder translated into a word (`{nazwa}`), a lost `#`, a plural
// with only English's two forms in Polish, or an apostrophe that ICU read as a quote and swallowed
// the `{name}` after it (Italian's `dell'{name}`).

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parse, type Token } from "@messageformat/parser";
import { getConfig } from "@lingui/conf";
import { getCatalogs } from "@lingui/cli/api";
import { i18n } from "@lingui/core";
import { LOCALES, SOURCE_LOCALE } from "../src/locale.js";
import { messages as pl } from "../locales/pl/messages.po";
import { messages as de } from "../locales/de/messages.po";

const config = getConfig({ configPath: fileURLToPath(new URL("../lingui.config.ts", import.meta.url)), skipValidation: true });

/**
 * The plural categories a translation must write, exactly (the `=0`/`=1` arms aside, which follow
 * the source). Polish needs four; the others two. CLDR also knows `many` for very large numbers in
 * Spanish, Italian and Portuguese ("1 millón de…"); a translation may add it, and `other` covers it
 * when it does not.
 */
const REQUIRED: Record<string, readonly string[]> = {
  "pt-BR": ["one", "other"],
  de: ["one", "other"],
  es: ["one", "other"],
  pl: ["one", "few", "many", "other"],
  it: ["one", "other"],
};
const OPTIONAL: Record<string, readonly string[]> = { "pt-BR": ["many"], es: ["many"], it: ["many"] };

/** What a message is made of, as a translation must keep it: arguments, plurals with their exact arms, selects with their arms. */
interface Shape {
  args: Set<string>;
  plurals: Map<string, { exact: string[]; categories: string[] }>;
  selects: Map<string, string[]>;
  octothorpes: number;
}

function shapeOf(message: string): Shape {
  const shape: Shape = { args: new Set(), plurals: new Map(), selects: new Map(), octothorpes: 0 };
  const walk = (tokens: Token[]): void => {
    for (const tok of tokens) {
      if (tok.type === "argument" || tok.type === "function") shape.args.add(tok.arg);
      else if (tok.type === "octothorpe") shape.octothorpes++;
      else if (tok.type === "plural" || tok.type === "select" || tok.type === "selectordinal") {
        shape.args.add(tok.arg);
        const keys = tok.cases.map((c) => c.key);
        if (tok.type === "select") shape.selects.set(tok.arg, [...keys].sort());
        else
          shape.plurals.set(tok.arg, {
            exact: keys.filter((k) => k.startsWith("=")).sort(),
            categories: keys.filter((k) => !k.startsWith("=")).sort(),
          });
        for (const c of tok.cases) walk(c.tokens);
      }
    }
  };
  walk(parse(message));
  return shape;
}

const live = (catalog: Record<string, { obsolete?: boolean; message?: string; translation?: string }>) =>
  Object.entries(catalog).filter(([, m]) => !m.obsolete);

describe("translations keep the message", () => {
  for (const locale of LOCALES.filter((l) => l !== SOURCE_LOCALE)) {
    it(`${locale}: every message translated, placeholders, plurals and selects intact`, async () => {
      const [catalog] = await getCatalogs(config);
      const source = live(await catalog!.read(SOURCE_LOCALE));
      const theirs = new Map(live(await catalog!.read(locale)));
      const problems: string[] = [];
      let translated = 0;
      for (const [id, m] of source) {
        const english = m.translation || m.message || id;
        const translation = theirs.get(id)?.translation;
        if (!translation) {
          problems.push(`missing: ${english}`);
          continue;
        }
        translated++;
        let want: Shape;
        let got: Shape;
        try {
          want = shapeOf(english);
          got = shapeOf(translation);
        } catch (e) {
          problems.push(`does not parse (${(e as Error).message}): ${translation}`);
          continue;
        }
        const args = (s: Shape) => [...s.args].sort().join(",");
        if (args(got) !== args(want)) problems.push(`placeholders {${args(got)}} instead of {${args(want)}}: ${translation}`);
        for (const [arg, arms] of want.plurals) {
          const theirArms = got.plurals.get(arg);
          if (!theirArms) {
            problems.push(`plural on ${arg} lost: ${translation}`);
            continue;
          }
          if (theirArms.exact.join() !== arms.exact.join()) problems.push(`exact arms ${theirArms.exact} instead of ${arms.exact}: ${translation}`);
          const required = REQUIRED[locale]!;
          const allowed = new Set([...required, ...(OPTIONAL[locale] ?? [])]);
          const missing = required.filter((c) => !theirArms.categories.includes(c));
          const extra = theirArms.categories.filter((c) => !allowed.has(c));
          if (missing.length || extra.length) problems.push(`plural arms ${theirArms.categories} (needs ${required}): ${translation}`);
        }
        for (const [arg, arms] of want.selects)
          if (got.selects.get(arg)?.join() !== arms.join()) problems.push(`select on ${arg} arms ${got.selects.get(arg)} instead of ${arms}: ${translation}`);
        // A `#` the source shows (the count) must still be shown somewhere.
        if (want.octothorpes > 0 && got.octothorpes === 0) problems.push(`the count (#) is gone: ${translation}`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
      expect(translated).toBe(source.length);
    }, 60_000);
  }
});

/** The id of an English message, found by its English (the compiled catalogs are keyed by hash). */
async function idOf(english: string): Promise<string> {
  const [catalog] = await getCatalogs(config);
  const hit = live(await catalog!.read(SOURCE_LOCALE)).find(([, m]) => (m.translation || m.message) === english);
  if (!hit) throw new Error(`no message "${english}" in the English catalog`);
  return hit[0];
}

describe("plurals with sample numbers", () => {
  it("Polish says 1 wpis, 2–4 wpisy, 5–21 wpisów, 22 wpisy", async () => {
    i18n.load("pl", pl);
    i18n.activate("pl");
    const id = await idOf("{0, plural, one {# record} other {# records}}");
    const say = (n: number) => i18n._(id, { 0: n });
    expect([1, 2, 4, 5, 12, 21, 22, 25, 101].map(say)).toEqual([
      "1 wpis",
      "2 wpisy",
      "4 wpisy",
      "5 wpisów",
      "12 wpisów",
      "21 wpisów",
      "22 wpisy",
      "25 wpisów",
      "101 wpisów",
    ]);
  });

  it("German says 1 Eintrag, otherwise Einträge, 0 included", async () => {
    i18n.load("de", de);
    i18n.activate("de");
    const id = await idOf("{0, plural, one {# record} other {# records}}");
    expect([0, 1, 2, 5].map((n) => i18n._(id, { 0: n }))).toEqual(["0 Einträge", "1 Eintrag", "2 Einträge", "5 Einträge"]);
  });

  it("every plural in every language has the arm its rules pick for 0, 1, 2, 3, 5, 12, 22, 101 and 1.5", async () => {
    const [catalog] = await getCatalogs(config);
    for (const locale of LOCALES.filter((l) => l !== SOURCE_LOCALE)) {
      const rules = new Intl.PluralRules(locale);
      for (const [, m] of live(await catalog!.read(locale))) {
        if (!m.translation) continue;
        for (const [, arms] of shapeOf(m.translation).plurals)
          for (const n of [0, 1, 2, 3, 5, 12, 22, 101, 1.5]) {
            const category = rules.select(n);
            // Only an optional category (Spanish "many" for millions) may fall back to `other`.
            const covered = arms.categories.includes(category) || (OPTIONAL[locale]?.includes(category) && arms.categories.includes("other"));
            expect(covered, `${locale} ${n} → ${category}: ${m.translation}`).toBe(true);
          }
      }
    }
  }, 60_000);
});
