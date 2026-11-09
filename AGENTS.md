# AGENTS.md — for an agent asked to make a Potyro app

You have this repository and a description of an app. The deliverable is one file,
`<id>.potyro-app.zip`, that a person installs in Potyro with **Add an app → From this device**.
This page is the whole recipe. To change Potyro itself, read `CLAUDE.md` instead.

## What a Potyro app is

One TypeScript module that default-exports `defineApp({...})`. Its **shape** (entities, fields,
pages) is plain data that Potyro validates and turns into storage, forms and views. Its **logic**
(computed values, filters, actions, reminders, custom views) is ordinary functions that receive
`ctx`, the one object through which an app reaches its records, the person, the screen and the
device. No expression language, no visual builder, no React unless you draw a custom view.

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "books", name: "Books", version: "1.0.0", schemaVersion: 1,
  entities: {
    book: {
      label: "Book", displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title" },
        read: { type: "boolean", label: "Read", default: false },
      },
      actions: {
        markRead: { label: "Mark as read", run: async (book, ctx) => { await ctx.patch("book", book.id, { read: true }); } },
      },
    },
  },
  pages: [
    { id: "to-read", title: "To read", view: { type: "list", entity: "book", filter: (b) => !b.read, rowActions: ["markRead"] } },
    { id: "finished", title: "Finished", view: { type: "list", entity: "book", filter: (b) => b.read } },
  ],
});
```

## Read these first, in this order

1. `docs/concepts/how-an-app-is-put-together.md` — the model, in ten minutes.
2. `docs/reference/define-app.md`, `docs/reference/field-types.md`, `docs/reference/pages-and-views.md`,
   `docs/reference/ctx.md` — every option that exists. Use only what is listed there.
3. One finished app close to what is asked, as a model to copy from:
   `docs/tutorials/code/01-reading-list/2-logic/reading-list.app.ts` (small, complete),
   `apps/countdowns` (dates, one screen), `apps/which-is-cheaper` (numbers), `apps/plant-doctor`
   (photos and AI), `apps/write-together` (collaborative text, custom views), `apps/draw-guess`
   (rooms, multiplayer). The folder `apps/` holds the real apps; `examples/` the fixtures.
4. For a task the guides cover, the guide: `docs/guides/` (custom views, dialogs, device
   capabilities, working together, translating, changing an app that has data).

## The recipe

```sh
pnpm install                              # once, at the root (Node 22, pnpm)
pnpm new:app <id>                         # → drafts/<id>/, linked to this repository's potyro
# write drafts/<id>/<id>.app.ts (rename to .tsx for a custom view with JSX)
pnpm check:app drafts/<id>/<id>.app.ts    # runs it on sample records: every page, computed value, action
cd drafts/<id>
pnpm typecheck                            # the types: wrong option names fail here
pnpm test                                 # importing the app validates it; add tests for your pure functions
pnpm build                                # → dist/<id>.potyro-app.zip
```

`drafts/` is ignored by git, outside the workspace and read by nothing else in the repository:
nothing you put there changes Potyro, its lockfile, its tests or its gallery. The zip is the deliverable; hand it over with one
paragraph on what the app does and how to use it.

### What goes in the zip

- `<id>.app.ts` and the modules it imports from its own folder (`./words.ts`). An app may import
  `potyro`, `react`, its own files and a library by URL (`import x from "https://…"`); anything
  else is refused at pack time.
- `seed.json`, optional: the records the app starts with, as
  `{ "<entity>": [ { "<field>": value, … }, … ] }`. Add `--seed seed.json` to the `build` script in
  `package.json`. Use it when the app is useless empty.
- Files the app reads at run time with `ctx.files`: `--files assets/` on the same script. The
  format is in `docs/reference/package-format.md`.

## Decide before writing

- **The frequent task first.** The first page is what the person does most often, with nothing to
  scroll past. Rare actions go in a detail page or the page's menu.
- **Built-in views before a custom view.** list, detail, table, gallery, checklist, board, steps,
  calendar, map, timeline, stats, chart, aggregate. A custom view is for what none of them can show.
- **What Potyro already has.** Sharing a record, text several people write, a live room, files, AI,
  the camera: all through `ctx`, never through a library. If the app needs something `ctx` has
  not, say so in the hand-over instead of working around it.
- **Permissions are declared.** Camera, location, notifications, network, AI, sync: name them in
  `permissions`, or the app is refused them when it is installed from someone else.
- **Ids are slugs, words are English.** `id` is lowercase letters, digits and dashes. Labels are
  English in the source; translations are catalogs made later, never maps in the code.
- **`schemaVersion` is 1** for a new app. It changes only when records already stored must change
  shape.

## Checks that count

The zip is done when all four pass: `typecheck`, `test`, `check:app`, `build`. `check:app` opens
every page on synthetic records and runs every function; a page that shows none of them is
reported as a warning, which usually means a filter that can never match. If you can run a
browser, `pnpm dev` starts Potyro at `http://localhost:5173`: add the zip through **Add an app →
From this device** and use it at phone width before handing it over.

## Do not

- Do not put the app in `apps/` or `examples/`, and do not touch `packages/`. Those are Potyro.
- Do not invent an option, a field type or a `ctx` member. If it is not in `docs/reference/`, it
  does not exist.
- Do not call `potyro.app` or any network from app code except through `ctx.caps.network`.
- Do not run `pnpm ci:local`, `pnpm e2e` or any `eval:*` script; they are for changing Potyro and
  some cost money.
