---
title: Developing
description: The edit, build and replace loop for writing an app, with typechecking, tests, logging and a local Potyro.
section: start
order: 2
---

# Developing

Writing a Potyro app is a loop: edit the file, build the package, replace the app in Potyro. This
page shows that loop and the tools around it.

```sh
npm run build        # → dist/books.potyro-app.zip
npm run typecheck    # tsc over the app and its tests
npm test             # the app is valid, and its functions do what they say
```

The three scripts come with the project that `npm create potyro` makes. Run each from the project
folder.

## Edit, build, replace

1. Edit `books.app.ts`. The whole app is that one file.
2. Run `npm run build`. The output names the zip and what it holds:

   ```
   dist/books.potyro-app.zip: the app, 0 modules and 0 files
   ```

3. In Potyro, choose **Add an app → From this device** and pick the zip. Potyro recognises the app
   by its `id` and offers **Replace it, keep its data**. Take it.

Your records stay. The pages, views and functions are the new ones. Raise `version` when a change is
worth a number; Potyro does not need it to replace the app.

Two kinds of change need care. A new optional field is free: old records simply have no value for
it. A field renamed or an entity split changes the shape of existing records. That needs a
`schemaVersion` bump and a migration, covered in
[Changing an app that has data](../guides/changing-an-app-with-data.md).

## Typecheck

```sh
npm run typecheck
```

This runs `tsc` in strict mode over the app and its tests. The types for `ctx`, records and every
field option come from the `potyro` package. A misspelled option or a wrong argument to `ctx.patch`
fails here, before you build.

`defineApp` checks what types cannot when the module loads: a page that names a field the entity
does not have, an `id` that is not a slug, a sort on a missing page. Importing the app is enough to
run those checks, which is what the test does.

## Test

The project ships one test file, `test/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import app, { lineOf } from "../books.app";

describe("Books", () => {
  it("is a valid app", () => {
    expect(app.id).toBe("books");
    expect(Object.keys(app.entities)).toContain("thing");
  });

  it("shows a thing's note under its name", () => {
    expect(lineOf("  milk, eggs ")).toBe("milk, eggs");
    expect(lineOf(undefined)).toBe("");
  });
});
```

`npm test` runs it with Vitest. The first test fails if the app does not load, so it catches the
shape mistakes above. The second tests a plain function. Keep the logic you want to test in exported
functions like `lineOf`, and call them from your computed values and actions. They then run in a test
without Potyro.

## See what your code does

Every function that receives `ctx` can log through it:

```ts
run: async (book, ctx) => {
  ctx.log("finishing", book.id, book.title);
  await ctx.patch("book", book.id, { read: true });
},
```

The output appears in the browser console, in the developer tools of the tab Potyro runs in. Each
line starts with the app's id in brackets: `[books] finishing …`. Prefer `ctx.log` to
`console.log`: the prefix tells apps apart, and it reaches the console from a sealed app too. A
sealed app's arguments arrive as strings.

## Run Potyro from the repository

You can run Potyro itself on your machine instead of using potyro.app. You need Node 22 and pnpm.

```sh
git clone https://github.com/potyro-app/potyro
cd potyro
pnpm i
pnpm dev             # http://localhost:5173
```

`pnpm dev` starts the shell and a local sync relay. The example apps are seeded as your own apps.
Add your zip the same way as on potyro.app. Your app still goes through build and replace: Potyro
loads the package, not your source file.

## See your app as other people see it

An app you add with **I wrote this. Run it as mine.** unticked runs sealed, like an app from
someone else. It reaches nothing until it asks and you agree. Try your app that way before you share
it: the card lists what it asks for, and each capability prompts the first time the app uses it.

```sh
pnpm dev:sandbox
```

From the repository, `pnpm dev:sandbox` seeds the example apps sealed. Open one to see what a shared
app looks like: the sealed mark in the top bar, the trust dialog behind it, the prompts. What a
sealed app can and cannot do is in
[Your apps and other people's apps](../concepts/trusted-and-sealed.md).

## Next

- [How an app is put together](../concepts/how-an-app-is-put-together.md): the model behind the
  file you are editing.
- [Changing an app that has data](../guides/changing-an-app-with-data.md): when a change needs a
  migration.
- [The `ctx` reference](../reference/ctx.md): everything a function can do.
