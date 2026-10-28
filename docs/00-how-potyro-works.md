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

## Storage

Everything an app keeps goes through one interface, `Store`, and nothing above it knows which
implementation is behind it. The interface is small enough to read in one go:

```ts
interface Store {
  open(appId): Promise<void>; close(): Promise<void>;
  all(entity, narrow?); get(entity, id); byIndex?(entity, field, value);
  insert(entity, data); update(entity, id, patch); delete(entity, id); increment?(…);
  transaction(fn); subscribe(entity, cb);
  putBlob(blob); getBlob(ref); deleteBlob(key); blobHere?(ref);
  listFiles(); getFile(id); setFile(entry); deleteFile(id);
  kvGet(k); kvSet(k, v); kvDelete(k); kvKeys?(prefix);
  storedSchemaVersion(); runMigrations(plan); memberIds?();
}
```

Records, blobs (photos and files' bytes), the app's folder, a key-value area (`ctx.storage`, where
an app keeps its own state), and the schema version. Three implementations exist, and the shell
chooses one per app at the composition root (`packages/shell/src/open-store.ts`):

**SqliteStore over OPFS** is the default. One SQLite database per app, the engine being
`@sqlite.org/sqlite-wasm`. Records are rows of a generic document table: entity, id, a JSON
document of the field values, and the two timestamps, with tables beside it for blobs, kv, files
and meta. A record is read and written as a document, so adding a field is not a schema change in
SQLite, which keeps migrations simple.

The engine runs in a dedicated Web Worker (`packages/store/src/sqlite-worker.ts`), and this is not
an optimisation: the OPFS sync-access-handle API that makes SQLite durable exists only in workers,
in every browser. Before the worker existed, every device silently fell back to a path that
rewrote the whole database into IndexedDB after each write, so ticking a box in a shopping list paid
for the photo library of an unrelated app. In the worker a write costs the write. All of a device's
databases share one handle pool, because a pool per app ran out of handles after a handful of apps.
Writes are committed when they return; a reload the instant after an add never loses it.

**One tab owns the storage** (`packages/store/src/storage-owner.ts`). The pool holds an exclusive
handle on every file it serves, so a second tab of the same origin cannot open the same pool; before
this was handled, two tabs quietly became two diverging copies of the same apps. A Web Lock names
the owner. Another tab is told that Potyro is open elsewhere and offered the take-over: the lock
moves, the old owner closes its databases outside any transaction and lets go of the files. A
SharedWorker cannot host the pool (sync access handles are for dedicated workers only), and routing a
second tab through the first tab's worker would give it the bytes but not the truth, because each
tab keeps its own in-memory model of what is stored.

**LocalStore** is the fallback where the pool cannot be built: Firefox and headless Chrome lack
it. It serialises the app under one key in localStorage and rewrites it after each mutation, which
is fine at personal scale and nowhere else. `MemoryStore` is the same interface in memory, for
tests and the runtime's default.

**JazzStore** is what an app gets when sync is on: the CRDT store, durable on cojson's own OPFS
SQLite file, with per-field merge across devices. The next section is about it. A synced app
cannot fall back to LocalStore, which has no CRDT; rather than silently drop the guarantee the
person switched on, opening fails loudly and the shell says so.

```mermaid
flowchart TB
  shell[Shell: open-store.ts chooses per app] --> store[Store interface]
  store --> sq[SqliteStore]
  store --> ls[LocalStore]
  store --> jz[JazzStore]
  sq --> w[dedicated Worker: sqlite-wasm, one SAH pool, one tab owns it]
  w --> opfs[(OPFS)]
  ls --> local[(localStorage)]
  jz --> cojson[cojson node, per-field merge] --> opfs2[(OPFS SQLite)]
```

On top of any store sit three things that are the same whichever one is underneath:

- **The app's own folder** (`packages/store/src/file-space.ts`). A store keeps an index of file
  entries and the bytes as blobs; the folder is the rules on top: a path is taken by one file at a
  time, a file's id survives a rename so a `file` field keeps pointing at it, replacing the bytes
  keeps the id and the created time, every write records a digest, and bytes are written before the
  entry that points at them. In a shared app two members can write the same file; the last write
  wins at the file level and what it replaced is kept for a while as an earlier copy, visible in the
  folder and never to the app.
- **History and the Studio's conversation** are stores of their own, under their own namespaces.
  Sources are large and there are many versions of each app; the localStorage budget already
  carries every app's current source, and history is exactly the thing that would push it over.
- **Migrations** (docs/06). An app declares its `schemaVersion` and a list of steps: `addField`,
  `dropField`, `renameField`, `renameEntity`, and `transform`, a function over every record as the
  escape hatch. The steps are applied by one shared, pure function (`packages/store/src/migrate.ts`)
  so every store runs identical semantics, and the test suite for the in-memory store covers the
  logic the SQLite store relies on. The Studio adds a check above this: after a model changes an
  app, every stored value is compared before and after, and a value that disappeared without a
  migration step to account for it is reported as loss ("The Studio and the generator" below).

<details><summary>Where in the code</summary>

- `packages/store/src/types.ts` — the `Store` interface
- `packages/store/src/sqlite-store.ts`, `packages/store/src/sqlite-backend.ts`, `packages/store/src/sqlite-worker.ts`, `packages/store/src/sqlite-worker-client.ts` — SQLite over OPFS in a worker
- `packages/store/src/storage-owner.ts` — one tab owns the pool
- `packages/store/src/local-store.ts`, `packages/store/src/memory-store.ts`, `packages/store/src/idb-sqlite.ts` — the fallbacks
- `packages/store/src/file-space.ts` — the app's folder
- `packages/store/src/migrate.ts` — migration steps, shared by every store
- `packages/shell/src/open-store.ts` — which store an app gets; `packages/shell/src/app-history.ts`, `packages/shell/src/studio-chat.ts` — history and the conversation as their own stores
- Deep doc: docs/06

</details>

## Sync, CRDT and identity

Sync is opt-in per app, never a property of the product. An app that has not asked for it has no
network, no identity engine and no CRDT loaded; one that has lives in a **space**, a group of people
with roles, whose data is a tree of CRDT values encrypted to its members and pushed through a relay
that can read none of it.

### Why Jazz

The engine evaluation (`docs/adr/0001-sync-engine-and-identity.md`) measured Jazz, Yjs and Evolu
against the same apps, with the spikes kept in `docs/spikes/`. Jazz's cojson won on four points:

- **Per-key merge on a document model.** Two people editing different fields of one record both
  survive. Evolu's per-column model needed a storage rewrite to get the same property.
- **A real list CRDT.** Concurrent appends to a nested list field both survive, and three of the
  first four example apps have nested lists.
- **Permissions fail closed in the crypto layer.** A non-member has no read key, so no valid
  transaction exists. It is not a policy check that can be bypassed.
- **Self-hostable, with app data as ciphertext only.** Verified end to end against a real
  `jazz-run sync` server; group and account metadata is visible to the relay, app writes are opaque.

Yjs is the documented fallback: its merge semantics are equivalent and the `Store` shape barely
changes. The ADR keeps the Yjs design on purpose.

### The tree

A record is a CoMap, because that is the only shape in which cojson merges per key. Stored as one
JSON blob inside a CoMap it would collapse to whole-record last-write-wins, the failure that
disqualified Evolu.

```mermaid
flowchart TB
  G[Group: the space, members and roles] --> root[root CoMap]
  root --> ent["entities: CoMap&lt;entity, index&gt;"]
  ent --> idx["index: CoMap&lt;recordId, record&gt;"]
  idx --> rec["record CoMap: field → value (per-key merge)"]
  root --> kv["kv: ctx.storage, and the published app source"]
  root --> blobs["blobs: photos, files' bytes"]
  root --> meta["meta: schemaVersion, appVersion"]
  root --> chat["chat: messages beside the data, never reachable from ctx"]
```

Chat sits beside the entity tree. It is in the space, so it syncs and is encrypted to the members,
but it is not app data: an app shared with you is someone else's code, and nothing in `ctx` reaches
the conversation. Messages are ordered by a hybrid logical clock (`packages/store/src/hlc.ts`),
because wall clocks disagree: a device five minutes fast put its replies into everyone's future,
and the conversation read backwards with nothing that looked like a bug. The clock folds every
stamp a device has seen into its own, so a reply can never precede its cause.

A JazzStore write returns only when cojson has written it to storage. That was a real bug: cojson
flushes on its own schedule, and an add followed by an instant reload was gone. A write in the
synced store now means what a write in the SQLite store means.

### Identity

A person is a display name plus a **cojson account**, created silently on first run. No signup, no
email, no identity server. The account id is derived from a secret seed by crypto alone, so minting
an identity needs no database, no node and no network; the account CoValue is materialised lazily,
the first time an app syncs, and the ids agree by construction. A person who never turns on sync
has an identity and has still never loaded the CRDT engine.

The id is for life. Every `createdBy` ever stamped points at it; an id that changed when sync was
turned on would orphan authorship across every shared record. That is also why `createdBy` is the
account id and not a field an app writes: cojson signs every transaction with the account that made
it, so the id is provable, while a value in a field is just data any writer could forge. The host
stamps authorship; app code sees `ctx.me`, `ctx.space.members` with their roles (`admin`, `writer`,
`reader`), and a `member` field type that may only name someone in the space.

The seed and the agent secret are the whole identity, so they live in a vault
(`packages/identity/src/vault.ts`): the platform keystore on Android and iOS, and on the web an
IndexedDB entry encrypted with an AES-GCM key the browser generated as non-extractable. The limit is
stated plainly: code on this origin can still ask that key to decrypt. What the vault removes is the
secret lying in the clear in localStorage, where an extension or a backup tool could read it.

A second device is linked by the seed as recovery words. The words identify you with no lookup, but
the new device still has to load the account, and that arrives through the relay you already sync
through. There is no identity server; there is a transport.

### Two kinds of trust that never merge

Potyro has two orthogonal axes called trust, and collapsing them is the mistake the design guards
against. **Code trust** is provenance: your own app runs direct, anyone else's runs sealed. **Peer
trust** is membership: who may read and write a space. A friend you trust completely can send you an
app, and it still runs sealed. Being invited to someone's data says nothing about whether their code
should run with ambient authority. In fact the sealed box is what makes accepting a friend's app
safe.

### Turning sync on is a copy, not a switch

The local store and the synced store keep their data in different files. Flipping a flag would open
the app empty, which is indistinguishable from data loss. So `packages/shell/src/toggle-sync.ts` is
the only place allowed to do it, and it copies first and flips the flag only when the copy
succeeded. The copy (`packages/store/src/copy-store.ts`) preserves what a naive copy would lose: ids
and creation times, because relations and media references point at them; blob keys, because a
record's photo points at a key and minting a new one loses every photo while appearing to succeed;
the kv area; the app's folder with its ids. Nothing is deleted from the old store, so a migration
that turns out wrong is reversible by flipping back. Bytes that are not on this device are reported,
not copied.

"Back up everything" (`packages/shell/src/backup-all.ts`) is the same mechanism applied to every
app, one at a time with progress, because a new device should bring back every app and not only the
ones someone remembered to tick. It is off until asked for: nothing in Potyro sends data anywhere
until the person says so.

Which apps are yours is kept on your account, not on a device (`packages/store/src/account-apps.ts`):
a map from app id to the space holding its data, the app's code, and roughly how much there is to
fetch, encrypted to your keys and stored on the relay like any other value. A new device signs in,
reads the map, and asks for the spaces it names.

### The relay

The relay is a dumb, encrypted store-and-forward server: an append-only log of opaque update blobs
per space, which it can never decrypt. It is `jazz-run sync` with a SQLite file, run in a container.
Peer-to-peer was considered and rejected as the primary transport, because the use cases are
asynchronous (you add an expense at dinner, your flatmate reconciles on Sunday), a backgrounded phone
app is not a peer, and NAT traversal needs a TURN server, which is a hosted relay by another name.
A solo synced app is a space with one member and no peers: still no network.

### What breaks when an app is shared

Per-field last-write-wins is the right merge, and app code can still be wrong about it. The first
app shared in a public test had two such bugs, neither producing an error (docs/17): reordering by
swapping two rows' `order` values fused them, because a swap is a read-modify-write across two
records and nothing makes that atomic; and a `+1` button that read the count on screen and wrote it
back lost presses when two people pressed at once. Both devices agreed on the wrong answer. The
store answers the second with `increment(entity, id, field, delta)`, which takes the delta and lets
the CRDT sum each contributor; the first is a modelling rule. The Studio runs a two-peer check on
every app it saves (`packages/shell/src/check-concurrency.ts`) and reports what would not survive
two people, without blocking the save, because plenty of apps are never shared.

<details><summary>Where in the code</summary>

- `packages/store/src/jazz-store.ts` — the CRDT store and the tree; `packages/store/src/jazz-backend.ts` — opening it durably, the account, the group, the root, durability on write
- `packages/store/src/hlc.ts` — the hybrid clock; `packages/store/src/people-log.ts` — guests and the people log
- `packages/identity/src/identity.ts`, `packages/identity/src/vault.ts` — the account, the id for life, the secret vault
- `packages/store/src/copy-store.ts`, `packages/shell/src/toggle-sync.ts`, `packages/shell/src/backup-all.ts` — sync as a copy
- `packages/store/src/account-apps.ts` — your apps, on your account
- `packages/shell/src/open-store.ts` — which store, and the live space for `ctx.space`
- `packages/shell/src/check-concurrency.ts`, `packages/store/test/concurrency-hazards.test.ts` — the two-peer check
- Deep docs: `docs/adr/0001-sync-engine-and-identity.md`, docs/17, docs/16 (running the relay)

</details>

## Export, import and packages

Your data is a plain file you fully own, and an app is a zip anyone can read. Three formats carry
things between devices and people; all three are built on the same reader.

### The export bundle

Export packs an app's logic and data into one `.potyro.zip` (`packages/store/src/export.ts`):

| File | What it is |
|---|---|
| `data.sqlite` | a real SQLite file: opens in any SQLite browser, Datasette, or the command line |
| `data.json` | every entity's rows as JSON |
| `csv/<entity>.csv` | one CSV per entity |
| `manifest.json` | schema version, provenance, granted capabilities, the app's declaration as data, the mode |
| `app.ts` | the app's source |
| `lock.json`, `files/.modules/`, `src/` | the app's code beyond its source: its libraries' bytes and its own modules, with a lock naming every file and its digest |

Two modes: `snapshot` is stripped and human-friendly, one way; `mergeable` is the full state. Import
reads the bundle back and reopens the SQLite bytes as a working store. Because the code travels with
its lock, adding an app from a bundle on a device that never had it fetches nothing, and a file that
is not what the lock says is refused by name. A shared app's files whose bytes were never on the
exporting device are named in the manifest, not fetched: an export must never pull every member's
files through one device.

### An app is more than its entry file

`apps/palette-catcher` is one app and seven files: the entry, `palette-catcher.app.ts`, and six
modules it imports relatively, `card.ts`, `names.ts`, `palette.ts`, `sample.ts`, `styles.ts` and
`words.ts`. `apps/mood-sleep` imports Chart.js by URL, pinned to an exact version:

```ts
import { Chart, registerables } from "https://esm.sh/chart.js@4.5.1?bundle";
```

Libraries are URL imports only, never bare npm names: a URL names bytes that can be fetched and
locked, a package name does not. `potyro pack` (`packages/schema/cli/pack.mjs`; in this repository
`pnpm pack:app`) follows the entry's imports with esbuild into the package's `src/`, so only what the
app really runs is packed and a type-only import adds nothing, and refuses an import that leaves the
source's folder. At run time esbuild-wasm bundles entry, modules and libraries into one file in the
browser. The security section says how the lock makes that safe.

### The app package

What travels when an app is shared or installed is a package in the `potyro-app/1` format
(`packages/store/src/app-package.ts`):

| File | What it is |
|---|---|
| `app.ts` or `app.tsx` | the source |
| `src/<path>` | the app's own modules |
| `files/<path>` | files the app ships with, installed into its folder as shipped |
| `lock.json`, `files/.modules/` | the libraries the source imports by URL, and their bytes |
| `seed.json` | first records, `{ entity: [row, …] }`, applied once on first install |
| `manifest.json` | `{ format: "potyro-app/1", source, files, modules, app, credit?, line? }` |
| `chat.json` | optional: the Studio conversation that made it |

The manifest's `app` is what the app declares, as data, with every function replaced by a marker.
That is what the Add-an-app card reads: name, entities, pages, what it asks for, what it ships,
without running the code. Before the person confirms, the module is also loaded in the sealed box on
a throwaway store and sample records are put through its functions, so a feature the box lacks is
named on the card in plain words. `credit` says who made it and what it is a remix of; `line` says
which app it is across devices, so a link made on one device opens the right copy on another. A bare
source is a package with no files; an export bundle is read as a package too, which is how a backup
installs on a device that never had the app.

Everything comes in sealed. A file from this device or pasted source may be marked "I wrote this"
on the card; a link never can, and an update that arrives by link drops a trusted app back into the
sealed box, so a link cannot put new code into an app that runs with full authority.

### Moving to a new home

When Potyro moved domains, the apps had to move with it, and no server was allowed to see them. The
old site opens the new one and the two windows talk with `postMessage`
(`packages/shell/src/move-protocol.ts`): each side accepts messages only from the window it is
talking to, only from a Potyro origin, and only for a channel id made fresh for this hand-over.

```mermaid
sequenceDiagram
  participant Old as old site
  participant New as new site (opened at /?move=channel)
  New-->>Old: hello
  Old->>New: offer: manifest + digest
  Note over New: shown to the person; nothing taken yet
  New-->>Old: send (only after "Bring them in")
  Old->>New: archive (accepted only if its digest is the offer's)
  New-->>Old: done | failed
```

<details><summary>Where in the code</summary>

- `packages/store/src/export.ts` — the export bundle; `packages/store/src/app-package.ts` — the package format and its reader
- `packages/store/src/app-declaration.ts` — the app as data for the card
- `packages/schema/cli/pack.mjs`, `scripts/pack-app.mjs` — `potyro pack`
- `packages/shell/src/add-app.ts`, `packages/shell/src/app-trial.ts`, `packages/shell/src/package-libraries.ts` — Add an app, the test load, what a package fetches
- `packages/shell/src/move-protocol.ts`, `packages/shell/src/move-page.tsx` — moving to a new home
- Deep docs: docs/07 "Packages and Add an app", docs/16 "Moving to a new home", docs/24 §6 (credit and remix)

</details>

## Device capabilities

The device's powers reach app code as `ctx.caps.*`, and only that way. Behind `ctx.caps` is one
interface, `Capabilities` (`packages/capabilities/src/types.ts`), with an implementation per target.
A member is `null` where the target lacks it, and the runtime degrades rather than fails.

| Capability | What app code gets | Web | Native (Capacitor) |
|---|---|---|---|
| `camera` | take a photo | file-input capture | the camera plugin |
| `notifications` | schedule, list and cancel reminders | `null`: a browser cannot promise exact offline scheduling, so reminders fall back to the in-app due surface | exact local notifications |
| `geo` | the position | Geolocation API | the geolocation plugin |
| `haptics` | a tap | Vibration API | the haptics plugin |
| `filesystem` | save and open files | File System Access API, with an input and download fallback | the filesystem plugin |
| `network` | `fetch`, WebSocket connections, rooms | `fetch`, WebSocket | native HTTP, native sockets |
| `liveCamera` | a live video stream, with faces found | `getUserMedia` | the same, in the WebView |
| `ai` | send text or a picture to a model and get text or JSON back | the AI relay, or the person's own key | the same |
| `share` | the device's share sheet | Web Share | the share plugin |
| `speech` | voice input | Web Speech | the native recogniser |

The two implementations were written months apart, so a **conformance suite**
(`packages/capabilities/src/conformance.ts`) runs one behavioural spec against both: which members
exist, what shapes come back, and that scheduling, listing and cancelling a reminder agree with each
other. The one honest difference, whether exact scheduling is supported, is asserted to match what
the target claims about itself. What only a device can prove, that a notification fires with the app
closed, stays a device test. `pnpm conformance` runs both. Tests of the runtime and the views use
`FakeCapabilities` from the same package.

### Permission is per app, and authority is per trust

An app declares what it wants in its manifest:

```ts
permissions: { camera: true, filesystem: true, network: { hosts: ["api.open-meteo.com"] }, ai: true }
```

For your own app the manifest changes nothing: `ctx.caps` is the device's capabilities, unmediated.
For a sealed app the host builds a different `ctx.caps` (`packages/host/src/mediate.ts`): every
capability is absent unless the manifest asked for it; each one that was asked for is granted only
after a consent prompt, once per app on this device; and some are scoped by a wrapper, so the
filesystem is a folder of the app's own and the network is the hosts the manifest names. A shared
app that asks for a host its manifest does not name is refused at once, without a prompt. The
interface app code sees is the same at both trust levels; authority is what differs.

Two capabilities have a server behind them, and both follow the same rule: the server never sees
more than the app sent.

- **AI** (`ctx.caps.ai`, docs/23). An app names a kind of work and passes exactly what the call
  needs: some text, a photo, a schema for the answer. There is no ambient context, and the key never
  reaches app code; the shell holds it, picks the service and makes the call. A sealed app asks
  first, naming the service and what goes, and the prompt says who would pay as things are now: the
  free allowance through Potyro's relay (`packages/ai-relay`), which holds Potyro's key, fixes the
  model, and meters per device, per address and with a monthly cap checked before every dispatch;
  then the person's own key from Model settings; then nothing, and the call fails in words.
- **Live connections** (`ctx.caps.network.socket` and `.room`, docs/28). A WebSocket to a host the
  manifest names, or a room on Potyro's relay (`packages/rooms`, docs/26) for multiplayer apps. The
  rooms relay keeps nothing, authenticates nobody, logs no payload, and forwards every frame a member
  sends to every other member of the room; the room id is the only capability. An app that needs the
  relay itself unable to read its messages encrypts them with a key in the share link's fragment.

The live camera (docs/25) gives a page a video element and the faces found in it, one per page
however many apps ask, and only to trusted apps. Speech (docs/29) gives the Studio its microphone
and apps a recogniser behind the same consent.

<details><summary>Where in the code</summary>

- `packages/capabilities/src/types.ts` — the interface; `packages/capabilities/src/web.ts` — the browser; `packages/capabilities/src/fake.ts` — for tests; `packages/capabilities/src/conformance.ts` — the shared spec
- `packages/native/src/capacitor-capabilities.ts` — the Capacitor implementation
- `packages/host/src/mediate.ts` — the sealed app's `ctx.caps`; `packages/host/src/sockets.ts`, `packages/host/src/speech.ts`, `packages/host/src/ai.ts` — per-capability mediation
- `packages/ai-relay/src`, `packages/rooms/src` — the two servers
- `packages/schema/src/types/app.ts` — `PermissionManifest`
- Deep docs: docs/07 (the capability matrix), docs/23, docs/25, docs/26, docs/28, docs/29

</details>

## Security isolation

The one property worth protecting is: *I can open an app someone sent me without it wrecking my
machine.* Potyro protects it with an execution boundary, never with a language restriction, and the
boundary is chosen by **provenance**. Your own app runs direct, with full authority. An app that
arrived from anyone else, by link, file, paste or sync, runs **sealed**, and nothing about the app
can change that; only you can, by promoting it.

### The browser realm

A sealed app's logic runs in a Worker inside an iframe with `sandbox="allow-scripts"` and nothing
else: an opaque origin, no same-origin access, no navigation, no popups, no forms. The frame carries
a strict Content Security Policy (`default-src 'none'`, `connect-src 'none'`, `blob:` for the
Worker), so nothing in it can fetch, and the WebRTC constructors are deleted before any app code runs,
because WebRTC is a channel the CSP does not govern. The shell itself is served with
`frame-src 'none'`, so the frame cannot navigate itself anywhere that fetches.

```mermaid
flowchart LR
  subgraph page [Shell page, the real origin]
    host[realm-host.ts: the host half]
    ctx[the app's mediated ctx]
  end
  subgraph frame [sandboxed iframe, opaque origin, strict CSP]
    worker[Worker: the app's logic bundle]
  end
  subgraph vframe [one sandboxed iframe per custom view]
    view[the view bundle, React inside]
  end
  worker <-- MessagePort: ops --> host
  view <-- its own MessagePort --> host
  host --> ctx
```

The only way out of the realm is a MessagePort to the host. The app's `ctx` in the Worker is a proxy
(`packages/host/src/realm/ctx-proxy.ts`): every call becomes a message naming an op from a fixed
allow-list and a ctx id the host issued. The host coerces the arguments, which are values from
untrusted code, and calls the same method on the same `ctx` a trusted app would get, built with the
mediated capabilities, the values gate and authorship stamping inside. That sentence is the design:
**there is no second copy of any check.** An op the realm sends is the method call a trusted app
makes, on a ctx whose authority is already decided. Blobs, bytes and dates cross by structured
clone; functions never cross.

The watchdog gives every call a deadline and the Worker beats every 100 ms. A missed deadline or a
silence of a second kills the realm, frame and Worker together, and rejects what was waiting; the
next call starts a fresh realm, measured at 40 to 60 ms. Deadlines pause while the app is waiting on
the person or the world (a prompt, a dialog, a fetch), so an app can stretch its budget only by
asking something. Before this, a generated app with a runaway loop froze the tab.

### Sealed custom views

An app's own screens are React components, and a sealed app's run in a sandboxed frame of their
own, one per mounted view, with the same authority as the logic and no more
(`packages/host/src/realm/sealed-view.ts`). The shell keeps the chrome and navigation; the frame
fills the page's content area and scrolls inside itself. Its ops go to the host through its own
port and are answered from the same table the logic uses, with a fresh mediated ctx per op; a few
view-only ops (watch a query, run an action, navigate) are accepted on a view's port alone. Media
and files reach the frame as bytes, and the frame makes its own `blob:` URLs, because the shell's do
not load in an opaque origin.

A frame per view means a stuck view is removed without ending the app's logic, and unmounting takes
the view's whole document with it, whatever it forgot to clean up. The view watchdog pings every
250 ms and stops a view that is silent for two seconds or blocks the page for two seconds. On every
engine but desktop Chromium a view's frame shares the shell's thread, so an endless loop there
freezes the tab and nothing in the tab can stop it. The **crash-loop guard**
(`packages/host/src/realm/view-guard.ts`) makes that happen at most once per app: a marker goes into
localStorage before a view mounts and is kept fresh while it answers; a marker found stale means
that view took a tab down, and the app's views are not mounted again on this device until the person
asks. On Chromium every sandboxed frame shares one renderer process, so after a silent stop the host
pings every live logic frame and, if one does not answer, restarts every realm to free the process.

### What the host enforces in every box

Two checks sit in the direct `ctx` and in the realm's bridge alike, so neither can drift into
trusting the app. The **values gate** (`packages/host/src/values-gate.ts`) refuses a write whose
values do not fit the entity's fields, because in a shared app the other copies would have to survive
it and the next reader cannot tell a bug from a tampered change; a `member` value may name only
someone in the space. **Authorship** (`packages/host/src/authorship.ts`) stamps `createdBy` from the
account, never from a value the app supplied.

### The code beyond the entry file

An app's own modules and its libraries are code, and code must be the code the app was installed
with. The **lock** (`packages/store/src/app-lock.ts`) maps every library URL and every own module to
the file holding it in the app's space (`.modules/<sha256>.js`, `.src/<path>`) and the digest of its
bytes, in the Subresource Integrity form. It lives on the app's record beside its source, never in
the synced file space, so a collaborator cannot change code that runs on your device by changing a
file. `.modules/` and `.src/` are hidden from `ctx.files`, and the app cannot write them.

One bundler plugin (`packages/shell/src/package-modules.ts`) serves both trust levels and reads every
module and library through the store, checking the digest before esbuild sees a byte. A mismatch
refuses to bundle, by name ("chart.js 4.5.1 is not the copy this app was installed with"), and the
app shows that instead of opening.

Fetching a library is an install step, never a run-time act (`packages/shell/src/library-fetch.ts`,
`packages/shell/src/open-libraries.ts`). It happens once, host-side, after the person allows the
card's line ("fetches chart.js 4.5.1, 190 KB, from esm.sh"), and `ctx.caps.network` plays no part. The
fetch walks the library's whole import graph with esbuild and locks every file it reaches, or refuses
by the library's name: a URL without an exact version, a file the host does not serve, a bare package
name inside a library, an `import()` of a value decided at run time, a file loaded beside itself
through `import.meta.url`. Nothing half-locked is kept, so an app never breaks offline because a file
it needs was left behind.

What travels with an app and what does not is decided by the same reasoning
(`packages/store/src/carried-code.ts`). The lock and the app's own modules travel with the source,
in the same record, so a new source can never arrive ahead of the module it imports; modules are
checked against the lock on arrival like every other byte. Library bytes do not travel: p5 alone is
megabytes, and every device can fetch them from the address the lock names and check them.

In the sealed box a library is more code in the Worker: no DOM, no `fetch`. A library that reaches
for `window` while loading fails with its own name, and the app says it can only run as yours. The
Studio's checks stand libraries in as inert values, identically for the original and the candidate,
so a change to the app's own code can still be judged.

### The fallback, consent, promotion, and the limits

**QuickJS-WASM** was the sealed box before the realm and remains behind a flag
(`packages/host/src/isolate/`, chosen by `packages/shell/src/sandbox-runner.ts`): for a whole build,
for one device through localStorage, or automatically where no realm can be built (no DOM or no
Worker, which is the Node tests and a very old WebView). Both boxes are sealed; the choice is which
engine, never whether the app gets ambient authority. The Studio's own checks of a candidate still
run in QuickJS. The realm won on the measurements in docs/22: a shared app that uses `Intl`, `URL`
and a charting library runs and draws, where through QuickJS its computed values came back empty,
and a `ctx` round trip is faster.

**Consent before a sealed app's data leaves the device** (`packages/shell/src/sync-consent.ts`).
Sync changes what sealed code can do: anything it writes goes into a document other people receive,
so a shared app is a way out for data as surely as the network is. The shell asks once per app before
a sealed app's store is opened synced; your own apps are not asked. The manifest's `sync: true` only
changes the words of the question.

**Promotion is always reachable** (`packages/shell/src/promotion.ts`): from a sealed app's badge, its
custom screen, the screen that says it could not open, the card after it was added, its tile and the
Studio. Every one opens the same dialog with the same warning, and only acts when the person
confirms. A failure that promotion would not fix, such as a module that does not match its lock, is
never offered promotion as the way out.

**The limits**, plainly. A Worker's memory is not capped. Nested Workers from `blob:` are allowed by
the CSP and end with the frame. On every engine but desktop Chromium a view's frame shares the
shell's thread, which is why the crash-loop guard exists. On the web, code on this origin can still
ask the vault's key to decrypt the identity's secret; the vault removes the secret from the clear,
not the origin's power over it. The WebRTC deny-list is a list, re-checked on each engine release.
The audit notes in docs/22 §10.5 and §11.5 name every new surface.

<details><summary>Where in the code</summary>

- `packages/host/src/realm/realm-host.ts` — the host half; `packages/host/src/realm/frame.ts` — the sandboxed frame and its CSP; `packages/host/src/realm/worker-runtime.ts` — inside the Worker; `packages/host/src/realm/ctx-proxy.ts`, `packages/host/src/realm/protocol.ts` — the ops
- `packages/host/src/realm/sealed-view.ts`, `packages/host/src/realm/view-runtime.ts`, `packages/host/src/realm/view-watchdog.ts`, `packages/host/src/realm/view-guard.ts` — sealed views
- `packages/host/src/mediate.ts`, `packages/host/src/values-gate.ts`, `packages/host/src/authorship.ts` — what every box enforces
- `packages/host/src/isolate/` — the QuickJS fallback; `packages/shell/src/sandbox-runner.ts` — which box
- `packages/store/src/app-lock.ts`, `packages/store/src/carried-code.ts`, `packages/shell/src/package-modules.ts`, `packages/shell/src/library-fetch.ts`, `packages/shell/src/open-libraries.ts` — the code beyond the entry file
- `packages/shell/src/sync-consent.ts`, `packages/shell/src/promotion.ts`, `packages/shell/src/trust-dialog.tsx`, `packages/shell/src/trusted-loader.ts` — consent and promotion
- Deep docs: docs/07, docs/22

</details>

## Sharing

"Share" means three different things in Potyro, and the share sheet says them plainly:

| What you share | What the other person gets | Mechanism |
|---|---|---|
| **A link anyone can try** | the app, running, with sample records; nothing of yours | a demo link: a sealed package through the share service, the key in the fragment |
| **Use it together** | the app and its records, live, with you | an invite into a synced space; the app's source rides in the space |
| **A live session** | a room other members' messages flow through, now | the rooms relay |

A fourth path runs the other way: text shared into Potyro from another app.

### Using an app together

An invite link carries only the **space coordinates** in its fragment, about 200 bytes
(`packages/shell/src/share-sync.ts`). It used to carry the app's source too, and dropping it bought
two things: deep links on native, where Android App Links and iOS Universal Links get unreliable
past a few kilobytes; and updates from the moment of joining, because the guest reads the same
published source everyone else is reading instead of a snapshot frozen at share time. The fragment
never reaches a server, which is what keeps the invite secret off the relay.

The source rides in the space's `kv`, which is already a CoMap in the shared root, so it replicates
through the same channel as the data (`packages/shell/src/app-sync.ts`). Each copy publishes only
when its own source is strictly newer, by timestamp, so a guest who declines an update does not push
their older source back over the author's. Accepting an update is never silent: it replaces code that
runs on this device, so it is a prompt, and the new version lands in History where it can be rolled
back like any other edit. A guest's copy is still untrusted code. Being invited to someone's data
says nothing about whether their code should run with ambient authority.

### A link anyone can try

Every shared link is a working demo (docs/24). The link carries a demo package: an ordinary
`potyro-app/1` zip with the source, the app's own modules and its lock, the files it ships with, and
demo records, which are the app's own sample data or the seed its package came with, never the
person's records. Building it opens the person's store only to copy files the app shipped with.

```mermaid
flowchart LR
  dev[the sharer's device] -- "ciphertext (AES-GCM, fresh key per link)<br/>+ title and preview image" --> svc[share service<br/>packages/share-links]
  dev -- "https://site/s/&lt;id&gt;#k=&lt;key&gt;" --> chat[a chat]
  chat --> viewer[the viewer's device]
  svc -- ciphertext --> viewer
  viewer -- "decrypts with the key from the fragment,<br/>installs sealed with its demo records" --> app[the app, running]
```

The service holds ciphertext it cannot read, beside the two things a link preview needs and that the
sharer made public on purpose: a title and a preview image drawn from the demo records. It can show
what a link is called, never what the app is or holds. Where the service is not there, the device
makes an inline link with the whole package in the fragment, which works on any static site and
shows no preview.

From a demo, **Make it mine** copies the app as a new app of the person's own, through the ordinary
Add-an-app card, with `credit` in the manifest naming who made it and what it is a remix of, as a
short chain. A link can also open an app at one of its pages with parameters
(`packages/shell/src/app-link.ts`): the app is named by its **line**, which every copy of an app
carries, so a link made on one device opens the right copy on another; a line is a matching hint,
never a credential, and what a link can do is small on purpose. Share links count on the device
only, as local counters with no id, no app name and no network.

### Rooms

A room is a live session on the rooms relay (`packages/rooms`, docs/26): every frame a member sends
goes as-is to every other member, plus a small presence envelope for joins and leaves. The relay
keeps nothing, so a member who joins late gets the member list and not the history; the members
already there send the state. It has no accounts: the room id is the only capability, to be treated
like a link to a shared document. It reads and logs no payload, and an app that needs the relay
unable to read its messages encrypts them with a key carried in the share link's fragment. App code
reaches a room through `ctx.caps.network.room`.

### Text shared into Potyro

When another app shares text into Potyro, what another AI wrote for instance, it is kept for the
session and offered on a page that asks which app to bring it into
(`packages/shell/src/share-inbox.ts`). Which app fits best is judged on the device with no model,
by the shared text's words against each app's own words read from its source; the person picks
either way. The chosen app's Ask opens with the text filled in. The other direction, "send this" to
a chat, opens the chat's own address only on the person's tap (`packages/shell/src/share-networks.ts`).

<details><summary>Where in the code</summary>

- `packages/shell/src/share-sheet.tsx` — the sheet; `packages/shell/src/share-page.tsx` — the page a link opens
- `packages/shell/src/share-sync.ts`, `packages/shell/src/app-sync.ts` — invites and the published source
- `packages/shell/src/demo-share.ts`, `packages/shell/src/demo-package.ts`, `packages/shell/src/share-service.ts`, `packages/shell/src/preview-card.ts` — demo links; `packages/share-links/src` — the service
- `packages/shell/src/remix.tsx`, `packages/shell/src/app-link.ts`, `packages/shell/src/share-events.ts` — Make it mine, page links, counting
- `packages/rooms/src` — the rooms relay
- `packages/shell/src/share-inbox.ts`, `packages/shell/src/share-networks.ts` — text in, send this
- Deep docs: docs/24, docs/26, docs/28

</details>
