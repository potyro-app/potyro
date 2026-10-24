# Your first Potyro app

In this tutorial you write a small app in TypeScript, pack it, and run it in Potyro: a **reading
list** that keeps books you want to read and books you finished, and asks how you liked one when you
mark it read. It takes about fifteen minutes.

On the way you will learn the three things every Potyro app is made of:

- **what it keeps**: its *entities*, such as a book, and their fields;
- **what it shows**: its *pages*, each one a view of those records;
- **what it does**: plain functions that receive **`ctx`**, the app's way to reach everything Potyro
  can do (records, dialogs, the date, later the camera and the network).

You need **Node 20 or newer** and Potyro open in a browser, at [potyro.app](https://potyro.app) or a
local `pnpm dev`. You don't need to know React or set up a build: an app is one TypeScript file.

The finished code is in [`code/01-reading-list`](code/01-reading-list/), one folder per stage.

## 1. Create the project

```sh
npm create potyro@latest reading-list
cd reading-list
npm install
```

You get this:

```
reading-list/
  reading-list.app.ts   the app — the whole of it
  test/app.test.ts      a test that the app is valid
  package.json          build, test and typecheck scripts
  tsconfig.json
```

`npm install` brings in one package, [`potyro`](https://www.npmjs.com/package/potyro). It provides
`defineApp`, the types for everything your functions receive, and the `potyro pack` command.

## 2. Read the starter

Open `reading-list.app.ts`. It is a small working app that keeps a list of *things*. Its structure is
the same as every app's:

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "reading-list",        // the app's identity: a lowercase slug, never changed once people use it
  name: "Reading list",      // what people see on their launcher
  icon: "sparkles",          // any Lucide icon name, as on lucide.dev
  version: "0.1.0",          // your release number
  schemaVersion: 1,          // the version of the app's DATA (more on this in step 6)
  language: "en",            // the language its words are written in
  theme: { accent: "#3D7DD8" },

  entities: { thing: { … } },   // what it keeps
  pages: [ … ],                 // what it shows
});
```

Two parts of it are worth a closer look.

**An entity** declares fields, and Potyro builds the forms, validation and storage from them:

```ts
thing: {
  label: "Thing",
  displayField: "name",     // which field names a record, in lists and titles
  fields: {
    name: { type: "text", required: true, label: "Name" },
    note: { type: "text", multiline: true, label: "Note" },
    done: { type: "boolean", default: false, label: "Done" },
  },
  …
}
```

**An action** is a function. It gets the record it runs on and `ctx`:

```ts
actions: {
  toggle: {
    label: "Done",
    run: async (thing, ctx) => {
      await ctx.patch("thing", thing.id, { done: !thing.done });
      ctx.ui.toast(thing.done ? "Back on the list" : "Done!");
    },
  },
},
```

That is the whole idea of Potyro. The shape is data; the behaviour is ordinary code. There is no
formula language to learn, so anything TypeScript can do, an app can do.

## 3. Run it in Potyro

```sh
npm run build
```

```
dist/reading-list.potyro-app.zip: the app, 0 modules and 0 files
```

The zip is an **app package**: the source, the files the app ships with, and a description of what it
keeps, so Potyro can show the app before running it.

In Potyro:

1. Tap **Add an app** on your apps, then **From this device**, and choose
   `dist/reading-list.potyro-app.zip`.
2. The card says what the app keeps (*Thing*) and what it asks the device for (*nothing*).
3. Tick **I wrote this. Run it as mine.** This runs your code directly. Leave it unticked for an app
   someone else wrote: Potyro then runs it in a sealed box, where it reaches only what you allow.
4. Tap **Add app**.

Add a thing or two and tap **Done** on one. Notice what you didn't write: the form, the empty state,
the "+" button, the storage. They all came from the declaration.

## 4. Make it a reading list

Now replace the starter with your own app. First, **what it keeps**: a book has a title, an author,
a status, a rating, the day you finished it, and notes.

Replace `entities` with:

```ts
entities: {
  book: {
    label: "Book",
    icon: "book",
    displayField: "title",
    fields: {
      title: { type: "text", required: true, label: "Title", placeholder: "The Dispossessed" },
      author: { type: "text", label: "Author" },
      status: {
        type: "enum",
        options: ["want", "reading", "read"],
        labels: { want: "Want to read", reading: "Reading", read: "Read" },
        colors: { want: "grey", reading: "blue", read: "green" },
        default: "want",
        label: "Status",
      },
      rating: { type: "number", integer: true, min: 1, max: 5, label: "Rating" },
      finished: { type: "datetime", label: "Finished on" },
      notes: { type: "text", multiline: true, label: "Notes" },
    },
  },
},
```

An `enum` stores its option (`"read"`) and shows its label ("Read"). Your code compares against the
option, and the people using the app see the words. A `datetime` is a day unless you ask for minutes
(`precision: "minute"`).

Next, **what it shows**: two shelves and a page for one book. Replace `pages` with:

```ts
pages: [
  {
    id: "shelf",
    title: "To read",
    icon: "book-open",
    view: {
      type: "list",
      entity: "book",
      filter: (book) => book.status !== "read",
      // What you are reading now comes first, then the rest by title.
      sort: (a, b) =>
        Number(b.status === "reading") - Number(a.status === "reading") ||
        String(a.title).localeCompare(String(b.title)),
      display: { primary: "title", secondary: "author", badges: ["status"] },
      emptyText: "No books waiting. Add one you want to read.",
      onOpen: { page: "book", param: { bookId: "id" } },
    },
  },
  {
    id: "read",
    title: "Read",
    icon: "book-check",
    view: {
      type: "list",
      entity: "book",
      filter: (book) => book.status === "read",
      sort: (a, b) => time(b.finished) - time(a.finished),
      display: { primary: "title", secondary: "author" },
      emptyText: "Nothing finished yet.",
      onOpen: { page: "book", param: { bookId: "id" } },
    },
  },
  {
    id: "book",
    title: "Book",
    hidden: true,   // reached by opening a book, not from the tab bar
    view: {
      type: "detail",
      entity: "book",
      param: "bookId",
      sections: [
        { fields: ["author", "status", "rating", "finished"] },
        { title: "Notes", fields: ["notes"] },
      ],
    },
  },
],
```

The `filter` and `sort` are plain functions over records, run on the device. Add the small helper
that the Read shelf sorts by, above `export default`:

```ts
/** A date field's value as a number to sort by; a book with no date sorts last. */
const time = (value: unknown): number => (value ? new Date(value as string).getTime() : 0);
```

Finally, set `icon: "book-open"` and an accent of your choice, such as `theme: { accent: "#B4532A" }`.
Remove the starter's `lineOf` function and its test for now; you will write new ones in step 5.

Check your work. The full file at this stage is
[`1-shape/reading-list.app.ts`](code/01-reading-list/1-shape/reading-list.app.ts).

```sh
npm run typecheck
npm run build
```

Add it to Potyro as in step 3. It is the same app (same `id`), so the card offers **Replace it, keep
its data**. Your starter *things* are not books, so they won't show up on these pages. Add a few
books. The form has a button row for the status, a stepper for the rating, and a day picker. You
wrote none of them.

## 5. Give it some behaviour

Two things a list can't do on its own: show the rating as stars under each book, and mark a book
finished in one tap while asking how it was.

**A computed value** is a function of a record, available wherever a field is. Add this plain
function at the top of the file:

```ts
/** "Ursula K. Le Guin · ★★★★☆": the line under a book, from its author and rating. */
export function lineOf(author: unknown, rating: unknown): string {
  const stars = Number(rating) > 0 ? "★".repeat(Number(rating)) + "☆".repeat(5 - Number(rating)) : "";
  return [String(author ?? "").trim(), stars].filter(Boolean).join(" · ");
}
```

Then declare it on `book`, after `fields`:

```ts
computed: {
  line: { label: "Author", value: (book) => lineOf(book.author, book.rating) },
},
```

**An action** does something. This one asks for a rating with `ctx.ui.sheet`, writes the book with
`ctx.patch`, and confirms with `ctx.ui.toast`:

```ts
actions: {
  finish: {
    label: "Finished it",
    icon: "check",
    run: async (book, ctx) => {
      // Ask for a rating; the person may close the sheet without one (null).
      const stars = await ctx.ui.sheet({
        title: "How was it?",
        items: [5, 4, 3, 2, 1].map((n) => ({ id: n, label: "★".repeat(n) })),
      });
      await ctx.patch("book", book.id, {
        status: "read",
        finished: ctx.today(),
        ...(stars ? { rating: stars } : {}),
      });
      ctx.ui.toast(`${book.title} is on your Read shelf`);
    },
  },
},
```

`ctx.today()` and not `new Date()`: Potyro fixes the time once for each pass over the records, so
every function in the pass sees the same day. That also makes the function easy to test.

Now use both on the pages. On the two shelves, show the line instead of the bare author:

```ts
display: { primary: "title", secondary: "line", badges: ["status"] },   // To read
display: { primary: "title", secondary: "line" },                       // Read
```

Then put the action on each row of *To read*, and on the book's own page:

```ts
rowActions: ["finish"],     // in the "shelf" page's view
actions: ["finish"],        // in the "book" page's view
```

Bump `version` to `"0.2.0"`, then pack and add it again. The final file is
[`2-logic/reading-list.app.ts`](code/01-reading-list/2-logic/reading-list.app.ts).

Your books are still there, because **Replace it, keep its data** keeps records. Tap **Finished it**
on one, choose a rating, and it moves to the Read shelf with its stars.

## 6. Test it

`lineOf` is a plain function, so test it like one. Replace `test/app.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import app, { lineOf } from "../reading-list.app";

