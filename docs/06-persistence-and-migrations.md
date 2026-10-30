---
title: Persistence & Migrations
description: The storage model, media, computed fields, schema evolution and the migration steps.
status: current
order: 6
---

# 06 · Persistence & Migrations

## Storage model

**Primary impl: SQLite WASM (OPFS-backed) + JSON1.** Chosen because the author is fluent in
SQL, it gives real query pushdown for filters, and OPFS gives durable local storage. One
SQLite database file **per app definition** (namespaced by `definition.id`).

### Table strategy: generic document table (v1)

```sql
CREATE TABLE records (
  entity     TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,          -- JSON object of field values
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE INDEX idx_records_entity ON records(entity);

CREATE TABLE blobs (
  key  TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  w INTEGER, h INTEGER
);

CREATE TABLE meta ( k TEXT PRIMARY KEY, v TEXT );  -- stores stored schema/app version
```

Filters push down via `json_extract(data,'$.field')` in `WHERE`/`ORDER BY`. **Hot-field
promotion (later):** frequently filtered/sorted fields can be materialized into generated
columns + indexes without changing the record shape:

```sql
ALTER TABLE records ADD COLUMN f_nextWatering TEXT
  GENERATED ALWAYS AS (json_extract(data,'$.nextWatering')) VIRTUAL;
CREATE INDEX idx_recipe_next ON records(f_nextWatering) WHERE entity='plant';
```

Keep this an optimization, not a requirement; the generic table keeps migrations simple.

### Alternative impl

`TinyBase` or `PGlite` behind the same `Store` interface are acceptable. Do not let the
choice leak past `packages/store`.

## Media

- `media` fields store a `MediaRef { key }`; bytes live in `blobs` (or OPFS files for large
  media). Thumbnail on capture; keep a size budget per app (setting). Export bundles media
  as base64 or a zip alongside the data JSON.

## Computed fields

Never stored. Resolved on read by the runtime via `expr`. This means changing a computed
formula needs no data migration — a key reason computed values are not persisted.

## Schema evolution — the hard part

Definitions carry `version` (app semver) and the DB stores the version its data was written
under (`meta.app_version`, `meta.schema_version`). On load:

1. If `meta.schema_version < definition.schemaVersion` → run **format migrations** (built
   into the runtime; rare, versioned with the format).
2. If `meta.app_version < definition.version` → run the definition's **`migrations`** in
   order. Data is migrated lazily-eligible but by default eagerly on open (personal-scale
   data is small).

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
`transform: (record, ctx) => record` run per record. (This is safe: migrations run in the same
trust context as the app whose data they migrate.)

### North star (not v1)

Ink & Switch's *Cambria* lenses (bidirectional schema evolution) are the aspirational model
for two people on different definition versions exchanging data. v1 does **one-directional,
in-order** migrations only. Design the migration records so a lens layer could later consume
them, but do not build it now.

## Backup / portability

- **App** export/import: the bundled `*.app.js` (the shareable artifact; runs untrusted on
  import — docs/07).
- **Data** export/import: `{ appId, appVersion, records, blobs, kv }` JSON (+ media). This is the
  user's backup and cross-device move path. The `Store` and `FileCap` provide the primitives;
  the shell provides the UI. Mirrors the JSON backup already built into the workout PWA.
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

- All writes go through `Store.transaction` where multi-record.
- Keep an append-only `ops` log (optional, feature-flagged) to enable undo and to smooth a
  future CRDT migration (ops replay). Not required for M1.
