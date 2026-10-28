---
title: App translations
description: One language in the source, catalogs beside it: how an app carries its words in other languages.
status: current
order: 30
---

# 30 · App translations: one language in the source, catalogs beside it

**Status: approved, 2026-10-19 (§9); built on `feat/app-catalogs`.** It replaces how docs/20 (#302) stores an app's words. docs/20's
`ctx.locale`, `ctx.format`, the resolution order and "records are never translated" stay.

The owner reviewed the examples' source on 2026-10-19 and rejected the inline maps: "we need to have a
separate file for the translations, not having a lot of custom code and the translation done in place,
something like i18n and .po files". About Groceries' six-language product dictionary: "people use this
in their own language, we just need translation for the interface not the items". The owner chose the
source text as the message id.

## 0. On one page

- **An app is written in one language**, its `language` ("en"). Every slot is a plain string:
  `label: "Water now"`. Inside functions, `ctx.t("watered {when}", { when })`. The source reads like a
  one-language app because it is one.
- **Translations live in catalogs, one `.po` file per language**: `locales/pl.po`, `locales/de.po`. The
  `msgid` is the source text (gettext and Lingui style, as Potyro's own words in `packages/i18n`).
  Plurals are ICU, in the source and in each `msgstr`, so Polish writes its own `few`/`many`.
- **One extractor** finds every message: each text slot of the definition, through the schema walker
  that already exists (`schema/src/words.ts`), and each `ctx.t("…")` call whose first argument is a
  literal. It writes `locales/messages.pot` and merges it into each `.po`.
- **Lookup happens once, in the runtime.** `localize(definition, language)` replaces each slot's source
  string with its `msgstr`; `ctx.t` looks up the same catalog. A message with no translation, or a
  stale one, shows the source text: an English word, never a blank and never an error.
- **Catalogs travel with the code**, as the app's modules do (#258): in the package, in the app record,
  in a demo link. An app never opens before its catalog is there, so it never flashes English.
- **The model writes and edits only the app's language.** Translating is the person's choice, never
  automatic: most people make apps for themselves. "Translate into…" (and "Update translations") fills
  new or changed messages in each catalog, and never touches the code.
- **People's content is never translated**, and no app carries word lists in several languages to guess
  things about it. Groceries' `STAPLES` dictionary goes (§6).
- **Old apps keep working.** An inline map `{ en, pl }` is still read, as before, but deprecated: the
  generator no longer writes one, and a codemod moves the examples and showcase apps to catalogs (§7).

## 1. What an app looks like

```ts
// plants.app.ts
export default defineApp({
  id: "plants",
  name: "Plants",
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"], // the catalogs it carries
  pages: [{
    id: "today",
    title: "Today",
    summary: [{ label: "to water today", value: async (_r, ctx) => (await ctx.query("plant")).filter((p) => p.overdue).length }],
    layout: { type: "grid", items: [{ title: "Water now", view: { /* … */
      secondary: (p, ctx) => ctx.t("watered {when}", { when: ctx.format.relative(p.lastWatered, { unit: "day" }) }),
    } }] },
  }],
});
```

```po
# locales/pl.po
msgid "Today"
msgstr "Dziś"

msgid "watered {when}"
msgstr "podlana {when}"

msgid "Every {n, plural, one {day} other {# days}}"
msgstr "Co {n, plural, one {dzień} few {# dni} many {# dni} other {# dnia}}"
```

**Same words, different meaning.** Rarely, one English string needs two translations ("Water" the verb,
"Water" the noun). The object form `{ text: "Water", context: "verb" }` adds a `msgctxt`, in a slot and
in code alike: `ctx.t({ text: "Water", context: "verb" })`.

**Words kept behind a const.** The extractor reads literals. Words written once and shown elsewhere
(`const EMPTY = …`, a table of state names in `./words.ts`, a helper with no `ctx`) are marked where they
are written with `msg("…")`, gettext's `N_`: it returns its text unchanged, and the extractor takes it.
They are shown through `ctx.t(EMPTY)`, or as the slot's value. A slot that names an unmarked const is
reported (`behind-code`), because a translator would never see its words.

## 2. Where catalogs live

| | Today | With catalogs |
|---|---|---|
| Package (`potyro-app/1` zip) | words inside `app.ts` | `locales/<lang>.po` at the top level, beside `src/` and `lock.json`; listed in the manifest |
| Saved app (`UserApp`) | words inside `source` | `catalogs`: one entry per language, stored and synced like the app's modules, by file and digest |
| Bundled example | words inside `examples/<id>.app.ts` | `examples/files/<id>/locales/<lang>.po`, seeded into the app's Files |
| Showcase app | words inside `apps/<id>/<id>.app.ts` | `apps/<id>/locales/<lang>.po`, shipped in its package by `pack-app` |
| Demo / share link | words inside the source | the catalogs ride with the source, as its modules do |
| Sealed box | the definition, already localized | the same, plus the ONE catalog of the shown language for `ctx.t`, passed as data at load |

Only the shown language's catalog is loaded and parsed: a few KB. `.po` is parsed on save, and the app
record keeps the compiled form, a `{ msgid → msgstr }` map, so opening an app parses nothing.

## 3. Lookup

1. The person's language (You → Language) if the app carries it; else the app's own language.
2. Each slot: its source text, looked up in that catalog; else the source text. `localize()` does it
   once. Views keep reading plain strings and do not change (as in docs/20 §3).
3. `ctx.t(text, vars)`: the same lookup, then ICU formatting with `vars` in the shown language. In the
   sealed box it is local: the catalog was passed in, so no bridge call is needed.
4. A legacy inline map is resolved as today, before any catalog is consulted.

## 4. Extract and compile

`pnpm i18n:app <app source> <locales folder>` (`--check` fails when a catalog is out of step), and the
same code inside the Studio (`packages/generator/src/app-catalog.ts`). An app's own test asks the shared
`catalogProblems` check: no map left in the code, a catalog per language, in step, every word translated
and every `{placeholder}` kept (read as ICU, so words inside plural branches are not placeholders).

- **Slots**: the schema walker visits every `zWords` slot of the definition and collects its string. The
  list of slots is the schema itself, so it cannot drift (docs/20 §1.2).
- **Functions**: a parse of the source and of the app's own modules (`./words.ts`, followed through its
  relative imports) collects every `ctx.t(...)` and `msg(...)` whose first argument is a string literal
  or a `{ text, context }` object. `ctx.t(variable)` is fine when its words were marked with `msg`.
- **References** name the slot (`pages.0.title`) or just `ctx.t` / `msg`, never a line number, so an
  edit above a message does not churn every catalog.
- **Merge**: new msgids are added untranslated. A msgid that disappeared is marked obsolete (`#~`) and
  kept, so a rename that comes back finds its translation. A msgid that changed only a little is matched
  to its old entry and marked `fuzzy`. A fuzzy entry shows the source text until it is translated again.
- **Compile**: each `.po` becomes the `{ msgid → msgstr }` map the runtime reads. Lingui's `po` format
  package reads and writes the files, so they match the shell's.

## 5. Studio, generator and the translate step

- The reference and the corpus show apps in one language. The model is never asked for a map, and an
  edit is one SEARCH/REPLACE in one place. This also returns the many tokens six-language maps cost
  every prompt (docs/20 §7.1).
- An app made in the Studio carries ONE language, the person's, and no catalogs. Most people make apps
  for themselves; nothing is translated, and no allowance is spent on it, unless they ask.
- **Translating is on request** (owner, 2026-10-19: not automatic). Where the app's languages are
  listed, "Translate into…" adds a language, and "Update translations" appears when a catalog has new,
  fuzzy or missing messages ("4 missing in Polish"). Both run the **translate step**: extraction, then
  ONLY the messages that need it (new, or fuzzy after their text changed), numbered, each with where it
  shows and any older translation, to the model in one JSON answer per 120 messages
  (`packages/generator/src/app-translate.ts`). A translation that changes a message's `{placeholders}`
  is left out, so the app shows the source text there rather than a broken message. It writes the catalogs and never the code, through the app's AI
  allowance like any other Studio call.
- Until then, the app works and shows the source text for what is missing.
- `check` reports a literal-free `ctx.t`, a slot map in a new app (deprecated), and `msgctxt` needs.
  It does not report missing translations: those are the translate step's job, not the model's.

## 6. Content is never translated

- Records stay as the person wrote them. Sample records are written in the app's own language.
- No word lists in several languages in an app's code or data. Groceries' `STAPLES` and `AISLE_WORDS`
  regexes are removed:
  - an item's aisle comes from where the same item went last time, which already works; a new item asks
    with one tap ("Tap the aisle for …"), which also already works;
  - an item's emoji is the basket, unless the person gives the item one.
- The rule for the reference, and so for every app the model writes: never guess about people's
  content from a built-in list of words. Learn from what the person did, or ask once.

## 7. Migration

- **Back-compat**: inline maps keep working, read as in docs/20. A shared app made before this opens
  unchanged. No `schemaVersion` moves: no records change.
- **Codemod** (`pnpm --filter @potyro/generator maps-to-po <source> <locales folder>`), for the 6
  examples and 9 showcase apps, and their own modules:
  - every slot map becomes its default-language string, and the other languages become entries in
    `locales/<lang>.po`;
  - every `ctx.t({ en: …, … }, vars)` call becomes `ctx.t("…", vars)` the same way;
  - one text translated two ways in one file gets a `msgctxt` per meaning; words behind a const are
    marked with `msg`, and the import added;
  - checked: the examples localize identically before and after in all six languages, apart from the
    dictionary removed in §6; the showcase apps' 3,475 translations re-derived from the old maps match
    their catalogs but for 2, one English word translated two ways in two files, now one.
- Expected effect: the examples' source shrinks by about a fifth to a third (measured 2026-10-19: up to
  33% of an app's source was other languages).

## 8. Build order

1. Catalog runtime: compiled maps on the app record and in packages, lookup in `localize()` and
   `ctx.t`, the sealed box, legacy maps kept. With tests in both trusted and sealed boxes.
2. Extractor, merge and compile; `pnpm i18n:app`; the corpus and reference in one language.
3. Codemod for the examples and showcase apps; Groceries without `STAPLES`; e2e in Polish still green.
4. Studio: "Translate into…" and "Update translations" (on request), "N missing" shown; catalogs
   editable in the app's Files.
5. docs/04, docs/05 and docs/20 updated; `gen:reference` and `gen:corpus` regenerated.

## 9. Decided (owner, 2026-10-19)

1. **The translate step runs on request, never automatically**: "most of the users will be creating apps
   for themselves and not interested in translating them".
2. **People fix a translation in the app's Files**: `locales/pl.po` is listed there and editable, and a
   saved edit is compiled and used at once. A simpler "Fix a word" sheet can come later if people ask.
