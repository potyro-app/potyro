---
title: CLI
description: npm create potyro, which scaffolds a project, and potyro pack, which makes the package Add an app installs.
section: reference
order: 10
---

# CLI

Two commands: `npm create potyro` starts a project, and `potyro pack` turns an app into the
`.potyro-app.zip` that **Add an app** installs.

```sh
npm create potyro@latest books        # a project in books/
cd books
npm install
npm run build                         # → dist/books.potyro-app.zip
```

You need Node 20 or newer.

## `npm create potyro <folder> [-- --title "…"]`

Makes a folder with an app that packs, tests and typechecks. The folder must be new or empty.

| Argument | What it does |
|---|---|
| `<folder>` | where to write; its name, as a lowercase slug, becomes the app's `id` and its file's name |
| `--title "Reading list"` | the name people see; default: the slug with spaces and a capital, `reading-list` → `Reading list` |

The `--` before `--title` passes the flag through npm.

### What it writes

| File | What it is |
|---|---|
| `<name>.app.ts` | the app: one entity, two pages, one computed value, one action |
| `test/app.test.ts` | imports the app, which validates it, and tests one plain function |
| `package.json` | the scripts below and the dev dependencies |
| `tsconfig.json` | strict TypeScript for one app file and its tests |
| `README.md` | how to build, test and install the app |
| `.gitignore` | `node_modules/` and `dist/` |

### The scripts

| Script | Runs | What it does |
|---|---|---|
| `npm run build` | `potyro pack <name>.app.ts -o dist/<name>.potyro-app.zip` | makes the package |
| `npm test` | `vitest run` | the app is valid and its functions do what they say |
| `npm run typecheck` | `tsc --noEmit` | the types line up with Potyro's |

The dev dependencies are `potyro`, `typescript` and `vitest`. `potyro` is the authoring package: it
provides `defineApp`, every type, and the `potyro` command.

### In a project of your own

```sh
npm install --save-dev potyro
npx potyro pack
```

## `potyro pack`

```
potyro pack [app.ts] [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
```

Makes the package. Without a source it packs the one `*.app.ts` or `*.app.tsx` in the current
folder. With none, or more than one, it says so and stops.

| Argument | What it does |
|---|---|
| `app.ts` | the entry file; `.tsx`, `.js` and `.jsx` work too |
| `file …` | each file ships at the top of the app's folder under its own name, as data for `ctx.files` |
| `--seed seed.json` | first records, `{ entity: [row, …] }`; checked for valid JSON here, not on someone's device |
| `--files <dir>` | ships a whole folder, keeping its sub-folders |
| `-o out.zip`, `--out out.zip` | where to write; default `<name>.potyro-app.zip` beside the entry, `books.app.ts` → `books.potyro-app.zip` |

### What goes in

- The entry file, as `app.ts` or `app.tsx`.
- Every module the entry imports relatively, and what they import in turn, under `src/`. Only what
  the app runs; a type-only import adds nothing. An import that leaves the entry's folder is an
  error.
- `locales/*.po` beside the entry, always, under `files/locales/`.
- The files named on the command line and under `--files`, under `files/`.
- `seed.json`, when given.
- The app's declaration in the manifest: name, icon, entities, pages, permissions, as data. It is
  read by running the entry's top level in Node. When that fails, the package is still written, with
  a warning: **Add an app** then reads the app from its code.

Libraries imported by URL are not fetched. The package names them, and the person's device fetches
and locks them at install. See [Package format](package-format.md).

### Output

One line on success:

```
dist/books.potyro-app.zip: the app, 2 modules and 3 files, with a seed
```

| Exit code | When |
|---|---|
| 0 | the package was written |
| 2 | a usage error: an unknown option, a missing file, no app in the folder, a seed that is not JSON |
| 1 | anything else |

## `potyro --version`, `potyro help`

Print the version, or the commands.

## Next

- [Developing](../start/developing.md): edit, build and replace; typecheck; tests.
- [Package format](package-format.md): what the zip holds and what install does with it.
- [Your first app](../start/your-first-app.md): the project this scaffold is the start of.
