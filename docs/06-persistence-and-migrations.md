---
title: Persistence & Migrations
description: The storage model, media, computed fields, schema evolution and the migration steps.
status: current
order: 6
---

# 06 · Persistence & Migrations

## Storage model

How the stores are chosen and why is docs/00 "Storage". In short: a local-only app gets
**`SqliteStore`**, SQLite WASM over OPFS in a dedicated worker, one database per app (namespaced by
`definition.id`); a synced app gets **`JazzStore`**, the CRDT store (docs/00 "Sync, CRDT and
identity"); `LocalStore` is the fallback where a worker cannot get storage. All of them implement
the one `Store` interface (`packages/store/src/types.ts`).

### `SqliteStore`'s tables: a generic document table

As created by `packages/store/src/sqlite-store.ts`:

```sql
CREATE TABLE IF NOT EXISTS records(
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  id     TEXT NOT NULL,
  doc    TEXT NOT NULL,             -- the record as JSON, createdAt/updatedAt inside it
  UNIQUE(entity, id)
);
CREATE INDEX IF NOT EXISTS ix_records_entity ON records(entity, seq);
CREATE TABLE IF NOT EXISTS blobs(key TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);     -- ctx.storage, __appVersion
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, doc TEXT NOT NULL); -- the app's folder (#252)
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);   -- schemaVersion
```

A record is read and written as a document, so adding a field is not a schema change in SQLite.
Filters are the app's own JS predicates (docs/04), run over the records, not SQL. **Not built:**
promoting a hot field into a generated column with an index, without changing the record shape:

```sql
ALTER TABLE records ADD COLUMN f_nextWatering TEXT
  GENERATED ALWAYS AS (json_extract(doc,'$.nextWatering')) VIRTUAL;
CREATE INDEX idx_plant_next ON records(f_nextWatering) WHERE entity='plant';
```

Keep it an optimisation if it is ever done; the generic table keeps migrations simple. Whatever the
store, its choice does not leak past `packages/store`.

## Media

- A `media` field stores a `MediaRef` (`{ key, mime, w?, h? }`, `packages/schema/src/types/core.ts`).
  The bytes are a row in `blobs` in `SqliteStore`, and in `JazzStore` a `FileStream` CoValue of their
  own, fetched when someone opens the photo (ADR 0001 D5).
- A picture is re-encoded at 2048 px on its longest edge before it is stored, unless the field says
  `full: true` (`packages/views/src/image-scale.ts`).
- An export carries the bytes, not just the references: they are in its `data.sqlite`
  (`e2e/media-trusted.spec.ts`).

## Computed fields

Never stored. Resolved on read by calling the app's own `computed` functions (docs/04). This means
changing a computed formula needs no data migration — a key reason computed values are not
persisted.

## Schema evolution — the hard part

Definitions carry `version` (app semver) and `schemaVersion`. The store keeps the app version its
data was written under (`__appVersion`, in `kv`) and the schema version (`meta`). On load
(`packages/shell/src/migrate-on-load.ts`):

1. If the stored `schemaVersion` is newer than the definition's, nothing runs and nothing is
   recorded: an older copy of the app must not rewrite a newer one's data (KA-22).
2. Otherwise the definition's **`migrations`** are walked from the stored `__appVersion`, each
   migration's `to` becoming the next one's `from` (`migrationChain` in `packages/store`), so a device
   two versions behind runs both, in order, and a current one runs none. They run eagerly on open
   (personal-scale data is small), and the new version is recorded.

In a shared app the version gate decides first whether this copy may migrate the shared data at all
(`packages/shell/src/version-gate.ts`, ADR 0001 D7).

### Migrations — declarative ops, with a code escape hatch

Because app logic is already full TypeScript, migrations may be **either** a declarative op
(nice for the common cases, introspectable) **or** a function `(record, ctx) => record` for
anything bespoke. The declarative op set below stays the fast path.

```ts
migrations: [
  {
    from: "1.0.0", to: "1.1.0",
    steps: [
      { op: "addField", entity: "recipe", field: "timesCooked", default: 0 },
      { op: "renameField", entity: "recipe", from: "notes", to: "description" },
      // changeType's `via` is a real function, not an expression string:
      { op: "changeType", entity: "recipe", field: "servings", to: "number",
        via: (value) => Number(value) },
      { op: "dropField", entity: "recipe", field: "legacyTag" },
      { op: "renameEntity", from: "meal", to: "recipe" },
      { op: "setDefaultForExisting", entity: "plant", field: "active", value: true },
      // fully bespoke step — arbitrary per-record transform:
      { transform: (record, ctx) => ({ ...record, slug: record.name.toLowerCase() }) },
    ],
  },
]
```

Op set: `addField`, `dropField`, `renameField`, `changeType` (with a `via` transform —
a value-mapping **function**), `renameEntity`, `setDefaultForExisting`, `addRelation`, `addRecord`
(`{ entity, id, values }` — a record under a fixed id that existing records can then point at: the
first list when items start belonging to lists; nothing happens if it is there already). For
anything the ops don't cover, a migration step may be a plain function
`transform: (record, ctx) => record`, run over every record of every entity
(`applyMigrationStep` in `packages/store/src/migrate.ts`; the `ctx` it is given there is a
placeholder, so a transform should not rely on it). (This is safe: migrations run in the same
trust context as the app whose data they migrate.)

### North star (not v1)

Ink & Switch's *Cambria* lenses (bidirectional schema evolution) are the aspirational model
for two people on different definition versions exchanging data. v1 does **one-directional,
in-order** migrations only. Design the migration records so a lens layer could later consume
them, but do not build it now.

## Backup and portability

- **Export** (`⋯` → Export, `exportApp` in `packages/shell/src/main.tsx`) writes one `.potyro.zip`
  (`packages/store/src/export.ts`): `data.sqlite`, a real SQLite copy of the app's records, photos,
  files and `ctx.storage`; `data.json` and `csv/<entity>.csv`; `manifest.json`; the source; and the
  app's libraries and modules with their lock (docs/00 "The export bundle"). It is a **snapshot** of
  the current values: a synced app's CRDT history does not go into it.
- **The manifest's `mode` is always `snapshot`.** `ExportMode` in `export.ts` names nothing else, and
  `unpackBundle` reads a bundle that says otherwise (an old file) as a snapshot.
- **Import** (`⋯` → Import) **replaces** the app's records with the bundle's: the records it replaces
  are removed first, so what you import is what you have (`replaceWithBundle` in `main.tsx`). It does
  not merge. Merging two devices' edits is what sync does, not a file.
- **Adding an app from a bundle** (Add an app) reads the bundle as an app package and installs it,
  sealed, with its data; that is how a backup reaches a device that never had the app (docs/00 "The
  app package").
- **Moving to a new home** (`packages/shell/src/move-*.ts`, docs/16 "Moving to a new home") carries
  every app as the same snapshot, `apps/<id>.sqlite` in a `potyro-move/1` archive. On arrival records
  keep their ids and are **upserted** into an app with the same code ("merge, never duplicate",
  `move-plan.ts`), so the same move run twice ends with one of everything; an app changed differently
  on both sides comes in beside the one there instead. This is a merge of whole records by id, not
  of fields: a record on both sides ends as the incoming one (`copyStoreData` inserts with the
  record's own id, and `SqliteStore`'s insert is an upsert on entity and id).
- **The backup switch** (`packages/shell/src/backup-all.ts`) is not a file: it turns sync on for every
  app, so a second device signed in with the recovery words brings them all back.
- **Your account** holds what is yours rather than an app's, in maps owned by a group whose only
  member is your account (so only your devices can read them), each named on the account CoMap:
  `potyroApps` — your apps and where their data is (`store/src/account-apps.ts`) — and
  `potyroChats` — each app's Studio conversation (#283, `store/src/account-chats.ts`), one key per
  message (`<appId>\0<messageId>` → JSON). The conversation never goes through the app's shared
  space, whose members are the people you share the app with; sending it to them stays the opt-in on
  export. The device's own `studio-chat` store remains the copy the Studio reads; `shell/src/chat-sync.ts`
  brings it and the account's into step when the Studio opens an app, after each message, and at
  boot for every synced app. Messages are only added, so the merge is a union by id: two devices that
  each said something offline both keep everything, in the same order (`n`, then time, then id). A
  deleted app's messages become empty values, so a device that has not heard cannot send them back.
  Only apps whose data syncs on the device take part; drafts stay on their device. Tested by
  `e2e/chat-follows-you-trusted.spec.ts` (owner, owner's second device, a collaborator).

## Consistency & undo

- All multi-record writes go through `Store.transaction`.
- There is no undo of data and no operations log. History (`packages/shell/src/app-history.ts`) is
  the app's *source* versions, not its records; in a synced app the CRDT keeps each field's edits,
  which the activity view reads (docs/00 "Sync, CRDT and identity").
