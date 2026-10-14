# 20 · Multi-language apps — an app carries translations of its own words

**Status: built in #302 (part of the i18n epic #297).** The owner approved this design on
2026-10-13 with every recommendation of §8 as written. §10 lists where the build differs from the
text below, and why; everything else is as written.

#298 (the shell's own catalogs, You → Language, the six locales) is being built in parallel. This
doc covers only **the app's words**: the labels, titles and messages an app author wrote. Potyro's
own words ("Edit", "Delete", "New …") belong to #298.

## 0. The proposal on one page

- A new type, **`Words = string | { [language]: string }`**. Every declarative slot that is shown to
  a person as text accepts it: entity and field labels, help, placeholders, page titles, group and
  section titles, empty texts, action and button labels, summary and stat labels, chart titles, and
  **new** option labels for enums and tags (§1). A plain string still works as before.
- **`language: "en"`** declares the language the app is written in. **`languages: ["en", "pl", "de"]`**
  lists every language it carries, the default included. Every map must contain the default
  language: Zod checks that. A missing *other* language is not an error. It falls back per string,
  and the generator's `check` reports it so the model keeps the languages in step.
- Inside functions, **`ctx.locale`** is the language the app is being shown in.
  **`ctx.t(words, vars?)`** picks from a map, and with `vars` formats ICU messages (plurals).
  **`ctx.format.date/number/money/relative/list`** format for the person. The sealed box has no
  `Intl`, so the host answers these through one new synchronous, authority-free bridge call. That
  costs about 25 µs a call in the box (measured, §2.4). In the person's own apps it is plain `Intl`.
- **Resolution** is the person's language, then the app's default, then the first available. It
  happens once in the runtime (`localize(definition, language)`), so **views keep reading plain
  strings and do not change.**
- **Old apps are unchanged.** No stored data changes, so no app's `schemaVersion` moves (§4 explains
  why that does not break the CLAUDE.md rule).
- **The words stay inline in the source.** Translations are not a table keyed by path and not
  package files. A whole new language is added through a structured `translate` tool, which splices
  `de: "…"` into every map, rather than through 80 SEARCH/REPLACE blocks (§7).
- **Records are never translated.** An enum's stored value is a stable key; only its label changes
  by language.

## 1. The declarative shape

### 1.1 The type

```ts
// packages/schema/src/types/words.ts (new)

/** A BCP 47 language tag: "en", "pl", "pt-BR", "de-CH". */
export type Language = string;

/**
 * Words shown to a person: one string, the same in every language, or the string per language.
 * A map MUST contain the app's `language` (its default).
 *
 *   label: "Nights"
 *   label: { en: "Nights", pl: "Noce", de: "Nächte" }
 */
export type Words = string | { readonly [language: Language]: string };
```

The type is called `Words`, not `Text`. `Text` is already a DOM global (the text node), and
`types/app.ts` is compiled with the DOM lib.

### 1.2 Which slots take `Words`

This list is complete against `packages/schema/src/types/*` as of `976a175`. In the implementation it
exists **once**: a `zWords` schema is used at each of these slots, and the one walker that the
default-language check, `localize()` and the completeness check all share is derived from it, the way
`VIEW_FIELDS` is derived from the Zod schemas. So the list cannot drift from what is enforced.

| Where | Slot | Today | Becomes |
|---|---|---|---|
| `AppDefinition` | `name` | `string` | `Words` |
| `ScopeDef` | `label` | `string?` | `Words?` |
| `QuickAction` | `label` | `string` | `Words` |
| `EntityDef` | `label` | `string?` | `Words?` |
| `FieldGroup` | `title` | `string?` | `Words?` |
| `ActionDef` | `label` | `string?` | `Words?` |
| `FieldCommon` (every field, including `list.of` sub-fields and `ActionDef.input`) | `label`, `help`, `placeholder` | `string?` | `Words?` |
| `NumberField`, `StatItem` | `unit` ("days", "kg") | `string?` | `Words?` |
| `EnumField` | **`labels`** (new), keyed by option | — | `Record<string, Words>?` |
| `TagsField` | **`labels`** (new), keyed by option | — | `Record<string, Words>?` |
| `Page` | `title` | `Dynamic<string>` | `Dynamic<Words>` |
| `PageAction` | `label` | `string` | `Words` |
| `LayoutItem` | `title` | `string?` | `Words?` |
| `SummaryValue` / `StatItem` | `label`, `compare.label` | `string` | `Words` |
| `FilterChip` | `label`, `placeholder` | `string` | `Words` |
| `DetailSection` | `title` | `string?` | `Words?` |
| `DetailAction` (navigate form) | `label` | `string` | `Words` |
| `ListView`, `GalleryView`, `ChecklistView`, `TimelineView`, `AggregateView`, `ChartView` | `emptyText` | `Dynamic<string>?` | `Dynamic<Words>?` |
| `AggregateView` | `title` | `Dynamic<string>?` | `Dynamic<Words>?` |
| `ChartView` | `title`, `subtitle` | `Dynamic<string>?` | `Dynamic<Words>?` |

