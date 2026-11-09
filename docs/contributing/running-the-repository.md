---
title: Running the repository
description: Prerequisites, install, build, the dev servers, the packages and the seams between them.
section: contributing
order: 1
---

# Running the repository

This page gets Potyro's own source running on your machine and shows how the repository is laid
out. It is for someone changing Potyro, not for someone writing an app.

```sh
git clone https://github.com/potyro-app/potyro
cd potyro
pnpm i
pnpm -r build
pnpm dev             # http://localhost:5173
```

## Prerequisites

- **Node 22.** Some store tests fail on 18, and Playwright needs 20 or later.
- **pnpm**, at the version named by `packageManager` in the root `package.json`. `corepack enable`
  installs it.

On Windows, call `pnpm.cmd`. PowerShell blocks `pnpm.ps1` under its default policy, and a spawned
process does not find a bare `pnpm`. Do not change the policy; call the `.cmd` shim.

## Install and build

```sh
pnpm i               # every workspace package
pnpm -r build        # every package, in dependency order
pnpm typecheck       # every package
```

The workspace is defined in `pnpm-workspace.yaml`: `packages/*`, `examples`, `apps/*`, `gallery`,
`site` and `docs/tutorials/code`.

## The dev servers

```sh
pnpm dev                    # the shell and a local sync relay
pnpm dev:sandbox            # the shell alone; the examples seeded sealed
pnpm dev:sandbox:quickjs    # the same, sealed apps in the QuickJS fallback
pnpm relay                  # the sync relay alone, on port 4201
```

`pnpm dev` runs Vite for the shell and `jazz-run sync` as the relay, side by side. Opening the shell
shows the launcher with the six example apps seeded as your own, trusted apps. `pnpm dev:sandbox`
seeds the same apps as shared apps: their logic runs in the browser realm with mediated
capabilities, and the trust dialog and permission prompts appear. The shell reloads on every edit
to a package it imports.

## The packages

| Package | What it is |
|---|---|
| `packages/schema` (npm `potyro`) | `defineApp`, the `ctx` types, Zod validation of the declarative parts, the `potyro pack` CLI |
| `packages/design` | the design tokens, fonts, logo, colour clock and the Lucide icon table |
| `packages/i18n` | Potyro's own words: locale matching, Lingui catalogs, Intl helpers |
| `packages/identity` | who you are on this device: account seed, recovery words, the secret vault |
| `packages/capabilities` | the `Capabilities` interface, the web implementation, fakes, the conformance suite |
| `packages/store` | the `Store` interface; `MemoryStore`, `LocalStore`, `SqliteStore`, `JazzStore`; migrations, export, packages, files |
| `packages/rooms` | the rooms relay for multiplayer apps and its wire protocol (a server) |
| `packages/host` | loading and running an app: the direct runner, the browser realm, the QuickJS fallback, `ctx` construction, capability mediation |
| `packages/runtime` | the record model, relations, computed and action runners, reminders, queries, React hooks |
| `packages/views` | the view registry, the built-in views, the host for custom views |
| `packages/generator` | model backends, the prompt and its generated reference, the corpus, the create, modify and fix loops, Ask, the evals |
| `packages/native` | the Capacitor target: native capability implementations and the native vault |
| `packages/share-links` | the share service for demo links (a server) |
| `packages/ai-relay` | the relay behind the free AI allowance (a server) |
| `packages/platform-requests` | the relay that files "Potyro lacks this" requests (a server) |
| `packages/shell` | the product: launcher, navigation, panels, the Studio, trust, import and export, sharing, the composition root, the PWA build |
| `packages/create-potyro` | `npm create potyro <dir>`: the starter project for an app |
| `packages/legal` | the privacy and terms pages, built from `docs/legal/` |

## Dependency order

Lowest first: `schema`, `design`, `i18n`, `identity` and the four servers depend on nothing;
`capabilities` and `store` depend on `schema`; `host` on those three; `runtime` on `host`; `views`
and `generator` on `runtime`; `native` on `capabilities`; `shell` on everything above it.

## The seams

Four rules keep the packages apart. `pnpm lint:boundaries` checks them where a regex can.

- Views talk to the runtime API only. They never import the store, the host or the capabilities.
- The runtime depends on the `Store` and `Capabilities` interfaces, never on an implementation. The
  implementations are chosen once, in the shell's composition root, `packages/shell/src/main.tsx`.
- App code reaches host power only through `ctx`. An app module imports `potyro` and nothing else
  from the repository.
- Target-specific code lives in target packages. The servers depend on no Potyro package; what
  uses them imports only their browser-safe wire formats.

## Where the apps are

- `examples/*.app.ts(x)`: the six living fixtures (recipes, plants, places, groceries, split,
  workout). The tests and tutorials are written against them; their shipped files are in
  `examples/files/`.
- `apps/<id>/`: real apps, each built as an installable package with `scripts/pack-app.mjs`. They
  fill the gallery and the Studio's corpus.
- `docs/tutorials/code/`: the tutorials' code, one folder per stage, checked by
  `pnpm --filter @potyro/tutorials-code test`.

## Next

- [Tests](tests.md): the layers, the commands and what stays green before a merge.
- [Code map](code-map.md): where each concern lives.
- [Design notes](design-notes.md): the engineering record behind the code.