describe("Reading list", () => {
  it("is a valid app", () => {
    expect(app.id).toBe("reading-list");
    expect(Object.keys(app.entities)).toEqual(["book"]);
  });

  it("writes the author and the rating under a book", () => {
    expect(lineOf("Ursula K. Le Guin", 4)).toBe("Ursula K. Le Guin · ★★★★☆");
    expect(lineOf("Ursula K. Le Guin", undefined)).toBe("Ursula K. Le Guin");
    expect(lineOf("", 5)).toBe("★★★★★");
  });
});
```

```sh
npm test
```

The first test is worth more than it looks. `defineApp` checks the app's shape when the module loads:
a page that names a field the entity doesn't have, a sort on a missing page, an `id` that isn't a
slug. So importing the app catches those mistakes before Potyro sees them.

## What changes need care

You changed the app twice and kept your data both times, because both changes kept the records'
shape. The rule:

- **Words, pages, views, computed values, actions:** change them freely. Bump `version`.
- **A new optional field:** also free. Old records simply don't have it yet.
- **Records changing shape** (a field renamed, an entity split, a value with a new meaning): bump
  `schemaVersion` and write a migration, so existing records come along. That is a later tutorial.

## Where to go next

- The full API is [docs/04 · App Module API](../04-app-module-api.md): every field type, every view,
  and everything on `ctx`.
- The apps in [`apps/`](../../apps/) are real and small enough to read. *Countdowns* and
  *Which is cheaper* are good next reads.
- The next tutorials cover custom item types and views, the camera, files, and live connections. The
  series is listed in [the tutorials' index](README.md).
