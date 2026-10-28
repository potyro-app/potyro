---
title: How Potyro works
description: What Potyro does and how it is built, layer by layer, for a developer.
status: current
order: 0
---

# How Potyro works

This page is for a developer who wants to know what Potyro is made of: someone deciding whether to
use it, or about to work on it. It goes layer by layer, from the app module down to storage and up
to the Studio that writes apps. Each section says what the layer does, how it is built and why it
was built that way, and ends with where the code is. The deeper pages in `docs/` are linked where
they exist; this page is the entry point, not a replacement for them.

Everything here describes the code as it is, not a plan. Where a mechanism is still behind a flag or
not yet done, the text says so.

## On one screen

- **An app is one TypeScript module.** It default-exports `defineApp({...})`. Its data shape
  (entities, fields, pages) is plain data; its logic (computed values, filters, actions, reminders,
  whole custom views) is ordinary functions. No expression language, no visual builder.
- **`ctx` is the only path to host power.** Every function receives `ctx`: data, time, storage,
  files, the person, the UI, navigation and the device's capabilities. Growing Potyro means growing
  `ctx`.
- **Where code runs is decided by where it came from.** Your own app runs direct. An app that
  arrived from anyone else runs sealed: its logic in a Worker inside an opaque-origin sandboxed
  iframe, host power only through the same `ctx`, mediated, with consent prompts and a watchdog.
- **Everything works offline, and nothing leaves the device until you say so.** Records live in
  SQLite over OPFS; sync is opt-in per app and end-to-end encrypted; a person who never syncs never
  loads the sync engine or touches the network.
- **The Studio writes apps with a model, under gates.** A change is edits the host applies, every
  candidate is validated and run before it is accepted, and a fix counts only when the person's own
  recorded case passes against it.

What Potyro is not: not a no-code builder, not a DSL, not a hosted service.

## The one idea

Here is the shape of an app, cut down from `examples/recipes.app.tsx`:

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "recipes",
  name: "Recipes",
  schemaVersion: 1,
  entities: {
    recipe: {
      label: "Recipe",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        servings: { type: "number", default: 2, min: 1, integer: true, label: "Servings" },
        ingredients: { type: "list", of: { ingredient: { type: "relation", to: "ingredient" }, quantity: { type: "number" } } },
      },
      computed: {
        calories: (r) => r.ingredients.reduce((s, i) => s + i.ingredient.caloriesPer100 * i.quantity / 100, 0),
        caloriesPerServing: { label: "Calories per serving", value: (r) => r.calories / Math.max(r.servings, 1) },
      },
    },
  },
  pages: [
    { id: "all", title: "Recipes", view: { type: "gallery", entity: "recipe", filter: (r, ctx) => matches(r, ctx.params.q) } },
  ],
});
```

Two kinds of thing sit side by side in that object. The **shape** is data: entities, fields, pages
and view layout. The schema package validates it with Zod, and from it the runtime gets storage,
forms, validation and migrations for free. The **logic** is functions: a computed value, a page
filter, an action, a reminder, a custom view written in React. TypeScript types them; nothing
validates them, because arbitrary code cannot be validated, only run somewhere safe.

The decision behind this is the one the project exists for. Every "safe little expression language"
for app logic eventually reinvents variables, conditionals, loops and a bad module system, and
still hits a wall. Potyro refuses the restricted language. The language is unrestricted TypeScript,
with real imports, loops, types and a debugger. What Potyro controls instead are two things that
are independent of the language:

- **The capability surface.** Everything an app can reach is on `ctx`, which the host builds and
  hands to every function. Power is the richness of `ctx`.
- **The execution boundary.** Where the function runs, and with what authority, is the host's
  choice per app. Safety is the boundary.

Power and safety are different axes. The same source runs direct when it is yours and sealed when
it is not, and the code does not know which. The rest of this page is those two axes, layer by layer.

```mermaid
flowchart LR
  A["App module<br/>shape as data + logic as functions"] --> S["Schema<br/>validates the shape (Zod)"]
  S --> H["Host<br/>chooses the boundary, builds ctx"]
  H --> R["Runtime<br/>runs the logic with ctx"]
  R --> V["Views<br/>built-in and the app's own"]
  V --> SH["Shell<br/>launcher, navigation, panels"]
