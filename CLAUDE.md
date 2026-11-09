# CLAUDE.md — working agreement for coding agents

Read automatically by Claude Code. It says what Potyro is, which page to read before a kind of
change, how the packages fit, and the rules that keep parallel agents from colliding. Depth is in
`docs/00-how-potyro-works.md` (the architecture, layer by layer); where code lives is in
`docs/32-code-map.md` (by concern, with the entry points); recipes for the recurring tasks are the
skills under `.claude/skills/`. To write an app as a package to install, not a change to Potyro,
read `AGENTS.md` instead.

## Mental model (one paragraph)

A Potyro app is a **TypeScript module** (`*.app.ts` / `*.app.tsx`) that default-exports
`defineApp({...})`. It declares data **shape** (entities, fields, pages, view layout) as plain data,
and all **logic** (computed, filters, actions, reminders, custom views) as ordinary functions that
receive **`ctx`** — the host API surface (data, time, capabilities, files, text, ui, navigation). A
**runtime** loads the module, resolves records through a **Store**, runs the app's functions and
renders views. Records live on the device in SQLite (a storage Worker over OPFS); an app that is
shared or synced keeps them in **cojson** (the Jazz CRDT) instead — one space per app, a group per
record shared on its own — through Potyro's own relay. The module runs **directly** when it is the
person's own app; an imported or shared app runs **sealed**: its logic in a Worker inside an
opaque-origin sandboxed iframe, its custom views each in a frame of their own, host power only
through the same `ctx` over MessagePorts. Two build targets (PWA, Capacitor) share one codebase.

## Hard rules (they are the project's reason to exist)

1. **No expression DSL.** Logic is real TS functions. If you find yourself designing a
   mini-language for filters or formulas, stop — it is a function receiving `ctx`.
2. **`ctx` is the only way app code reaches host power.** App functions never import host
   internals; they get `ctx`. Growing the system means growing `ctx` (docs/04).
3. **Provenance decides execution, not the app.** Trusted (the person's own) → direct. Untrusted
   (imported, shared, a demo) → the browser realm: an opaque-origin sandboxed iframe with a strict
   CSP, logic in its Worker, custom views each in a sandboxed frame, host power only through the
   mediated `ctx` over MessagePorts, denied-by-default caps, a permission prompt and a watchdog.
   Never run untrusted app code with ambient authority, and never in the shell's own realm. (The
   QuickJS-WASM isolate is the fallback behind a flag; the shell is served with `frame-src 'none'`.)
4. **Structure is declarative and validated; logic is typed, not validated.** `packages/schema`
   validates the data parts with Zod. Functions are typed by TS; never "validate" code — sandbox it.
5. **Respect the seams.** Views talk to the runtime API only. Runtime depends on the `Store` and
   `Capabilities` interfaces, never on an implementation. `Store` + `Capabilities` are exactly what
   `ctx` surfaces. Target-specific code lives only in target packages. `pnpm lint:boundaries` checks.
6. **Offline-first.** Nothing in runtime, host or store may require the network. Network reaches
   app code only through `ctx.caps.network`, which is capability-gated.
7. **One engine for sync and collaboration: cojson.** Anything shared, synced, "together", live or
   collaborative is a Store feature on the existing CRDT (spaces, groups, `RawCoPlainText` for text),
   reached by apps through `ctx`. Never add another CRDT or sync library, in an app or a package.
8. **TypeScript strict**, no `any` in interfaces. Potyro's own words go through the i18n catalogs.

## Before you build: what to read

| The change | Read first |
|---|---|
| Anything shared, synced, live, collaborative | docs/00 §Sync, CRDT and identity; docs/adr/0001-sync-engine-and-identity.md; docs/24 §12 (a record on its own); docs/04 §Writing together |
| A new app in `apps/` or `examples/` | skill `new-app`; docs/03; docs/04; one neighbour app's files |
| A new `ctx` member or capability | skill `ctx-member`; docs/04; docs/05; the reference budget (below) |
| A new `Store` method | docs/05 §Store; `packages/store/src/types.ts`; every forwarder and copy site (docs/32 §Storage) |
| A screen, a view, the shell's chrome | docs/05 §View contract; `packages/design/README.md`; i18n (below) |
| Share links, demos, the viewer, the gallery | docs/24 |
| Sealed execution, trust, security | docs/07; docs/22; docs/31 |
| AI in apps, Ask, the Studio | docs/23; docs/00 §The Studio and the generator |
| Translations of an app's words | docs/30 |
| Android, iOS | docs/13; docs/27 |
| Tests, the gate, shipping, deploying | skill `ship-pr`; `CONTRIBUTING.md` §The gate; docs/16 to self-host |

## The packages

A pnpm workspace; a package is a seam and an agent boundary. In dependency order, lowest first —
the full table with what each depends on is docs/00 §The package map.

