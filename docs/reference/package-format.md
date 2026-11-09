---
title: Package format
description: The .potyro-app.zip: its files, the manifest, shipped files, the seed, libraries and the lock, and what install and update do.
section: reference
order: 9
---

# Package format

An app travels as a `.potyro-app.zip`: a zip in the `potyro-app/1` format that **Add an app**
installs.

```
books.potyro-app.zip
├── manifest.json          what the package holds, and what the app declares
├── app.ts                 the entry file (app.tsx when it uses JSX)
├── src/plan.ts            the app's own modules, imported as ./plan.ts
├── files/art/cover.jpg    files the app ships, read with ctx.files
├── files/locales/pl.po    the app's translations
├── files/.modules/<sha256>.js   a library's bytes
├── lock.json              libraries by URL, with their digests
├── seed.json              first records, { entity: [row, …] }
└── chat.json              optional: the Studio conversation that made it
```

`potyro pack` writes it; see [CLI](cli.md). A bare `*.app.ts` file is a package with no files and
no seed, and installs the same way.

## The files

| Entry | Required | What it is |
|---|---|---|
| `manifest.json` | yes | `format`, `source`, the file lists, the app's declaration |
| `app.ts` or `app.tsx` | yes | the entry file; its default export is `defineApp({ … })` |
| `src/<path>` | | modules the entry imports relatively, by their path from the entry's folder |
| `files/<path>` | | data the app ships; installed into its folder and read with `ctx.files` |
| `files/locales/<lang>.po` | | translations; always packed from `locales/` beside the entry |
| `lock.json` | | every library the code imports by URL → the file holding its bytes and their digest |
| `files/.modules/<sha256>.js` | | the libraries' bytes, when the package carries them |
| `seed.json` | | first records; applied once, on first install |
| `chat.json` | | the Studio conversation, when the author chose to include it |

A zip made by hand may wrap everything in one folder. It is read through it.

## The entry file

The entry is the one editable source: History, the Studio editor and sync all work on it.

| Import | Where it comes from |
|---|---|
| `"potyro"`, `"react"`, `"react/*"` | provided by Potyro; never part of the package |
| `"./plan.ts"`, `"./ui/card.tsx"` | the package's `src/`; an import that leaves the entry's folder is refused |
| `"https://esm.sh/chart.js@4.5.1?bundle"` | a library, by URL, pinned to an exact version |

Only what the app runs is packed: a type-only import adds nothing. Bare npm names other than the
provided ones are not resolved. A URL names bytes that can be fetched and locked; a package name
does not.

## The manifest

```json
{
  "format": "potyro-app/1",
  "source": "app.ts",
  "files": [{ "path": "art/cover.jpg", "size": 48213 }],
  "modules": [{ "path": "plan.ts", "size": 1320 }],
  "app": { "id": "books", "name": "Books", "entities": { "…": "…" }, "pages": ["…"], "permissions": { "camera": true } },
  "credit": { "name": "Books", "by": "Ana", "remixOf": { "name": "Reading list" } },
  "line": "books:7f3a"
}
```

| Field | What it is |
|---|---|
| `format` | `"potyro-app/1"` |
| `source` | the entry's name in the zip |
| `files`, `modules` | each shipped file and module with its size |
| `app` | the app's declaration: the definition as data, every function replaced by a marker |
| `credit` | who made it and what it is a remix of; a short chain |
| `line` | which app this is across devices, so a link made on one device opens the copy on another |

The **Add an app** card is drawn from `app` without running any code: name, icon, what it keeps,
its pages, what it asks for. `potyro pack` writes `app` by running the entry's top level on your
machine. A package without it is read in the sealed box instead. If the code, once loaded, names a
different app than its declaration, it is not added.

## Shipped files

Everything under `files/` lands in the app's folder, marked as shipped, and is read with
`ctx.files`. A seed record may point at one:

```json
{ "recipe": [{ "title": "Pancakes", "photo": { "file": "photos/pancakes.webp" } }] }
```

The record gets its own copy of that file. A field of several photos takes a list of them.