```

<details><summary>Where in the code</summary>

- `packages/schema/src/defineApp.ts` — `defineApp`: identity, normalisation, the Zod check of the declarative parts
- `packages/schema/src/validate.ts` — the field types and what each accepts
- `packages/schema/src/types/ctx.ts` — the `ctx` surface as types; the Studio's reference for the model is generated from these files
- `examples/recipes.app.tsx` — the first example app
- Deep docs: docs/01 (vision and scope), docs/03 (the definition model), docs/04 (`defineApp` and `ctx`)

</details>

## The package map

The repository is a pnpm workspace. A package is a seam: it exports an interface, and the packages
above it depend on that interface, never on another package's internals. This is also how parallel
work is organised, one package per owner at a time, with the working agreement in `CLAUDE.md`.

In dependency order, lowest first:

| Package | Owns | Depends on |
|---|---|---|
| `packages/schema` (published as `potyro`) | `defineApp`, the `ctx` types, Zod validation of the declarative parts, `potyro pack` | nothing |
| `packages/design` | the designer's tokens, fonts, logo and colour clock; the Lucide icon table | nothing |
| `packages/i18n` | Potyro's own words in the person's language: locale matching, Lingui catalogs, Intl helpers | nothing |
| `packages/identity` | who you are on this device: the account seed, the cached id and name, recovery words, the secret vault | nothing (cojson) |
| `packages/capabilities` | the `Capabilities` interface, the web implementation, the fakes, the conformance suite | schema |
| `packages/store` | the `Store` interface; `MemoryStore`, `LocalStore`, `SqliteStore`, `JazzStore`; migrations, export, packages, the app's folder | schema |
| `packages/rooms` | the rooms relay for multiplayer apps, and its wire protocol | nothing |
| `packages/host` | loading and running an app: the direct runner, the browser realm, the QuickJS fallback, `ctx` construction, capability mediation | schema, store, capabilities, rooms (protocol) |
| `packages/runtime` | the record model, relation resolution, the computed and action runners, the reminder reconciler, JS-predicate queries, React hooks | schema, store, capabilities, host |
| `packages/views` | the view registry, the built-in views, the host for an app's custom views | runtime, schema, i18n, design |
| `packages/generator` | the model backends, the prompt and its generated reference, the corpus, the create/modify/fix loops, Ask, the evals | schema, store, capabilities, host, runtime, i18n |
| `packages/native` | the Capacitor target for Android and iOS: native capability implementations and the native vault | schema, capabilities |
| `packages/share-links` | the share service for demo links: encrypted packages and their preview cards | nothing |
| `packages/ai-relay` | the relay that pays for the free AI allowance with Potyro's key, with caps | nothing |
| `packages/platform-requests` | the relay that files "Potyro lacks this" requests as GitHub issues | nothing |
| `packages/shell` | the product: launcher, navigation, panels, the Studio, trust prompts, import and export, sharing, the composition root, the PWA build | everything above |
| `packages/create-potyro` | `npm create potyro <dir>`: a starter for writing an app outside this repo | nothing |

Beside the packages: `apps/` holds twenty-one real apps, each built as an installable package, which
are the gallery's content and part of the corpus the Studio's model reads; `examples/` holds the six
living fixtures (recipes, plants, places, groceries, split, workout) that the tests and the tutorials
are written against; `docs/tutorials/code` holds the tutorial's code, stage by stage, checked by its
own tests.

Four rules keep the seams honest, and `pnpm lint:boundaries` (`scripts/check-boundaries.mjs`) fails
on the obvious violations:

- Views talk to the runtime API only. They never import the store, the host or the capabilities.
- The runtime depends on the `Store` and `Capabilities` interfaces, never on a concrete
  implementation. The implementations are chosen once, at the composition root in the shell.
- App code reaches host power only through `ctx`. An app module may import `potyro`; it never
  imports a host, store or capabilities package.
- The four servers (`rooms`, `share-links`, `ai-relay`, `platform-requests`) depend on no Potyro
  package. The shell imports only their browser-safe wire formats.

```mermaid
flowchart BT
  schema --> capabilities
  schema --> store
  schema --> host
  store --> host
  capabilities --> host
  rooms -. protocol .-> host
  host --> runtime
  store --> runtime
  runtime --> views
  i18n --> views
  design --> views
  runtime --> generator
  host --> generator
  views --> shell
  generator --> shell
  identity --> shell
  native --> shell
  capabilities --> native
  subgraph servers [servers, no Potyro dependency]
    sharelinks[share-links]
    airelay[ai-relay]
    platreq[platform-requests]
    rooms
  end
  servers -. wire formats .-> shell