- `packages/schema` (npm `potyro`): `defineApp`, the `ctx` types, Zod validation, `potyro pack`
- `packages/design`: the designer's tokens, fonts, logo, colour clock, the Lucide icon table
- `packages/i18n`: Potyro's own words — locale matching, Lingui catalogs, Intl helpers
- `packages/identity`: who you are on this device — account seed, recovery words, the vault
- `packages/capabilities`: the `Capabilities` interface, the web implementation, fakes, conformance
- `packages/store`: the `Store` interface; Memory, Local, Sqlite and Jazz stores; migrations, export, packages, files
- `packages/rooms`: the rooms relay for multiplayer apps and its wire protocol (a server)
- `packages/host`: loading and running an app — the direct runner, the browser realm, the QuickJS fallback, `ctx` construction, capability mediation
- `packages/runtime`: the record model, relations, computed and action runners, reminders, queries, React hooks
- `packages/views`: the view registry, the built-in views, the host for custom views
- `packages/generator`: model backends, the prompt and its generated reference, the corpus, the create/modify/fix loops, Ask, the evals
- `packages/native`: the Capacitor target — native capabilities and the native vault
- `packages/share-links`, `packages/ai-relay`, `packages/platform-requests`: servers (demo links, the free AI allowance, "Potyro lacks this" requests); they depend on no Potyro package
- `packages/shell`: the product — launcher, navigation, panels, Studio, trust, import/export, sharing, the composition root (`main.tsx`), the PWA build
- `packages/create-potyro`: `npm create potyro <dir>`
- `packages/legal`: the privacy and terms pages, built from `docs/legal/`
- `apps/`: twenty-one real apps, each an installable package, the gallery's content; `examples/`:
  the six living fixtures the tests and tutorials use; `e2e/`: the browser suite; `gallery/`: the
  public gallery site; `scripts/`: the gate, the watcher, shipping, the checks; `deploy/`: the servers

## Working here

- **Worktree, never the main checkout.** Any file may hold someone's unstaged work; never
  `checkout`/`restore`/`reset --hard`/`stash`/`clean` there.
- **One package, one owner at a time.** A cross-package interface change updates docs/05, the types
  and every consumer in the same PR. Stub against `MemoryStore` / `FakeCapabilities`, mark `// STUB`.
- **Contract changes** (`defineApp`'s shape, a `ctx` member): docs/04 and docs/05 in the same PR.
  `schemaVersion` is an app's DATA version — an additive, optional change never bumps it.
- **Parallel sessions.** Before fixing main or a flaky spec, `gh pr list` — someone may have the
  same fix open. Name the branch after the issue or the change; small PRs, conventional commits.
- **Generated files travel with the change** — the test that fails while they are stale is listed:

| After changing | Run | Or this fails |
|---|---|---|
| `packages/schema/src/types/*` | `pnpm --filter @potyro/generator gen:reference` | generator `test/reference.test.ts` |
| `examples/`, `apps/`, docs/04, docs/05, the schema types — and **any merge of two such branches** | `pnpm --filter @potyro/generator gen:corpus` | generator `test/corpus.test.ts` |
| user-facing text in shell or views (`t`…`` / `<Trans>`) | `pnpm i18n:extract`, then translate the new ids in the five catalogs | i18n `test/catalog.test.ts`; `pnpm lint:i18n` |
| a doc's frontmatter, a path a doc or this file names | `pnpm docs:index` | `pnpm lint:docs` |
| `lucide` + `lucide-react` (same version) | `pnpm --filter @potyro/design gen:lucide` | design `test/lucide.test.ts` |

The model-facing reference has a hard budget: a new capability goes into `CAPABILITIES` in
`packages/generator/src/reference.ts` (read on demand), never into the core by raising the budget.

## Commands

```
pnpm i && pnpm -r build && pnpm -r test     # Node 22 (store tests and Playwright fail on 18)
pnpm --filter @potyro/host test             # one package
pnpm dev                                    # the shell, examples seeded as your own apps
pnpm dev:sandbox                            # the same, examples seeded sealed (the realm, the prompts)
pnpm e2e e2e/<spec>.spec.ts                 # one browser spec; the whole suite = pnpm e2e, ONE worker
pnpm test:e2e:firefox                       # Firefox; engine differences go in e2e/engines.ts
pnpm ci:local all --post                    # THE GATE before a merge: run it on the CI machine (vazio),
                                            # never on a laptop (slow, flaky under load); --post marks GitHub
node scripts/ci-select.mjs                  # which specs a change touches
pnpm lint:boundaries && pnpm lint:i18n && pnpm lint:docs
```

There is no CI on GitHub (off since 2026-10-25; never turn a workflow on without the owner). Ship =
rebase on main, the gate green on that head, merge with a merge commit; the watcher on vazio tests
main and deploys potyro.app. The order of work: skill `ship-pr` (the owner's own operations notes
are private, not in docs/).
**Never start a paid eval run** (`eval:modify`, `eval:ask`) without being asked: real money per call.
On Windows call `pnpm.cmd`; never change the execution policy.

## Traps that cost agents hours

- A new optional `Store` method must be forwarded by `packages/shell/src/read-only-store.ts` and
  known to the copy and describe sites, or the host silently falls back (docs/32 §Storage).
- Browser specs on a laptop may hit another checkout's dev server on the same port and test that
  one; the console guard fails a spec on any unexpected console error — fix the cause, do not allow it.
- A React hook after an early return passes typecheck and fails every spec that renders the view.
- Two branches that each regenerated the corpus merge clean and leave main red: regenerate on main.
- An empty built-in list page renders no `.k-list`; a sealed app's screens are in
  `.k-sealed-view iframe` frames, its sheets on the shell's page.
- The dialog host shows ONE dialog: anything that asks must run before `dialogs.send`.
- `localStorage` keys are per app (`potyro:<kind>:user:<id>`); deleting an app erases them and its
  database (`packages/shell/src/erase-app-data.ts`) — add any new per-app key there.
- Seed dates move with the calendar: assert on full-list pages, never on Today or due lists.
- Issue numbers in docs refer to the original repository; the public one re-numbers them.

## When in doubt

Prefer giving app code more power through a cleaner `ctx`, not less power through restriction. The
safety story is the sealed realm plus provenance, never a crippled language. Ask: "is host power
reaching app code through `ctx`, and is untrusted code in the realm, never the shell's own?" If
yes, you are aligned. If a request needs a mechanism the platform lacks, build the mechanism on
the platform's engine — not a flag, not a library inside one app.