On an update, a shipped file is replaced unless the person changed it; then it is kept. Shipped
files the new version no longer carries are removed.

## The seed

`seed.json` is `{ entity: [row, …] }`, one list of rows per entity. Each row's values must fit the
entity's fields. It runs once, when the app is first installed, and never on an update. It is the
app's sample content, not the person's records.

## Libraries and the lock

A library is imported by URL, pinned to an exact version. `lock.json` maps each URL to its bytes:

```json
{
  "https://esm.sh/chart.js@4.5.1?bundle": {
    "file": ".modules/3f9c….js",
    "integrity": "sha256-…",
    "size": 212004
  }
}
```

| Field | What it is |
|---|---|
| `file` | the file in the app's space: `.modules/<sha256>.js` |
| `integrity` | `sha256-<base64>`, as in Subresource Integrity |
| `size` | the byte count |
| `base` | the URL the bytes were really served from, when the host redirected |

A package that carries the bytes under `files/.modules/` installs offline. A package without them
says on the card what it fetches, and fetches it once when the person presses **Add**. The fetch
follows the library's whole import graph and locks every file. It refuses, by the library's name:

- a URL without an exact version
- a file the host does not serve
- a bare package name inside the library
- an `import()` of a value decided at run time
- a file loaded relative to `import.meta.url`

Nothing half-locked is kept. From then on a file whose bytes do not match the lock is refused by
name, and the app shows that instead of opening. `.modules/` and `.src/` are hidden from `ctx.files`
and cannot be written by the app.

A library runs in the sealed box without a page. One that touches `window` or `document` while
loading fails with its own name, and the app can then only run as the person's own.

## What happens on install

1. The card is drawn from the manifest's `app`.
2. The code loads in the sealed box on a throwaway store, and sample records go through its
   functions. A feature the box lacks is named on the card in plain words.
3. The person chooses the trust (below) and presses **Add**.
4. Libraries without bytes are fetched and locked.
5. Shipped files land in the app's folder; the seed runs; `chat.json` becomes the app's conversation.

## What happens on update

When the same app id is already installed, **Replace it, keep its data** is preselected. **Add as a
second app** makes an empty copy under a new id.

| | Replace |
|---|---|
| Records | kept; the data check runs on the next open |
| Entry and modules | replaced; History keeps the old version |
| Shipped files | replaced, unless the person changed them; dropped ones removed |
| Libraries | the new lock; bytes the package does not carry are fetched when you press **Add** |
| Seed | not run |
| Conversation | kept; `chat.json` never overwrites it |
| Trust | kept for a file or pasted source; dropped to sealed for a link |

## How trust is recorded

Every app arrives sealed. The card for a file from this device or pasted source offers **I wrote
this. Run it as mine.** A link never offers it, and an update that arrives by link puts a trusted
app back in the sealed box.

After install, a sealed app can always be let to run as the person's own: from its shield badge,
its tile menu, or the screen that says it could not open. One dialog, one warning, acting only on
confirmation. Code that does not match its lock is never one tap from full authority. See
[Your apps and other people's apps](../concepts/trusted-and-sealed.md).

## The export bundle

**Export** writes an app and its data as a `.potyro.zip` in the `potyro-bundle/1` format:

| File | What it is |
|---|---|
| `data.sqlite` | a real SQLite file |
| `data.json` | every entity's rows as JSON |
| `csv/<entity>.csv` | one CSV per entity |
| `manifest.json` | the schema version, the trust, the granted capabilities, the declaration |
| `app.ts` | the entry |
| `lock.json`, `files/.modules/`, `src/` | the app's code beyond its entry, with its lock |

Every export is a snapshot of the current values. **Import** replaces the app's records with the
bundle's; it does not merge. A bundle also installs as a package on a device that never had the
app, and fetches nothing, because the code travels with its lock.

## Next

- [CLI](cli.md): `potyro pack`, the command that writes a package.
- [Your apps and other people's apps](../concepts/trusted-and-sealed.md): what sealed means.
- [Sharing](../concepts/sharing.md): links, demos and Make it mine.