```

<details><summary>Where in the code</summary>

- `CLAUDE.md` — the working agreement: the seams, the dependency order, the commands
- `pnpm-workspace.yaml` — what is in the workspace
- `scripts/check-boundaries.mjs` — the boundary check behind `pnpm lint:boundaries`
- `packages/*/package.json` — each package's one-line description and its Potyro dependencies

</details>

## An app's life

From a file on disk to a screen on a phone, an app passes through six stages. Every one of them is
the same whether the app is yours or arrived from someone else; only the fourth decides where the
code runs.

1. **Define.** A person, or the Studio's model, writes the module: `defineApp({...})` with its
   entities, pages and functions. The entry file may import the app's own modules and libraries by
   URL (see "Export, import and packages").
2. **Validate.** `defineApp` normalises the declarative parts and checks them with Zod: every field
   has a known type, every relation points at an entity that exists, every page names a view the
   registry has. The functions are typed by TypeScript and otherwise left alone.
3. **Bundle.** In the browser, esbuild-wasm joins the entry, the app's own modules and its libraries
   into one file (`packages/shell/src/app-bundler.ts`). Before esbuild reads a byte of a module or a
   library, the bytes are checked against the app's lock. For a trusted app the imports of `potyro`
   and `react` resolve to the shell's real modules; for a sealed app they resolve to stubs, so Zod
   and React never enter the untrusted bundle.
4. **Load.** The host decides by provenance (`packages/host/src/create-host.ts`). Your own app loads
   as an ES module in the page and runs direct (`direct-host.ts`): the functions are real closures
   and a custom view is a real React component. An app that came from anyone else loads sealed: the
   bundle runs in a Worker inside a sandboxed iframe, and the host talks to it over a MessagePort
   ("Security isolation" below). Either way the result is a `LoadedApp` with the same `call*`
   methods, so nothing above the host knows the difference.
5. **Run.** The runtime (`packages/runtime/src/core.ts`) owns the read path and the write path. It
   resolves records through the store, follows relations, runs computed values, applies a page's
   filter and sort as JavaScript over the rows, runs actions, and reconciles reminders. Every call
   into app code goes through the host, which is what keeps direct and sealed execution uniform.
6. **Render.** The views package (`packages/views/src/registry.ts`) has fourteen built-in views:
   list, gallery, table, detail, calendar, map, steps, checklist, board, timeline, stats, chart,
   aggregate, and custom, which mounts the app's own React component. The shell puts the page in
   its chrome: the launcher, navigation, the panels for data, history, people and the Studio.

### The read path

1. The shell mounts a page. The page names an entity, a view, and a filter and sort that may be
   data or functions.
2. The runtime asks the store for the entity's records, resolves relations, and runs the computed
   values the view needs, through the host, memoised for the pass.
3. The runtime applies the page's filter and sort as JavaScript over the resolved rows, again
   through the host. There is no query planner: at personal scale, thousands of records and not
   millions, a predicate over an in-memory array is simpler and fast enough, and it removes a whole
   class of pushdown and residual logic.
4. The rows reach the view, built-in or the app's own.
5. The runtime subscribes to the entity; a change re-runs the query and the view updates.

### The write path

```mermaid
sequenceDiagram
  participant V as View
  participant R as Runtime
  participant H as Host
  participant A as App function
  participant S as Store
  V->>R: runAction(entity, key, id, input)
  R->>H: callAction(record, ctx)
  H->>A: action(record, ctx)
  A->>S: ctx.data.update(...)  (through the mediated ctx when sealed)
  S-->>R: subscribe: entity changed
  R-->>V: re-query, re-render
```

An action does its work through `ctx`: patch or create records, read the time, reach a capability,
open a sheet. For a sealed app each of those is a message to the host, answered on a ctx whose
capabilities are mediated. After a write the reminder reconciler recomputes the reminders that
depend on the changed record and schedules them through `ctx.caps.notifications` where the device
has them.

<details><summary>Where in the code</summary>

- `packages/schema/src/defineApp.ts` — validate and normalise
- `packages/shell/src/app-bundler.ts` — bundle in the browser; `packages/shell/src/package-modules.ts` resolves modules and libraries against the lock
- `packages/host/src/create-host.ts` — dispatch by provenance; `packages/host/src/direct-host.ts` — the trusted runner; `packages/host/src/realm/` — the sealed runner
- `packages/runtime/src/core.ts` — the read and write paths; `packages/runtime/src/watch.ts` — framework-free subscriptions; `packages/runtime/src/hooks.ts` — the React binding
- `packages/views/src/registry.ts` — the built-in views; `packages/views/src/custom.tsx` — the app's own view
- `packages/shell/src/main.tsx` — the composition root
- Deep docs: docs/04 (the `ctx` surface), docs/05 (the runtime interfaces)

</details>
