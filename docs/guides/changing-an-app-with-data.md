---
title: Changing an app that has data
description: Which changes are safe, when schemaVersion must move, how to write a migration, and how an update reaches an installed app without losing its records.
section: guides
order: 7
---

# Changing an app that has data

This guide changes an app that already holds records, on your device or on everyone's, and keeps
the records. The rule in one line: `version` moves with every release, `schemaVersion` moves only
when stored records change shape, and a migration carries the records across.

## The example

The Books app from the [Introduction](../start/introduction.md) had a `read` boolean. The new
version wants a `status` with three states and a `rating`.

```ts
export default defineApp({
  id: "books",
  name: "Books",
  version: "1.1.0",       // was "1.0.0"
  schemaVersion: 2,       // was 1: a stored field changed shape
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title" },
        author: { type: "text", label: "Author" },
        status: { type: "enum", options: ["to-read", "reading", "finished"], default: "to-read", label: "Status" },
        rating: { type: "number", min: 1, max: 5, integer: true, label: "Rating" },
      },
    },
  },
  pages: [
    { id: "shelf", title: "Shelf", view: { type: "board", entity: "book", column: "status" } },
  ],
  migrations: [
    {
      from: "1.0.0",
      to: "1.1.0",
      steps: [
        { op: "renameField", entity: "book", from: "read", to: "status" },
        { op: "changeType", entity: "book", field: "status", to: "enum", via: (v) => (v ? "finished" : "to-read") },
      ],
    },
  ],
});
```

Adding `rating` needs no step. Renaming `read` and changing its type do.

## 1. Decide whether the records change shape

These changes are safe. Bump `version`, leave `schemaVersion` alone, write no migration:

- Adding a field. Existing records have no value for it until something writes one. A
  `default` applies to new records only.
- Adding or changing a page, a view option, a filter, a sort, an action, a reminder.
- Changing a `computed`. Computed values are never stored, so a new formula applies at once.
- Changing labels, help text or any other words. Adding a language.
- Adding a `ctx` call, a permission, a theme.

These change the shape of stored records. Bump `schemaVersion` and add a migration:

- Renaming or dropping a field, or renaming an entity.
- Changing a field's type.
- Replacing an enum with a relation to a new entity.

## 2. Write the migration

A migration goes from one `version` to the next. Its `from` must equal the previous release's
`version`, and its `to` the new one. Each step is one of these ops:

| Op | Fields | What it does |
|---|---|---|
| `addField` | `entity`, `field`, `default?` | Writes `default` where a record has no value. |
| `dropField` | `entity`, `field` | Removes the value from every record. |
| `renameField` | `entity`, `from`, `to` | Moves the value under the new key. |
| `changeType` | `entity`, `field`, `to`, `via` | Maps each value through `via`, a function. |
| `renameEntity` | `from`, `to` | Moves every record to the new entity key. |
| `setDefaultForExisting` | `entity`, `field`, `value` | Writes `value` where a record has no value. |
| `addRelation` | `entity`, `field`, `to`, `many?` | Adds an empty relation field. |
| `addRecord` | `entity`, `id`, `values` | Creates a record under a fixed id, once, for old records to point at. |
| `transform` | `(record, ctx) => record` | Runs over every record of every entity. Do not rely on `ctx` inside it. |

A release whose records did not change still needs a link in the chain. Give it empty steps:

```ts
migrations: [
  { from: "1.0.0", to: "1.1.0", steps: [/* … */] },
  { from: "1.1.0", to: "1.2.0", steps: [] },
]
```

## 3. Know how it runs

Potyro records the `version` an app's data was last written under. When the app opens, it walks
the migrations from that version, each `to` becoming the next `from`, and runs the ones not yet
run. A device two releases behind runs both, in order.

Data written by a newer `schemaVersion` is never touched by an older copy of the app. In a
shared app that older copy opens read-only until it is updated. The person who brings the new
version is asked before the shared data changes shape.

## 4. Apply the update to an installed app

1. Build the package as before: `npm run build`.
2. In Potyro choose **Add an app → From this device** and pick the zip.
3. The card recognises the installed app. **Replace it, keep its data** is preselected. Confirm.

The records stay. The old version lands in History. Files the app ships are replaced unless the
person changed them. The package's seed records never run on an update. An update from a file
keeps the trust the app had; an update from a link always lands sealed.

In a shared app, each copy publishes its source when it is newer. Other members are asked before
the new version runs on their device.

## 5. Export, import and back up

- **Export**, from the app's menu, writes one `.potyro.zip`: the records, photos, files, the
  app's settings and its source. It is a snapshot of the current values.
- **Import**, from the same menu, replaces the app's records with the file's. It does not merge.
  Merging two devices' edits is what sync is for.
- **Add an app** with an export file installs the app with its data on a device that never had
  it. That is how a backup comes back.
- **Back up my apps**, under You, turns sync on for every app. A second device signed in with
  your recovery words then receives them all.

## Next

- [Data and sync](../concepts/data-and-sync.md): where records live and what turning sync on does.
- [The `defineApp` reference](../reference/define-app.md): `Migration`, `MigrationStep` and the
  top-level fields.
- [Developing](../start/developing.md): the edit, build, replace loop.