`ctx.ui` accepts `Words` wherever it takes words: `toast`, `confirm` (message, `detail`, `ok`,
`cancel`), `prompt`, `sheet`/`menu` (`title`, `UiItem.label`/`detail`), `form` (`title`, `submit`,
and the fields' own labels, which are `FieldCommon` anyway), and `progress`. The host resolves them.
That is needed for `form` regardless, and it means a model that passes a map to `toast` gets the
right words instead of `[object Object]`.

**Deliberately not `Words`:**

- **Enum and tags option values** (`options: ["todo", "done"]`). They are what records store, so
  they are data, never words (§6). Their *labels* are words, in the new `labels` record. It sits
  beside the existing `colors` record and is keyed the same way, so `options` keeps its type and
  nothing that reads it changes. Without `labels`, an option shows its value, as today.
- **`Binding` strings** (`title: "name"` on a calendar, a map or a reminder). A string binding is
  a **field key**, not text. Text built from a record is a function, and uses `ctx.t`.
- **A field's literal `default`.** It becomes a record the moment one is created. A translated
  default is `default: (ctx) => ctx.t({ en: "Untitled", pl: "Bez tytułu" })`, written once, in
  the creator's language, like any other record.
- **`description` on `ActionDef` and `SourceDef`, and `SourceDef.docs`.** These are read by the
  model (Ask), not by the person, and the epic keeps model-facing text in English. Ask answers in the
  person's language anyway (#297, step 4). See open question Q6.
- `icon`, ids and keys, colours, currency codes, `DurationField.unit`. These are codes, not words.

Function **results** that are displayed (`ListDisplay.secondary`, `AggregateRow.label`/`detail`/
`group`, `ChartPoint.label`/`text`, reminder `title`/`body`, a computed that returns a word) stay
`string`. A function builds its string with `ctx.t`. The one exception follows from the type: a
`Dynamic<Words>` slot is `Words | (ctx) => Words`, so its function may return a map. See Q7.

### 1.3 Declaring the languages

```ts
export interface AppDefinition {
  // …
  /** The language this app's words are written in, and the one every map must contain. */
  language?: Language;
  /** Every language the app carries, the default included. Defaults to `[language]`. */
  languages?: Language[];
}
```

- **`language` is optional for compatibility, but the generator always writes it**, including for
  a one-language app whose strings are all plain. That is how the shell knows a Polish-only app is
  Polish (§3.3).
- An app that uses a map **must** declare `language`. Zod reports the map's path: *"`pages[0].title`
  is a translation map, so the app needs `language:` saying which one is its own"*.
- `languages` must contain `language`, and its tags must be well-formed BCP 47
  (`/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/`). Any language may be declared, not
  only the six the shell ships. A French app is fine. The shell's own words are then in English
  (or whatever the person chose), and the app's are in French.
- A map key that is not in `languages` is a Zod error. It is almost always a typo (`"pt_BR"`,
  `"ge"`), and silently carrying it would be a translation nobody ever sees.

### 1.4 Validation

Two phases, like the referential checks that already run after `structureSchema`:

1. **Shape** (`zWords`): a string, or an object whose keys are language tags and whose values are
   non-empty strings. Used at every slot in §1.2.
2. **App-level** (`checkWords(def)`, beside `checkReferences`): `language` is declared if any map
   exists, every map contains `language`, every key is in `languages`, and every `labels` key is one
   of the field's `options`.

Neither phase complains about a map that lacks a *non-default* language. That is not wrong data.
It is an unfinished translation, and the runtime falls back for that one string. Completeness is
the generator's business (§5.2), not the loader's. That matters for a shared app: a newer member
adds `de` to three labels, and an older copy must still load.

A **plain string in a multi-language app** means "the same in every language". That is right for
"OK", a brand name or an emoji, so it is not flagged by Zod. The generator's check lists plain
strings in an app with more than one language as a note (not a failure), because "forgot to
translate" and "the same everywhere" look identical.

## 2. Words inside functions

### 2.1 What `ctx` gains

```ts
export interface Ctx {
  // …
  /** The language the app's words are being shown in: one of the app's `languages` (or its
   *  `language` when none matched). Fixed per evaluation pass, like `now()`. */
  locale: Language;

  /**
   * Pick the words for `ctx.locale`. With `vars`, the chosen string is an ICU message:
   *   ctx.t({ en: "{n, plural, one {# plant} other {# plants}}",
   *           pl: "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}" }, { n })
   * A plain string passes through (and is formatted when `vars` are given).
   */
  t(words: Words, vars?: Record<string, string | number | Date>): string;

  /** Formatting for the person. Works the same in the sealed box, which has no `Intl`. */
  format: CtxFormat;
}

export interface CtxFormat {
  /** The BCP 47 tag the helpers format in (`"pl-PL"`, `"en-GB"`), for a trusted custom view's own `Intl`. */
  locale: string;
  date(d: Date | string | number, opts?: {
    dateStyle?: "full" | "long" | "medium" | "short"; timeStyle?: "short" | "medium";
    weekday?: "long" | "short"; day?: "numeric" | "2-digit"; month?: "long" | "short" | "numeric";
    year?: "numeric" | "2-digit"; hour?: "numeric" | "2-digit"; minute?: "2-digit";
  }): string;
  number(n: number, opts?: {
    style?: "decimal" | "percent" | "unit"; unit?: string;            // unit: Intl's sanctioned units
    minimumFractionDigits?: number; maximumFractionDigits?: number; signDisplay?: "auto" | "always" | "exceptZero";
  }): string;
  /** Whole minor units, as a `money` field stores them (KA-26): money(4200, "EUR") → "42,00 €". */
  money(minor: number, currency?: string): string;
  /** From `ctx.now()`: "in 3 days", "vor 2 Stunden". The unit is picked unless given. */
  relative(d: Date | string | number, opts?: { unit?: "minute" | "hour" | "day" | "week" | "month" | "year"; numeric?: "auto" | "always" }): string;
  list(items: string[], opts?: { type?: "conjunction" | "disjunction" }): string;
}
```

`relative` measures from `ctx.now()`, so it is deterministic within a pass, as docs/04 requires of
time.

These replace hand-written helpers that exist today and are wrong outside English. `plants.app.ts`
has its own `relativeTime` ("in 3d", "3d ago"). `formatMoney` from `potyro` calls `Intl`, so it
throws in the sealed box (#271/#272).

### 2.2 Two formatting languages, on purpose

`ctx.locale` is the language of the **words** (`"pl"`, picked from the app's `languages`).
`ctx.format.locale` is the person's **formatting** locale, which carries their region (`"en-GB"` →
13/10/2026, `"en-US"` → 10/13/2026). The rule: format in the person's locale when its language is
`ctx.locale`'s language, otherwise in `ctx.locale`. A Pole looking at an English-only app reads
"Oct 13", not "13 paź", inside an English sentence.

### 2.3 How the host provides them

- **Trusted apps (`make-ctx.ts`).** `locale`, `t` and `format` are built from a new
  `packages/host/src/format.ts`: `Intl` in the page, with a small cache of `Intl.*Format`
  instances keyed by locale and options. `base` gains `language` and `formatLocale` (from the
  runtime, §3).
- **Untrusted apps (the isolate).**
  - `ctx.locale` and `ctx.t(words)` **without `vars` never leave the box.** The harness's
    `makeCtx` receives `p.locale` and `p.languages` in each call's payload, exactly as it receives
    `p.nowIso` and `p.scope` today, and picks from the map in plain ES2020. That costs about 0.5 µs.
  - `ctx.t(words, vars)` and every `ctx.format.*` go through **one new synchronous VM function,
    `__hostPure(json) → string`.** It is not `__hostSync`, which returns nothing and is
    fire-and-forget. It is not the async `bridge`, because a formatter must return a value
    synchronously inside a `filter` or a `sort`. It is safe to make synchronous because it touches
    no state: no store, no caps, no person, only `Intl` and the ICU formatter over the arguments it
    is given. The VM is never suspended (asyncify stays gone, #112).
  - **The host validates every request** before formatting. The op must be one of
    `date|number|money|relative|list|t`. Options are an allow-list (the keys in §2.1, so no
    `timeZone` lookups and no `calendar` games). There are size caps: a list of at most 1,000 items,
    and strings and messages of at most 10,000 characters. The locale is the host's, never the
    app's. Host time counts against the call's wall-clock deadline, as everything inside `enter()`
    already does.
- **`mediate.ts` does not change.** Formatting is not a capability. There is nothing to grant or
  deny, as with `ctx.files`.
- **The same `format.ts` serves both runners**, so a date reads identically at both provenances. A
  parity test (one table of inputs, `DirectHost` against `IsolateHost`) keeps it so.
- **ICU messages:** the runtime half of whatever #298 lands. Lingui compiles the shell's messages at
  build time, but app messages arrive at run time, so the host needs a run-time ICU formatter. That
  is the small `@messageformat`/`intl-messageformat`-class parser, loaded lazily the first time an
  app calls `t` with `vars`. If #298 ships one, reuse it. **If #272 moves shared apps to a real
  browser realm, `__hostPure` becomes unnecessary** (the worker has `Intl`), but `ctx.format`
  stays: it is still the one place the *person's* locale is known. *(2026-10-14: it did — shared
  apps' logic runs in the realm, which bundles `format.ts`; `__hostPure` serves only the QuickJS
  fallback until that is removed, docs/22 §8.)*

### 2.4 What it costs

*Historical since #272 (2026-10-14): a shared app's formatting no longer crosses at all — it is 5–30×
faster in the realm (docs/22 §6). These are the QuickJS fallback's numbers.*

Measured on this machine (Node 22, quickjs-emscripten 0.31, 10,000 calls, cached formatter):

| Call | Per call |
|---|---|
| `Intl.DateTimeFormat#format` directly (trusted apps) | ~1.7 µs |
| `ctx.t(map)` inside the box, no `vars` | ~0.5 µs |
| `ctx.format.date` through a synchronous `__hostPure` (JSON both ways) | ~25 µs |

So 1,000 formatted cells in an aggregate cost about 25 ms on a desktop, and perhaps 3–5× that on a
mid-range phone (not measured yet; measure before calling it done). Guidance for the reference and
the generator prompt: **return a `Date` or a number where a view will format it** (a `money`
column, a `datetime` field, `AggregateRow.value` as a number). Call `ctx.format` only for text the
app composes itself. A batch form (`ctx.format.many([...])`) is easy to add later if a real app
needs it. YAGNI until then.

## 3. Resolution

### 3.1 The order

```
prefs    = the person chose a language under You → Language ? [that one] : the device's languages
                                                              (navigator.languages / Android, in order)
language = for p of prefs: an exact tag in app.languages            ("pt-BR" → "pt-BR")
                         | else the same base language in app.languages ("pl-PL" → "pl", "pt-PT" → "pt-BR")
           else app.language
           else (no `language`: an old app) none — strings are shown as written

word(w)  = typeof w === "string" ? w
         : w[language] ?? w[app.language] ?? w[first of app.languages present in w] ?? Object.values(w)[0]
```

The last two fallbacks exist only for data that should not exist, such as a copy from a newer
Potyro or a hand-edited source. They keep it readable rather than blank, in line with "no noise for
blocked data".

An explicit choice under You → Language wins outright. Someone who chose English on a German phone
gets English apps, not German ones. Following the device uses the device's whole list, so a
French-speaking person (no French shell yet) still sees an app's French.

### 3.2 Where it happens

- **`packages/schema`** exports the pure parts: `pickLanguage(prefs, app)`, `word(w, language,
  app)` and `localize(definition, language)`. The last returns the definition with every `Words`
  slot replaced by its string, using the single walker of §1.2. It works the same on a live
  definition (trusted) and on the extracted JSON definition (untrusted, functions as sentinels),
  because maps are data in both.
- **`packages/runtime`** calls `localize` when it builds the `Runtime` and again when the person
  switches language. `Runtime.definition` is the **localized** definition, and `Runtime` gains
  `language: { current, default, available }`. Every function call it makes passes `language` and
  `formatLocale` into the ctx. Computed memos are per pass already, so a switch recomputes text
  that depends on `ctx.locale`. Reminders are reconciled on a switch, so scheduled notifications
  are re-titled.
- **`packages/views` does not change** for app words: it already reads `definition` strings.
  (Formatting of dates and numbers *in* views is #298/#299's job, and should use the same
  `formatLocale`.)
- **`packages/shell`**: the launcher tile, the app switcher and the Studio read `name` through
  `word()`. The stored `UserApp.name` (`user-apps.ts`) stays a string: the name in the app's default
  language, which is what renaming edits. The tile resolves the source's `name` map when it has one.

### 3.3 When the app lacks the person's language

The app opens in its default language, with no banner on every open. The app's info sheet (where
version and sharing already live) says one quiet line: *"This app is in English."* Where the person
can edit the app, the line offers **"Translate into Polski"**, which opens the Studio with that
request. Potyro's own chrome around the app stays in the person's language, so a Polish shell around
an English app is expected and fine.

One consequence for #298/#299: **shell templates that wrap app words must not assume grammatical
agreement.** "New {entity}" becomes "Nowy/Nowa/Nowe …" in Polish and "Neuer/Neue/Neues …" in German,
and the shell cannot know the gender of an app's noun. See Q3.

## 4. Backward compatibility and `schemaVersion`

- **Every existing app is valid and renders identically.** `string` is a `Words`. An app without
  `language` skips resolution entirely.
- **No stored data changes.** Option values, records and kv are untouched. Nothing to migrate.
- **What `schemaVersion` is.** CLAUDE.md says a change to `defineApp`'s shape or to `ctx` "bumps
  `schemaVersion`". In the code, `schemaVersion` is **each app's own data-format version**. It is
  compared against the store's `meta.schema_version` (docs/06, `migrate-on-load.ts`), and
  `schema-drift.ts` treats a bump as "this edit changed the data model". There is no platform-wide
  schema version to bump. The precedent is docs/04's own note on `ctx.ui` (#112): *"new optional
  members: no existing app changes, so `schemaVersion` (the app's own data version) is not bumped."*
  This change is the same kind: additive, optional, and no record changes. So:
  - **Apps do not bump `schemaVersion` to gain or add a language.** If the generator bumped it, the
    schema-drift gate would read a translation as a data-model change.
  - **The PR notes the contract change for other agents** (CLAUDE.md protocol): docs/04 (`ctx.locale`,
    `t`, `format`), docs/05 (the localized `Runtime.definition`, `__hostPure`), the types, the
    regenerated reference, and every consumer of the changed slots (`app-source.ts`'s inspector, the
    Ask structure summary, `tile-identity`).
  - See Q1 to confirm this reading of the rule.
- **Forward compatibility.** A device still on an older Potyro that receives a translated app (sync,
  a share link) fails Zod on the first map, because `z.string()` rejects an object. The app does not
  load and the add/update dialog says why. Silently rendering `[object Object]` would be worse.
  The PWA updates itself on next open, so this window is short. No `minPotyro` field is proposed.
- **Source migration:** none required. The generator does **not** rewrite old apps to add `language`
  on its own. It adds it on the next edit that touches the app (the reference shows it at the top of
  every example).

## 5. Studio and the generator

### 5.1 How the model writes and edits

- **A new app is written in one language, the person's**, with `language:` set to it and plain
  strings. A Polish request yields `language: "pl"` and Polish words. Multi-language apps are opt-in,
  because each extra language costs source size and tokens (§7).
- **"Translate this app into German"** goes through a new modify-loop tool, **`translate`**. It
  lists every `Words` slot of the current source with its path, its current values and whether a
  literal sits behind it, plus the strings inside functions that are not wrapped in `ctx.t` yet. The
  model answers with `{ path: "…" }` for the new language. The host splices `de: "…"` into each
  literal map (turning a plain string into `{ en: "…", de: "…" }`) with the same *"parse for
  positions, splice text, never reprint"* machinery as `app-source.ts`, adds `"de"` to `languages`,
  and runs `check`. Strings inside functions still go through SEARCH/REPLACE, because only the model
  can decide how a template literal becomes `ctx.t(...)`. A whole language therefore costs one tool
  answer plus a few edits, not 80 SEARCH blocks, any one of which could be missed.
- **Ordinary edits keep every language in step.** Because the maps are inline, renaming a label is
  one SEARCH/REPLACE over one map, and the model sees all its languages in the block it is editing.
  `check` adds a **completeness report**: every slot (and every `ctx.t` map, found by parsing) that
  lacks a language in `languages`. A candidate that **adds** a gap fails `check`, so a new field
  without its `pl` label is sent back. A gap that already existed is only reported, since it may be
  a deliberate partial translation from a person.
- **"Change the English and leave the rest"** is a valid request. The model is told that changing
  one language of a map makes the others stale, and it says so in `Not done:` if it was asked not to
  touch them.
- **The direct structural editor** (`app-source.ts`, docs/04 "Direct structural edits") shows one
  input per language for a located map. Editing the default language marks the other languages of
  that slot as "may be out of date" in the panel only. Nothing is written to the source for that.
- **Studio's conversation language** (#297 step 4) is independent. The person talks Polish, and the
  app's default can still be English.

### 5.2 What the reference and the corpus show

- **Reference** (`gen:reference` from `packages/schema/src/types`): `Words`, `language`/`languages`,
  `labels` on enum/tags, `ctx.locale`/`t`/`format`, each with a one-line doc comment that names the
  rule ("every map has the default language"; "records are never translated"; "return a Date or a
  number where a view formats it").
- **Corpus** (`gen:corpus`): one example becomes multi-language. That is `groceries` (small,
  checklist, declarative) in `en` and `pl`, with one enum gaining `labels`. `plants` replaces
  `relativeTime` with `ctx.format.relative` and gains a `ctx.t` plural. Every example declares
  `language: "en"`. The full "every example in six languages" is #297 step 6.
- **System prompt** (`prompt.ts`): three rules. Write in the person's language and declare it.
  Add a language only when asked, and then through `translate`. Every map has the default.

### 5.3 An eval

`eval:translate`, modelled on `eval:modify` and given a no-model fixture variant first (like
`eval:modify:fixture`, so the scorer itself is tested without spending anything):

| Scenario | Scored by (no judge model needed) |
|---|---|
| "Translate this app into German" on each example app | compiles and validates; **every** `Words` slot and `ctx.t` map has `de`; `localize(after, "en")` deep-equals `localize(before, "en")`, so nothing else changed; the shape-only diff (keys, fields, functions' source minus `ctx.t` wrapping) is empty; fewer than 10% of `de` strings equal their `en` (a cheap "it actually translated" proxy) |
| "Rename the Quantity label to Amount" in an `en`+`pl`+`de` app | that slot's three values all changed; no other slot changed |
| "Add a due date to items" in an `en`+`pl` app | the new field has `en` and `pl`; completeness has no new gaps |
| "Make the Polish say 'Ilość' instead" | only `pl` of that slot changed |
| A request in Polish on an `en`-default app ("dodaj pole notatki") | new words in **both** `en` and `pl`; default stays `en` |

Data safety rides on the existing `data-safety` and `schema-drift` checks: a translation must show
**no** drift and **no** `schemaVersion` bump. Paid runs only when the owner asks.

## 6. Sharing

- **The source is shared. Each device resolves its own language.** In a space with Ana (pl) and
  Bruno (de), Ana sees "Zakupy", Bruno sees "Einkäufe", and both see the same records.
- **Records are never translated.** "Milk" typed by Bruno stays "Milk" for Ana. An enum stores its
  option *value*: picking "Warzywa" in Polish stores `"produce"`, and Bruno sees "Gemüse". Tags typed
  by hand are records. Computed text is computed on each device, so it follows each person's
  language. Ask writes records in the asker's language.
- **Per-device things are per language:** reminders and notifications, toasts, formatted dates.
- **A member who edits a shared app** (same rules as any shared edit) edits all its languages. The
  model keeps them in step (§5.1). A newer copy with more languages than an older one still loads on
  the older one (§1.4: missing languages are not errors).
- **One limitation of enum apps written before this change:** many use words as values
  (`options: ["Produce", "Dairy"]`). Translating them adds `labels: { Produce: { en: "Produce",
  pl: "Warzywa" } }`, and the values stay English forever. That is correct, because they are keys,
  but a function that searches by what the person typed compares against the value, not the
  label (Q5).

## 7. Size, performance, and where the translations live

### 7.1 How big an app gets

Measured from the six example apps: **13–43** literal word slots per app (138–487 characters),
**0–30** enum options, and 2.8–28.8 kB of source. A translated app also needs explicit labels where
it relies on `humanizeKey` today, because "Bought by" cannot be humanized into Polish. So a typical
app carries **60–100 strings**, at ~12 characters each in English and ~30% longer in German.

Each added language costs about `, de: "…"` ≈ 6 + 15 bytes per string. With six languages:

| | One language | Six languages, inline |
|---|---|---|
| Strings | ~85 × ~14 B ≈ 1.2 kB | ~85 × ~125 B ≈ 10.6 kB |
| Typical app (8–14 kB) | 8–14 kB | **18–25 kB (≈ +10 kB, 1.8–2.3×)** |
| Words inside functions (aggregate labels, toasts, ~20) | — | another ~2.5 kB |
| Model tokens per modify prompt (source sent once per run) | — | **≈ +4–5 k tokens** (non-Latin and accented text tokenizes worse) |

The runtime cost is negligible. `localize` is one walk over ~100 slots, done once per language
switch (well under 1 ms), and the bundle grows by the same ~10 kB, which is cached offline with the
rest. **The real cost is model tokens and human readability.** That is why multi-language is
opt-in and why the alternatives below were weighed.

### 7.2 Three places translations could live

**A. Inline maps** at each slot (the proposal).

```ts
quantity: { type: "text", label: { en: "Quantity", pl: "Ilość", de: "Menge" },
            help: { en: "How much, in your own words", pl: "Ile — własnymi słowami", de: "Wie viel, in eigenen Worten" } },
```

**B. A `translations` table in the definition, keyed by path.**

```ts
translations: {
  pl: { "entities.item.fields.quantity.label": "Ilość", "pages.shopping.title": "Zakupy", "entities.item.groups.1.title": "Więcej" },
  de: { … },
},
```

**C. Package files**, one catalog per language (`translations/pl.json`, or PO like the shell),
shipped in the app's package (#251/#258) and read by the runtime.

| | A. Inline | B. Table by path | C. Package files |
|---|---|---|---|
| Rename a label (SEARCH/REPLACE) | one block; all languages in view | two edits, far apart; easy to forget the second | edits in N files |
| Add or remove a field | its words come and go with it | orphaned or missing keys, silently | same as B, across files |
| Rename a key or page id, reorder `groups`/`sections`/`summary`/`layout.items` | nothing to do | **paths break**: arrays have no stable key, so `groups.1` silently points at another group | same as B |
| Add a whole language | many splices, done by the `translate` tool | one appended block (cheap) | one new file (cheap) |
| Strings inside functions | `ctx.t({…})`, same shape | still inline `ctx.t` → **two mechanisms** | same as B |
| Human reading the source | structure is wordier; each slot is complete | structure reads like a one-language app | same as B, plus a familiar catalog |
| Validation | Zod, at the slot | a second resolver; dangling paths need their own check | as B, plus loading and caching files |
| Shared app arriving on a device | atomic with the source | atomic with the source | bytes come on demand (#255): the app can open before its catalog arrives and **flash the default language** |
| Size | +~10 kB in the source the model reads | same bytes, plus ~40 B of path per string | the source stays small for the model; the bytes move elsewhere |

**Recommendation: A, inline maps**, for three reasons:

1. **Locality is what keeps languages in step.** The failure that matters is drift: a label renamed
   in English but not in Polish, or a field added without its translations. With A the stale
   language sits in the very SEARCH block being edited, and `check` catches a new gap at the slot.
   B and C put the second copy somewhere the edit does not look, behind a path that breaks on the
   most ordinary edits (an array reordered, a field renamed). The SEARCH/REPLACE edit format (PR #71)
   is exactly the kind of local edit that does not maintain far-away invariants.
2. **One mechanism.** Strings in functions have to be inline (`ctx.t`) under every option. With A,
   declarative and functional words look the same, and the model learns one rule.
3. **The weak point of A, adding a whole language, is solved by tooling, not by the format.** The
   `translate` tool (§5.1) does the many splices from one structured answer. Path keys exist only
   for the duration of that one edit, resolved against the current source, so they cannot drift.

Readability mitigations for A, set as conventions in the reference and the corpus (never enforced
by reprinting): put a map on one line when it fits in about 110 columns, otherwise one language per
line; put the default language first, then the others in `languages` order. An app may also hoist a
repeated phrase into a `const` and reference it. That is plain TS and allowed, but the direct
structural editor cannot edit through it (it says so, as it does today for helpers and spreads).

What would change this recommendation: a measurement that the +4–5 k tokens per prompt makes
modify runs on six-language apps materially worse or more expensive. Then the fix is to show the
model a **narrowed source** (only the languages the edit touches, with maps folded) rather than to
move storage. That is a prompt change that keeps A's data model.

## 8. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | CLAUDE.md says a `defineApp`/`ctx` change "bumps `schemaVersion`", but `schemaVersion` is each app's data version and there is no platform version (§4). Is the docs/04 #112 precedent right here (no app bumps; the contract change is noted in docs/04/05 and the PR)? | **Yes, follow #112.** Bumping app versions for translations would trip the schema-drift gate for nothing. Separately, reword the CLAUDE.md line to say "note it in docs/05 and the reference" so the next agent is not confused. |
| Q2 | Inline maps (A), a table by path (B), or package files (C)? | **A**, plus the `translate` tool (§7.2). |
| Q3 | Shell templates around app nouns ("New {entity}") cannot agree in gender in pl/de/es/it/pt. | **The shell avoids agreement** ("Add: Item", "Dodaj: Przedmiot"), and an app that wants natural phrasing declares a `quickActions` label in `Words`. No per-entity grammar fields. |
| Q4 | Must a map contain *every* declared language (strict), or only the default (lenient, per-string fallback)? | **Lenient in Zod, strict in the generator's `check` for gaps a candidate adds.** Strict loading would make a newer member's partial translation unloadable on older copies. |
| Q5 | Functions see enum *values*, not labels. A search chip typed in Polish will not match `"produce"`. Add `ctx.labelOf(entity, field, value)`? | **Not in #302.** Document it. Add it when a real app needs it. Most searches are over text fields, which are records. |
| Q6 | Should model-facing `description`s (actions, sources) be `Words`? | **No.** They are read by the model, and #297 keeps model-facing text in English. Ask answers in the person's language regardless. |
| Q7 | Function results that are displayed (`secondary`, aggregate rows, chart points): `string` only, or also `Words`? | **`string` only, with `ctx.t`.** `Dynamic<Words>` slots may return a map because the type falls out that way. Nothing else. One way to do it is easier to teach than two. |
| Q8 | Do new apps get written monolingually in the person's language, with more only on request? | **Yes.** Size and tokens (§7.1). Studio can offer "also in English?" once, when the person shares an app with someone whose language differs. That is a later, separate idea. |
| Q9 | `ctx.format` in the sealed box: synchronous `__hostPure` (~25 µs a call), or a pure-JS formatter with CLDR data for the six locales inside the harness? | **`__hostPure`.** It covers every language an app may declare, adds no locale data to the box, and is exactly `Intl`. Revisit only if a phone measurement shows aggregate pages slowing, and first by returning raw values for views to format. |
| Q10 | A person's explicit You → Language choice: does it override the device's languages for apps too (§3.1)? | **Yes.** One choice should mean one language. Following the device uses the whole device list, so French apps still show French on a French phone. |
| Q11 | RTL languages (an app declaring `ar` or `he`)? | **Allowed to declare, not designed for in #302.** The six shell languages are LTR. Set `dir` on the app root from the resolved language as a cheap first step. Full RTL layout is its own issue. |

## 9. Examples

### 9.1 Before and after: a declarative app (groceries, abridged)

Before (today, and still valid after):

```ts
export default defineApp({
  id: "groceries", name: "Groceries", icon: "🛒", version: "2.0.0", schemaVersion: 2,
  entities: {
    item: {
      label: "Item",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Milk" },
        quantity: { type: "text", placeholder: "2 × 1 l", help: "How much, in your own words" },
        bought: { type: "boolean", default: false },
      },
      groups: [{ title: "Item", fields: ["name", "quantity"] }, { title: "More", fields: ["bought"], collapsed: true }],
    },
  },
  pages: [{
    id: "shopping", title: "Shopping",
    view: { type: "checklist", entity: "item", done: "bought", quickAdd: true,
            emptyText: "Nothing on the list. Add the first thing below." },
  }],
});
```

After ("translate this app into Polish"). Note that `schemaVersion` is unchanged:

```ts
export default defineApp({
  id: "groceries", name: { en: "Groceries", pl: "Zakupy" }, icon: "🛒", version: "2.1.0", schemaVersion: 2,
  language: "en",
  languages: ["en", "pl"],
  entities: {
    item: {
      label: { en: "Item", pl: "Produkt" },
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", pl: "Nazwa" }, placeholder: { en: "Milk", pl: "Mleko" } },
        quantity: {
          type: "text",
          label: { en: "Quantity", pl: "Ilość" },
          placeholder: "2 × 1 l",                                   // the same in every language
          help: { en: "How much, in your own words", pl: "Ile — własnymi słowami" },
        },
        bought: { type: "boolean", default: false, label: { en: "Bought", pl: "Kupione" } },
      },
      groups: [
        { title: { en: "Item", pl: "Produkt" }, fields: ["name", "quantity"] },
        { title: { en: "More", pl: "Więcej" }, fields: ["bought"], collapsed: true },
      ],
    },
  },
  pages: [{
    id: "shopping", title: { en: "Shopping", pl: "Zakupy" },
    view: { type: "checklist", entity: "item", done: "bought", quickAdd: true,
            emptyText: { en: "Nothing on the list. Add the first thing below.", pl: "Lista jest pusta. Dodaj pierwszą rzecz poniżej." } },
  }],
});
```

### 9.2 Enum labels: values stay, words change

```ts
status: {
  type: "enum",
  options: ["todo", "doing", "done"],                         // stored in records; never translated
  colors: { done: "green" },
  labels: {
    todo:  { en: "To do", pl: "Do zrobienia", de: "Offen" },
    doing: { en: "Doing", pl: "W trakcie",    de: "In Arbeit" },
    done:  { en: "Done",  pl: "Zrobione",     de: "Erledigt" },
  },
},
```

A board on `status` titles its columns from `labels`. A filter chip from `status` shows them. A
function still compares `r.status === "done"`.

### 9.3 Words inside functions (plants, abridged)

Before, with a hand-written English-only helper:

```ts
const relativeTime = (d: Date) => {
  const days = Math.round((d.getTime() - Date.now()) / DAY);
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
};
// …
display: { primary: "name", secondary: (p) => (p.overdue ? "overdue!" : `next: ${relativeTime(p.nextWatering)}`) },
// …
rows: (plants) => [{ label: "Due now", value: plants.filter((p) => p.overdue).length }],
// …
reminders: [{ id: "water-due", entity: "plant", when: (p) => (p.active ? p.nextWatering : null),
              title: (p) => `Water ${p.name}` }],
```

After. This works the same in the person's own app and in the sealed box:

```ts
display: {
  primary: "name",
  secondary: (p, ctx) => p.overdue
    ? ctx.t({ en: "overdue!", pl: "po terminie!" })
    : ctx.t({ en: "next: {when}", pl: "następne: {when}" }, { when: ctx.format.relative(p.nextWatering, { unit: "day" }) }),
},
// …
rows: (plants, ctx) => {
  const due = plants.filter((p) => p.overdue).length;
  return [{ label: ctx.t({ en: "Due now", pl: "Do podlania" }), value: due }];  // value stays a number: the view formats it
},
// …
summary: [{
  label: { en: "Plants", pl: "Rośliny" },
  value: (rows, ctx) => ctx.t({
    en: "{n, plural, one {# plant} other {# plants}}",
    pl: "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}",
  }, { n: rows.length }),
}],
// …
reminders: [{ id: "water-due", entity: "plant", when: (p) => (p.active ? p.nextWatering : null),
              title: (p, ctx) => ctx.t({ en: "Water {name}", pl: "Podlej: {name}" }, { name: p.name }) }],
```

`p.name` is a record, so it is never translated. "Podlej: Monstera" is the app's words around the
person's data.

## 10. As built

Where the build differs from the design above, and why:

- **The enum `labels` example is plants', not groceries'.** Groceries has had no enum since 2.0.0 —
  its aisles became records you rename — and adding a field to it would have been a data change. So
  groceries is the `en`+`pl` app with every word a map, and `plants` shows `labels` on its `season`
  enum (plain English labels in a one-language app). Groceries moved to 2.1.0 and plants to 1.1.0 so
  unchanged seeded copies pick them up; no `schemaVersion` moved.
- **There is no app info sheet**, so the quiet line of §3.3 is an entry in the app's `⋯` menu:
  "Translate into Polski", described as "This app is in English.", where the app can be edited here
  (it opens the Studio with that request), and the line itself, inactive, where it cannot.
- **The ICU formatter is `intl-messageformat`** (FormatJS), because it interprets a message instead of
  compiling it to code — the host formats words a stranger's app sends it. `ctx.t` is synchronous, so
  "loaded the first time an app calls `t` with `vars`" could not be done: it is a lazy chunk awaited by
  `host.load`, before any of the app's functions can run. #298 had not landed, so there was nothing
  to reuse; Lingui compiles at build time and cannot format a message that arrives at run time.
- **`__hostPure` answers with a marked string** (`+text` or `!why`) rather than JSON, and takes plain
  JSON with no reviver: measured on a desktop (i7-9850H, Node 22, 10,000 calls) that took
  `ctx.format.date` in the box from ~64 µs to **~41 µs a call** — above §2.4's ~25 µs estimate, which
  timed the JSON round trip alone. `ctx.t` without `vars` stays in the box at ~2.5 µs; the trusted
  `ctx.format.date` is ~2.5 µs against ~1 µs for bare `Intl`. **Not measured on a phone.**
- **Views changed in their types**: `Runtime.definition` is `Localized<AppDefinition>` (every `Words`
  slot typed as its string), and views take the localized types. Their only behaviour change is the
  new option `labels`, read as `labels[option] ?? option` on boards, pills, buttons, badges, group
  headings, table cells, filter chips and the quick-action menu.
- **`translate` also offers the slots a translation needs that have no words yet**: a field or entity
  leaning on its key ("Bought by" cannot be humanised into Polish, §7.1) and an option with no label.
  Spliced, they become `label: { en: "Bought by", pl: "…" }` and `labels: { … }`.
- **An app that declares no language** gets `ctx.locale` in the person's language, so its functions
  can still format for them; its strings are shown as written.
- **What the first paid `eval:translate` run found** (DeepSeek V4 Flash, 10 cases, $0.15; 5 passed):
  - *A third language broke `translate`.* Splicing `de` into groceries (already `en`+`pl`) wrote
    `{ en, de }` where a plain string or a missing label had been, so every new map lacked `pl`, the
    completeness check failed the candidate, and the loop gave up. Now a plain string keeps its
    words in every language the app already carries (it read the same in all of them), a slot with
    no words yet takes an object `{ pl: "…", de: "…" }` and is refused as a bare string, and hidden
    fields' labels are not asked for.
  - *A rename in one language went uncaught.* The completeness check only saw missing languages,
    not stale ones. It now also reports a map whose own-language words changed while another
    language stayed the same, as a warning: said once, and accepted if the same edits are sent
    again (the person may have asked to change one language).
  - *The scorer was wrong twice.* Adding a field is a data change (docs/06), so `add-field` and
    `polish-ask` may bump `schemaVersion`; only translate, rename and one-language edits must not.
    And "it really translated" now ignores units in a `unit` slot and tokens of three letters or
    fewer, leaves placeholders (examples, often proper names) out of the count, and allows
    cognates: under 10% of the phrases and under 25% of all words may equal the English ("Name",
    "Status", "Winter" are German too). Unit-like slots may stay plain.
- **The system prompt's budget** went from 75k to 80k characters, with the note the test asks for,
  after the new comments were cut to one line and `Localized` was kept out of the reference.


### 10.1 The examples in six languages (#303)

- **Every example (`examples/`) and every demo app (`apps/`) carries `en`, `pt-BR`, `de`, `es`, `pl`,
  `it`**, English still its own language. Every language but English is a model's draft, as the
  shell's are (#297); each app's header comment says so. `examples/test/apps.test.ts` and each demo
  app's `test/app.test.ts` hold every one to `checkWords` and `wordGaps` over all six, and list the
  plain strings allowed: units ("kg", "kcal", "$/kg", "bpm"), a dish's name as a placeholder, "Wiki",
  "Breakout", "2 × 1 l".
- **Records stay as they are**: the shell's seed (`seed.ts`) and mood-sleep's `seed.json` are sample
  records, so "Milk" and "Fern" read the same in Polish. A record a function writes is written in
  the language it was written in: a Breakout game keeps its level's name as played, a piano week log
  its week's name, a photo-garden picture its English title (the title is also its file name).
- **Shipped files**: Breakout's `levels.json` is drawn as the game's own HUD, so a level's `name` is a
  map. Piano's `plan.json` is not translated: it is the plan itself, a document written around
  English books, videos and sites, shown as written; a plan in another language is a plan file of
  its own. What `checkLevels` and `validatePlan` say about a broken file stays English too.
- **Q5 in practice**: a function sees an option's value, so the lines that put an option into words
  (a place's kind on a pin, a recipe's difficulty, a training day) do it through a small helper with
  the same words as the field's `labels`. Words a custom view passes to `ctx.ui` go through `ctx.t`
  rather than as maps, so the completeness check (which reads `ctx.t` maps) sees them.
- **Hand-made formats went**: `formatMoney` (which throws in the sealed box), `toLocaleDateString`,
  month-name tables and a hand-written thousands separator became `ctx.format.*`. American English
  now reads "Jul 20" where the workout chart had "20 Jul".
- **English changed in three small ways**: plurals that read "1 sets", "1 ingredients", "1 days" are
  now singular; recipes' "Calories Per100" labels read "Calories per 100 g".
- **`eval:translate` asks for French**, since every example already carries the six: the harder case
  of a seventh language, where every map touched must keep all the others. Its rename, one-language
  and add-field cases run on groceries in all six.
- **A gap found**: a computed value shown on a page has no label, so it reads as its key in every
  language ("Calories Per Serving", "Breakdown"). That needs a mechanism: #310.
- **#310 built it**: a computed may be `{ value, label }`, the bare function still accepted. `label`
  is a `zWords` slot, so `checkWords`, `localize`, `wordGaps` and `translate` see it with no code of
  their own; the views' `fieldLabel` reads it after a field's label. Every example's computed that a
  page heads (recipes' "Nutrition & cost" group and High protein columns, split's breakdown,
  workout's session overview and rolling best) carries it in the six languages, and
  `examples/test/apps.test.ts` fails on one that does not. Still open from the issue: an enum-like
  computed shown as a badge (recipes' `diet`) has no option `labels`, and a computed returning an
  object (`lastBest`) shows raw.
