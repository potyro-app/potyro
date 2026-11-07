---
name: new-app
description: Build a new Potyro app in apps/ (or a fixture in examples/) — the files, the shape, what to read, the tests, the gallery, the corpus. Use when asked for "a new app", "an app that…", "add X to the gallery".
---

# A new app

An app is one TypeScript module, `defineApp({...})`, plus its package. Read docs/03 (the shape) and
docs/04 (the `ctx` surface) once; then copy a neighbour that is close to what is asked —
`apps/countdowns` (small, dates), `apps/where-i-parked` (location, one screen), `apps/write-together`
(collaborative text, custom views, comments), `apps/draw-guess` (rooms, multiplayer).

## Decide before writing

- **Who it is for.** Potyro's audience is people who describe an app, not developers: the frequent
  task on the first screen with no scroll, rare actions out of the way, pictures only when they inform.
- **What the platform already has.** Shared or live → cojson through `ctx` (`share: "record"`,
  `ctx.text`, `ctx.caps.network.room`), never a library. Files → `ctx.files`. AI → `ctx.caps.ai`.
  If the app needs a mechanism `ctx` lacks, that is a platform change first (skill `ctx-member`).
- **Built-in views first.** list, detail, table, gallery, checklist, board, steps, calendar, map,
  timeline, stats, chart, aggregate (`packages/views/src/registry.ts`, docs/05 §View contract) cover
  most screens; a custom view is for what they cannot show.

## Files

```
apps/<id>/
  <id>.app.tsx        default export defineApp({ id, name, version, schemaVersion: 1, entities, pages, … })
  package.json        name @potyro/app-<id>; scripts: build (scripts/pack-app.mjs → dist/<id>.potyro-app.zip),
                      typecheck, test; deps: potyro (workspace:*), react
  tsconfig.json       extends ../../tsconfig.base.json, noImplicitAny: false (as the neighbours)
  vitest.config.ts    test name app-<id>, include test/**
  test/               the pure parts (dates, diffs, words) — never the screen
  README.md           what it is for and how it is used, a file map if there is more than one file
  seed.json           optional: the records a demo starts with (build: --seed seed.json)
  <id>.po files       only on request: pnpm i18n:app (docs/30)
```

`pnpm-workspace.yaml` already includes `apps/*`; nothing to register. An app imports only `potyro`
and `react` (`pnpm lint:boundaries` refuses anything else).

## Words and design

- The app's own words are English in the source; translations are catalogs beside it, made with
  `pnpm i18n:app` when asked, never inline maps. Never translate or word-list people's content.
- Icons are Lucide names (`icon: "calendar"`); colours and spacing come from the design tokens
  (`packages/design/README.md`). No hero screens, no empty demos: a demo link must show something.

## Verify

1. `pnpm --filter @potyro/app-<id> typecheck test build`.
2. Open it: `pnpm dev`, add the built zip through Add an app, or add the app to the seeded examples
   in a spec. Drive the real screen at phone width (390) and desktop; read the console.
3. A browser spec `e2e/<id>-trusted.spec.ts`: `packApp("<id>", "<id>.app.tsx")` and `addAsMine`
   from `e2e/library-demos.ts`; assert on what the person sees. Run it on the CI machine, not a laptop.
4. Sealed too when it has custom views: the same app through `dev:sandbox` or a `-sandbox` spec;
   screens are in `.k-sealed-view iframe` frames.
5. `pnpm --filter @potyro/generator gen:corpus` — the app is part of what the Studio's model reads;
   its test fails while the corpus is stale.

## The gallery (when asked)

`gallery/gallery.json` is the page's order; add the entry where its complexity puts it, with a
412 px screenshot in `gallery/shots/`. `pnpm gallery:publish --site https://potyro.app --only <id>
--by Potyro` makes the demo link through the real share flow; `pnpm gallery:build` renders the site.
`gallery/test/gallery.test.ts` pins the order.
