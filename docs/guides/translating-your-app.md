---
title: Translating your app
description: Write the app in one language, keep each translation in a catalog file beside it, and let Potyro pick the language the person reads.
section: guides
order: 8
---

# Translating your app

An app is written in one language. Its translations live in catalog files beside the source, one
per language, and Potyro swaps the words in when the app opens. The code never carries a second
language.

## The example

```ts
// plants.app.ts
import { defineApp, msg } from "potyro";

const EMPTY = msg("Nothing to water today");

export default defineApp({
  id: "plants",
  name: "Plants",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pl"],
  entities: {
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        every: { type: "number", label: "Water every", unit: "days", default: 7 },
        lastWatered: { type: "datetime", label: "Last watered" },
      },
      actions: {
        water: {
          label: { text: "Water", context: "verb" },
          run: async (plant, ctx) => {
            await ctx.patch("plant", plant.id, { lastWatered: ctx.now() });
            ctx.ui.toast(ctx.t("Watered {name}", { name: plant.name }));
          },
        },
      },
    },
  },
  pages: [
    {
      id: "today",
      title: "Today",
      view: {
        type: "list",
        entity: "plant",
        emptyText: (ctx) => ctx.t(EMPTY),
        display: {
          primary: "name",
          secondary: (p, ctx) => ctx.t("Every {n, plural, one {day} other {# days}}", { n: p.every }),
        },
        rowActions: ["water"],
      },
    },
  ],
});
```

```po
# locales/pl.po
msgid "Today"
msgstr "Dziś"

msgctxt "verb"
msgid "Water"
msgstr "Podlej"

msgid "Watered {name}"
msgstr "Podlano: {name}"

msgid "Every {n, plural, one {day} other {# days}}"
msgstr "Co {n, plural, one {dzień} few {# dni} many {# dni} other {# dnia}}"
```

## 1. Declare the language

Set `language` to the language the words are written in. Every label, title, help text,
placeholder, unit and empty text is a plain string in that language. List every language the app
carries in `languages`, its own first.

## 2. Mark the words inside functions

Words a function shows go through `ctx.t`:

- `ctx.t("Watered {name}", { name })` for text with values. With `vars` the text is an ICU
  message, so plurals are written as `{n, plural, one {…} other {…}}`.
- `ctx.t({ text: "Water", context: "verb" })` when one text has two meanings. The same object form
  works in a label.
- `msg("…")` marks words kept in a constant or a helper without `ctx`. It returns the text
  unchanged. Show them later with `ctx.t(EMPTY)`.

Write the words out as literals. `ctx.t(someVariable)` cannot be found unless the variable was
marked with `msg`. Records are never translated: a plant's name is shown as the person typed it.

## 3. Make the catalogs

Catalogs are gettext files in a `locales` folder beside the app file: `locales/pl.po`,
`locales/de.po`. The `msgid` is the source text. The `msgstr` is its translation, with the same
`{placeholders}`. A plural keeps the ICU form, so Polish writes its own `few` and `many`.

From a checkout of the repository, one command extracts every message and merges it into each
catalog:

```sh
pnpm i18n:app plants.app.ts locales --add pl,de
```

It writes `locales/messages.pot`, adds new messages untranslated, marks a message that went away
as obsolete, and marks a message that changed a little as `fuzzy`. `--check` writes nothing and
fails when a catalog is out of step. A catalog can also be written by hand: the format is plain
gettext.

In the Studio, **Translate into…** on the app's language line makes a catalog for a new
language, and **Update translations** fills the new and fuzzy messages. Both write only the
catalogs, never the code.

## 4. Ship them

`potyro pack` includes every `locales/*.po` beside the source in the package. A demo link, a
shared app and an export carry them too. An app never opens before its catalog is there.

## How Potyro picks the language

1. The person's language, chosen under **You → Language**, when the app carries it.
2. Otherwise the app's own `language`.

A message with no translation, or a fuzzy one, shows the source text. `ctx.locale` is the
language in force, fixed for one evaluation pass. `ctx.format` formats dates, numbers and money for
the person, in their region when it speaks the words' language.

Enum and tag options are stored values and never change. Give them words with `labels`:

```ts
status: { type: "enum", options: ["todo", "done"], labels: { todo: "To do", done: "Done" } }
```

The labels are source text like any other slot, and the catalogs translate them.

## Next

- [Entities and fields](entities-and-fields.md): every slot that takes words.
- [The `ctx` reference](../reference/ctx.md): `ctx.t`, `ctx.locale` and `ctx.format`.
- [The CLI](../reference/cli.md): `potyro pack` and what goes into a package.
