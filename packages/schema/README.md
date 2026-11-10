# potyro

Write apps for [Potyro](https://potyro.app). An app is one TypeScript module whose default export is
`defineApp({ … })`. It declares what the app keeps and shows as plain data, with its behaviour as
ordinary functions that receive `ctx`.

```sh
npm create potyro@latest my-app   # the quickest start: a project with an app, tests and scripts
```

or, in a project of your own:

```sh
npm install --save-dev potyro
```

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "reading-list",
  name: "Reading list",
  version: "0.1.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "books", title: "Books", view: { type: "list", entity: "book" } }],
});
```

## `potyro pack`

```sh
npx potyro pack [app.ts] [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
```

Makes the `.potyro-app.zip` that **Add an app → From this device** installs. Without a source it packs
the one `*.app.ts` / `*.app.tsx` in the folder. The modules your app imports go in as code; `file …`
and `--files <dir>` ship as data the app reads with `ctx.files`; `--seed` gives a new copy its first
records; `locales/*.po` beside the source always ship.

## Learn

- [Your first Potyro app](https://potyro.com/docs/start/your-first-app/): a tutorial, fifteen minutes
- [`defineApp`](https://potyro.com/docs/reference/define-app/) and
  [`ctx`](https://potyro.com/docs/reference/ctx/): every field, view, and everything an app's
  functions receive
- [The CLI](https://potyro.com/docs/reference/cli/): `npm create potyro` and `potyro pack`
- [All the documentation](https://potyro.com/docs/)

Node 20 or newer. Custom views are React components: add `react` and `@types/react` to a project
that writes one.

## Licence

Apache-2.0. The source is at [github.com/potyro-app/potyro](https://github.com/potyro-app/potyro),
in `packages/schema`.
