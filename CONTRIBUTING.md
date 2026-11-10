# Contributing to Potyro

Thank you for looking. This page says how to set up, what a change must carry, and how it is
checked before it is merged. `CLAUDE.md` is the longer working agreement; read its hard rules
before a change to `host`, `runtime` or the shell.

## Set up

- **Node 22** (`.nvmrc`; `nvm use` picks it). The default Node on many machines is older; some
  store tests fail on 18 for no reason of yours, and Playwright needs 20 or later.
- **pnpm**, the version in the root `package.json` (`packageManager`). `corepack enable` gets it.

```sh
pnpm i
pnpm dev            # the shell; the examples are seeded as your own apps
pnpm dev:sandbox    # the same, with the examples seeded as shared apps, sealed
pnpm -r test        # unit tests, every package
pnpm --filter @potyro/host test   # one package
```

Install a browser once for the browser suite: `pnpm exec playwright install chromium`.

## One browser spec

Specs live in `e2e/`. The file name picks the project: `*-trusted.spec.ts` runs the examples as your
own apps, `*-sandbox.spec.ts` runs them sealed. Run one file, with one worker:

```sh
pnpm exec playwright test e2e/add-app-trusted.spec.ts --workers=1
```

One worker on purpose: the specs of one origin share its storage (`playwright.config.ts` says
what broke at two). Playwright starts its own dev servers. If one is already running on the same
port, from another checkout, Playwright reuses it, and the spec tests that checkout instead of
yours. Stop it first.

The same specs in Firefox: `pnpm test:e2e:firefox`. Engine differences go in `e2e/engines.ts`,
never in a weaker assertion.

## The gate

There is no CI on GitHub. The gate is one command, run by hand on the commit to be merged:

```sh
pnpm ci:local all
```

It installs, builds, runs every unit test, the typecheck, the lints (`lint:boundaries`,
`lint:tokens`, `lint:i18n`) and the whole browser suite, as parallel shards. The browser suite
needs a strong machine: on a laptop the whole run takes about 45 minutes. Each step records its
result for the commit, so an interrupted run resumes where it stopped (`pnpm ci:local status`). On
a laptop, run the unit tests, the typecheck and the specs your change touches
(`node scripts/ci-select.mjs` lists them); the maintainer runs `all` before merging.

## What a change carries

- **Conventional commits**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, with
  a scope where it helps (`fix(store): …`). Small commits, small pull requests.
- **A sign-off on every commit** (Developer Certificate of Origin). `git commit -s` adds the line:

  ```
  Signed-off-by: Your Name <you@example.com>
  ```

  With it you certify that you wrote the change, or have the right to submit it, under the
  project's licence: <https://developercertificate.org>. A pull request with an unsigned commit is
  not merged.
- **Tests** for the behaviour you change. A UI fix is proven in a browser spec that fails without
  it, not by an element being present.
- **The licence.** Everything you contribute is under Apache-2.0 (`LICENSE`), except
  `docs/tutorials/code` and `packages/create-potyro/template`, which are MIT No Attribution because
  people copy them into their own apps. Third-party material goes in `NOTICE`, with its licence text
  beside it.

## Contract changes

`defineApp`'s shape and `ctx` are the contract between Potyro and every app. A change to either
goes, in the same pull request, with:

- the docs: `docs/04-app-module-api.md` (what app code sees) and `docs/05-runtime-interfaces.md`
  (the interfaces behind it);
- the generated reference the Studio's model reads, after any change under
  `packages/schema/src/types`: `pnpm --filter @potyro/generator gen:reference`
  (`test/reference.test.ts` fails while it is stale);
- every consumer of the interface you changed.

An app's `schemaVersion` is the version of that app's data. An additive, optional change to `ctx`
does not bump it.

## Generated files

- **The corpus** the Studio searches is built from `examples/`, `apps/`, `docs/04`, `docs/05` and the
  schema types. After a change to any of them: `pnpm --filter @potyro/generator gen:corpus`
  (`test/corpus.test.ts` fails while it is stale).
- **Lucide icons**: after bumping `lucide` and `lucide-react` (always the same version),
  `pnpm --filter @potyro/design gen:lucide`.

## Words people read

Potyro's own words are in catalogs, in six languages: `packages/i18n/locales` (en, pt-BR, de, es,
it, pl).

- Text in `packages/shell` and `packages/views` goes through `` t`…` `` or `<Trans>` (Lingui).
  `pnpm lint:i18n` fails on raw text there.
- After adding or changing a string: `pnpm i18n:extract`, then translate every new entry in every
  catalog. The catalog test (`pnpm --filter @potyro/i18n test`) fails on an empty translation. If
  you cannot translate into a language, say so in the pull request and the maintainer will.
- An app's own words live in `.po` files beside the app (`docs/30-app-translations.md`), with the
  source text as the id. People's content is never translated.
- Text the model reads stays English.

## Publishing the npm packages

Two packages go to npm: `potyro` (`packages/schema`) and `create-potyro` (`packages/create-potyro`).
They carry the same version and are released together: the project `create-potyro` writes asks
for `potyro@^<that version>`. Only the maintainer publishes.

Never run `npm publish` inside a package's folder. Only pnpm's packing puts `dist/` in place of
`src/` as the entry (`publishConfig`) and a version in place of `workspace:*`; the packages refuse
a plain `npm publish` (`prepublishOnly`). Publish the tarballs the check has proven:

```sh
# 1. the same version in both package.json files, committed, on main
pnpm i && pnpm --filter potyro --filter create-potyro test
# 2. pack both, check the manifests and file lists, then create, install, typecheck, test and pack
#    a project from the tarballs alone
pnpm check:npm --install --out /tmp/potyro-npm
# 3. publish those very files, `potyro` first (create-potyro's project needs it)
npm login
npm publish /tmp/potyro-npm/potyro-<version>.tgz --access public
npm publish /tmp/potyro-npm/create-potyro-<version>.tgz --access public
```

Afterwards, in an empty folder on Node 22:

```sh
npm view potyro version license repository.url
npm view create-potyro version license repository.url
npm create potyro@latest my-app && cd my-app && npm install && npm run typecheck && npm test && npm run build
```

`pnpm check:npm` alone (no `--install`) needs no network and takes seconds. A published version
cannot be replaced: a mistake is fixed by the next version.

## Paid runs

Some evals call paid models (`eval:modify`, `eval:ask`). Do not run them unless the maintainer asks;
the fixture runs (`eval:modify:fixture`) cost nothing.

## Security

Do not open a public issue for a vulnerability. See `SECURITY.md`.

## Conduct

`CODE_OF_CONDUCT.md` applies to the issues, pull requests and every other project space.
