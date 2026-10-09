# Potyro

**Potyro is an offline-first runtime that loads a TypeScript app module and runs it as a
working, native-capable personal app.**

You write (or have an LLM write) a `*.app.ts` module: it declares your data **shape**
(entities, fields) as plain data, and everything that is **logic** — computed values,
filters, actions, reminders, even whole custom views — as ordinary TypeScript functions.
Full language. Real imports, loops, conditionals, types, debugging. A single runtime shell
loads that module and renders a usable app with local persistence, camera, notifications,
geolocation. No per-app build. No cloud. No visual builder. No little DSL to hit the wall of.

## The core decision

Logic is JavaScript/TypeScript — not a restricted expression language. Every "safe little
DSL" eventually reinvents variables, conditionals, loops and a bad module system; you end up
rebuilding JS badly and still hitting walls. Potyro refuses that. **The language is
unrestricted. What Potyro controls is the *capability surface* handed to your code (`ctx`) and
the *execution boundary* it runs in — two things that are independent of the language.**

- **Structure stays declarative** (entities/fields/view layout are data — this gives you
  storage, forms, validation and migrations for free; it is a schema, not a DSL).
- **Logic is full code** (computed/filter/action/reminder/custom-view are functions that
  receive `ctx`, the host API surface — full control means a rich `ctx`, not a permissive
  parser).

## Power and safety are different axes

The only property worth protecting is: *I can open an app someone sent me without it wrecking
my machine.* That is **not** a language restriction — it's an execution choice, made per app
by **provenance**:

- **Your own apps → direct execution.** Full host context, real imports, native modules,
  network, filesystem. Zero sandbox, zero ceremony. This is the daily driver and the "I just
  want to write code" path, first-class.
- **Received/shared apps → isolated execution.** The *same source* runs in a QuickJS-WASM
  isolate whose `ctx.caps` are denied-by-default and granted per user consent (like installing
  an extension). Same language, same functions — only the injected authority differs.

Same code, two authority levels. The language is never the thing that's limited.

## Non-negotiable invariants

1. **Logic is real TS; structure is declarative data.** Don't reintroduce an expression DSL.
2. **`ctx` is the whole API surface.** All host power (data, time, caps, storage, ui, nav)
   reaches app code through `ctx`. Enriching the system = enriching `ctx`.
3. **Execution boundary is chosen by provenance, not by the app.** Trusted → direct;
   untrusted → QuickJS-WASM isolate with mediated caps + a permission prompt.
4. **Offline-first, including authoring.** Runtime and authoring work with no network. A
   server is optional (sync, web push) and clearly separated.
5. **One codebase, two targets.** PWA and Capacitor share the runtime; native is additive.
6. **Everything behind a seam.** `Store` (persistence) and `Capabilities` (native) are
   interfaces; they *are* what `ctx` exposes. Swapping SQLite→CRDT or web→native never touches
   app code or views.

## Repository map

```
README.md                     ← you are here
CLAUDE.md                     ← conventions + multi-agent working agreement
docs/
  01-vision-and-scope.md
  02-architecture.md
  03-definition-model.md      ← the app module: defineApp(), declarative schema + code logic
  04-app-module-api.md        ← THE ctx surface + function signatures (the real API)
  05-runtime-interfaces.md    ← Store, Capabilities, loader/trust, view contracts (TS)
  06-persistence-and-migrations.md
  07-execution-and-targets.md ← trust/provenance, QuickJS-WASM isolate, web vs Capacitor
  08-roadmap-and-workpackages.md
  09-testing.md
examples/
  recipes.app.ts              ← relations, computed macros, JS filters, custom cook-along view
  plants.app.ts               ← datetime logic, seasonal computed, reminders (functions)
  places.app.ts               ← geo, map view, JS "open now"/distance filters
```

## Recommended first vertical slice

Runtime core, then **recipes** end-to-end (most of the model at once). Then **plants** to
prove reminders on the native target. See `docs/08`.

## Tech baseline

- **TypeScript (strict)** everywhere; app modules are `.app.ts`. Runtime UI: **React** (Vite).
- App logic runs as real functions; **trusted apps run directly, untrusted in QuickJS-WASM**.
- Local DB: **SQLite WASM (OPFS) + JSON1** behind the `Store` interface (TinyBase acceptable).
- Filtering/sorting is **JS predicates over fetched rows** at personal scale (no query DSL,
  no pushdown planner) — with optional declarative fast-paths later for indexable fields.
- PWA target first; **Capacitor** second. Future CRDT sync = a new `Store` impl (not in scope).

## Testing

- **Unit / integration:** `pnpm -r test` (Vitest, per package).
- **End-to-end (M1 smoke, issue #15):** `pnpm e2e` runs Playwright against the recipes app in a
  real browser — the **trusted** path (`pnpm dev`: list, custom cook-along view, computed macros,
  add-a-recipe, "ingredients I have" JS filter, persistence across reload) and the **sandbox**
  path (`pnpm dev:sandbox`: the examples seeded untrusted, run in the QuickJS-WASM isolate). Playwright starts
  both Vite dev servers itself. Requires **Node 20+** (Playwright constraint); install browsers
  once with `pnpm exec playwright install chromium`.
