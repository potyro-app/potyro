---
title: Tests
description: The test layers, their commands, what must stay green before a merge, and the generated files with tests guarding them.
section: contributing
order: 2
---

# Tests

Potyro is tested in layers: unit tests in every package, a browser suite, a conformance suite for
the capability targets, and four lints. This page names each layer, its command and what it proves.

```sh
pnpm -r test                        # unit tests, every package
pnpm --filter @potyro/host test     # one package
pnpm typecheck
pnpm lint:boundaries && pnpm lint:tokens && pnpm lint:i18n && pnpm lint:docs
pnpm e2e                            # the browser suite, one worker
pnpm conformance                    # web and native capabilities against one spec
```

## Unit tests

Every package has a `test/` folder run by Vitest. `pnpm -r test` runs them all;
`pnpm --filter @potyro/<name> test` runs one package. Pure logic lives here: the validator, the
query planner, migration steps, Store methods against `MemoryStore`, the view bindings.

Two packages carry more than their own logic:

- **host** runs the untrusted contract against both sealed runners, the browser realm and the
  QuickJS fallback, through `packages/host/test/runners.ts`. An ungranted capability is absent, a
  granted one is the scoped wrapper, a runaway app is aborted, values round-trip.
- **runtime** loads every `examples/*.app.ts` and runs representative queries and actions against
  `MemoryStore` and `FakeCapabilities`.

Two-node store tests use `packages/store/src/peer-harness.ts`.

## The browser suite

Specs live in `e2e/` and run with Playwright. The file name picks the project: `*-trusted.spec.ts`
runs the examples as your own apps, `*-sandbox.spec.ts` runs them sealed in the realm.

```sh
pnpm exec playwright install chromium                          # once
pnpm e2e                                                       # everything
pnpm exec playwright test e2e/add-app-trusted.spec.ts --workers=1   # one spec
pnpm test:e2e:firefox                                          # the same specs in Firefox
node scripts/ci-select.mjs                                     # which specs a change touches
```

The suite runs one worker on purpose. Every spec drives the same origin, the store is OPFS and the
sync specs share one relay, so parallel workers are parallel clients of one state. Playwright
starts the servers it needs. If a dev server from another checkout is already on the same port,
Playwright reuses it and tests that checkout. Stop it first.

Every spec imports `test` and `expect` from `e2e/console-guard.ts`. A spec that leaves an
unexpected `console.error` or an uncaught page error fails, even if its assertions passed. Fix the
cause; `consoleGuard.allow(/pattern/, "why")` is for an error the test provokes on purpose.

Engine differences between Chromium and Firefox are declared once, in `e2e/engines.ts`, never as
a weaker assertion. Containment is a browser property, so it is proved in the browser:
`e2e/realm-escape-sandbox.spec.ts` runs an adversarial app sealed and checks that it reaches
nothing.

## Conformance

`pnpm conformance` runs one behavioural spec, `packages/capabilities/src/conformance.ts`, against
`WebCapabilities` and against `CapacitorCapabilities` over a mocked bridge. A target declares what it
legitimately lacks, and the difference is asserted rather than hidden. A capability that works in
the browser and quietly does nothing on a phone would otherwise never fail a test.

## The lints

| Command | What it checks |
|---|---|
| `pnpm lint:boundaries` | the seams: views import no store, host or capabilities; servers import no Potyro package; app modules import only `potyro`; browser specs take `test` from the console guard |
| `pnpm lint:tokens` | `packages/shell/src/styles.css` uses the design tokens, not raw values |
| `pnpm lint:i18n` | no raw user-facing text in `packages/shell` or `packages/views`; everything goes through `` t`…` `` or `<Trans>` |
| `pnpm lint:docs` | every repository path a doc names exists, and the docs index is current |

## What stays green before a merge

```sh
pnpm ci:local all        # the gate, on the commit to be merged
pnpm ci:local status     # what is left of an interrupted run
```

The gate installs, builds, runs every unit test, the typecheck, the lints and the whole browser
suite as parallel shards. It refuses uncommitted changes, so a result always describes a commit, and
it records each step so an interrupted run resumes. It must pass on the commit that is merged. On a
small machine, run the unit tests, the typecheck and the specs `scripts/ci-select.mjs` names for your
change, and run `all` before the merge.

Five invariants are encoded as tests and must never be weakened:

1. A sealed app cannot reach the network, the filesystem, the shell's globals or another app's
   store; ungranted capabilities are absent; limits abort a runaway.
2. Every example typechecks and validates.
3. Migrations are deterministic, and export followed by import loses nothing.
4. Runtime, store and web capabilities work with the network disabled.
5. The seams hold: `pnpm lint:boundaries` passes.

The example apps are living fixtures. A change that breaks one is a regression, not a fixture to fix.

## Generated files

Some files are generated from others, and a test fails while they are stale. Regenerate in the same
change.

| After changing | Run | Guarded by |
|---|---|---|
| `packages/schema/src/types/*` | `pnpm --filter @potyro/generator gen:reference` | `packages/generator/test/reference.test.ts` |
| `examples/`, `apps/`, the schema types, the API notes | `pnpm --filter @potyro/generator gen:corpus` | `packages/generator/test/corpus.test.ts` |
| user-facing text in shell or views | `pnpm i18n:extract`, then translate the new entries in every catalog under `packages/i18n/locales/` | `packages/i18n/test/catalog.test.ts`, `pnpm lint:i18n` |
| a doc's frontmatter, or a path a doc names | `pnpm docs:index` | `pnpm lint:docs` |
| `lucide` and `lucide-react` (same version) | `pnpm --filter @potyro/design gen:lucide` | `packages/design/test/lucide.test.ts` |

The model-facing reference has a hard size budget. A new capability goes into `CAPABILITIES` in
`packages/generator/src/reference.ts`, read on demand, never into the core by raising the budget.
Two branches that each regenerated the corpus merge cleanly and leave `main` stale: regenerate on
`main` after such a merge.

## Paid runs

The `eval:*` scripts in `packages/generator` call a model and cost money per call. Unit tests never
call a model. Do not start an eval without being asked.

## Next

- [Running the repository](running-the-repository.md): install, build and the dev servers.
- [Code map](code-map.md): the files behind each layer named here.
