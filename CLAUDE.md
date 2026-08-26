# CLAUDE.md — working agreement for Claude Code agents

Read automatically by Claude Code. Defines how agents work here so parallel agents don't
collide and the architecture stays honest.

## Mental model (one paragraph)

A Karta app is a **TypeScript module** (`*.app.ts`) that default-exports `defineApp({...})`.
It declares data **shape** (entities/fields/view layout) as plain data, and all **logic**
(computed, filters, actions, reminders, custom views) as ordinary functions that receive
**`ctx`** — the host API surface (data, time, capabilities, storage, ui, navigation). A
**runtime core** loads the module, resolves records via a **Store**, runs the app's functions,
and renders views. The module runs **directly** when it's the user's own app, or inside a
**QuickJS-WASM isolate** with mediated `ctx.caps` when it's an untrusted/shared app. Two build
targets (PWA, Capacitor) share one codebase.

## Hard rules (they are the project's reason to exist)

1. **No expression DSL.** Logic is real TS functions. If you find yourself designing a
   mini-language for filters/formulas, stop — it's a function receiving `ctx`.
2. **`ctx` is the only way app code reaches host power.** Never let app functions import host
   internals directly; they get `ctx`. Growing the system means growing `ctx` (docs/04).
3. **Provenance decides execution, not the app.** Trusted (user's own) → direct; untrusted
   (imported/shared) → QuickJS-WASM isolate with denied-by-default caps + permission prompt.
   Never run untrusted app code with ambient authority.
4. **Structure is declarative and validated; logic is typed, not validated.** `packages/schema`
   validates the *data* parts (entities/fields/view layout) with Zod. Functions are typed by
   TS; do not try to "validate" arbitrary code — sandbox it instead.
5. **Respect the seams.** Views talk to the runtime API only. Runtime depends on `Store` /
   `Capabilities` *interfaces*, never concrete impls. `Store` + `Capabilities` are exactly what
   `ctx` surfaces. Target-specific code lives only in target packages.
6. **Offline-first.** Nothing in runtime/host/store may require network. Network reaches app
   code only via `ctx.caps.network`, which is capability-gated.
7. **TypeScript strict**, no `any` in interfaces.

## Monorepo layout (target)

```
packages/
  schema/         WP1 — defineApp() typed builder; Zod validation of the declarative parts
  host/           WP2 — module loader, transpile/bundle, QuickJS-WASM isolate runner,
                        ctx construction + capability mediation, provenance/trust
  store/          WP3 — Store interface + SqliteStore + MemoryStore + migrations
  capabilities/   WP4 — Capabilities interface + web impls (camera/notif/geo/fs/network)
  runtime/        WP5 — record model, relation resolution, computed runner, action runner,
                        reminder reconciler, JS-predicate query, ctx wiring
  views/          WP6 — view registry + built-in views + custom-view host
  shell/          WP7 — app switcher, nav, import/export, trust prompts, PWA build
  native/         WP8 — Capacitor target + native capability impls
examples/         WP9 — recipes / plants / places (.app.ts) — living fixtures
```

pnpm workspaces + Vite + Vitest. Package = agent boundary; depend on published interfaces.

## Dependency order

```
schema (WP1) ─┬─> host (WP2) ─┐
              ├─> store (WP3) ─┼─> runtime (WP5) ─> views (WP6) ─> shell (WP7) ─> native (WP8)
capabilities (WP4, parallel) ─┘
examples (WP9): start on WP1 immediately, evolve as fixtures.
```

WP1 is the gate. `host` (WP2) is the other central package — it owns execution + trust and is
new relative to earlier drafts (it replaces the old expression evaluator entirely).

## Multi-agent protocol

- One package, one owner at a time. Cross-package interface changes: update `docs/05` + types +
  every consumer stub in the same PR.
- Stub, don't block: code against interfaces with `MemoryStore` / `FakeCapabilities` /
  `DirectHost` fakes; mark `// STUB`.
- Small PRs, conventional commits. Any change to `defineApp`'s shape or `ctx` bumps
  `schemaVersion` and is noted for other agents.

## Commands (fill in as scaffolding lands)

```
pnpm i
pnpm -r build
pnpm -r test
pnpm --filter host test
pnpm dev            # shell loads examples/*.app.ts (trusted, direct) in the browser
pnpm dev:sandbox    # loads an example as UNTRUSTED to exercise the isolate + prompts
pnpm e2e            # browser suite, ONE worker (shared OPFS/relay — see playwright.config.ts)
pnpm conformance    # web vs native capability parity (docs/09)
pnpm lint:boundaries

# does changing an app that holds records keep the records? (docs/12 §8)
pnpm --filter @karta/generator eval:modify:fixture   # no model, no money — sample review sheet
pnpm --filter @karta/generator eval:modify -- --only todo-groups --max-calls 5 --max-cost 6
```

**On Windows** call `pnpm.cmd`: PowerShell blocks `pnpm.ps1` under the default execution policy and
a spawned process will not find a bare `pnpm`. Never change the execution policy to make a command
work — fix the caller.

**Never start a paid eval run without being asked to.** `eval:modify` spends real money per call.

## M1 definition-of-done

`pnpm dev` loads `examples/recipes.app.ts` and you can: browse recipes (list + detail), open
the **custom cook-along view** and tick steps, see **computed** calories/macros (real
functions), add a recipe, filter by "ingredients I have" (a **JS predicate**), all offline and
persisted. No native features required yet. Separately, `pnpm dev:sandbox` loads the same app
in the QuickJS-WASM isolate and it still works with mediated caps.

## When in doubt

Prefer giving app code more power through a cleaner `ctx`, not less power through restriction.
The safety story is the isolate + provenance, never a crippled language. Ask: "is host power
reaching app code through `ctx`, and is untrusted code in the isolate?" If yes, you're aligned.
