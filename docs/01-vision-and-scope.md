# 01 · Vision & Scope

## The problem, stated precisely

Over years, the same shape of personal app recurs: a small set of **typed records**, shown
through a few **views**, with a couple of **computed values** and **quick actions**, that
should work **offline** and be **cheap to create**. Examples the author keeps re-hitting:

- **Plants** — photo, care notes, sun needs, seasonal treatment, last-watered datetime,
  reminder derived from watering cadence, calendar to check, one-tap "watered".
- **Recipes** — ingredients with quantities, computed calories/macros, search by
  "ingredients I have", nutrition search, an ordered steps view with a cook-along tracker.
- **Places** — GPS coordinate + photo + categories, map view filtered by category and by
  "open now".

Existing tools each fail one of: they cost money, are too complicated, try to do everything
with a clunky UI, or are cloud-first. Crucially, the good general ones (Anytype, Notion,
Budibase, amis, Glide) put their complexity into a **visual authoring interface** that the
target user finds slower than writing a file.

## The insight that makes this tractable

**Author by code, not by clicking.** If the app is a TypeScript module a person or an LLM
writes, the entire visual-builder layer — the tedious, clunky part — disappears, and logic is
unrestricted (real functions, not a DSL). What remains is a small runtime that loads a module
and renders it. That is a weekend-scale core, and it is offline-to-author by construction.

## Target user

**One user: the author.** This is personal-first software. Design decisions optimize for a
technically fluent person who would rather write/generate a definition than click a builder.
Multi-user and sharing-with-others are *later*; do not let them shape the core.

## Goals

- A **fixed, small set of declarative primitives** for *shape* (≈13 field types, a handful of
  built-in view types) — with all *logic* written as ordinary TypeScript functions.
- A **portable app module** (`*.app.ts`, bundled to `*.app.js`) that is the whole app and is
  shareable — run untrusted-by-default on receipt (docs/07).
- A **single runtime shell** that loads any definition and renders it — no per-app build.
- **Offline-first** persistence and authoring.
- **Native-capable** via one extra build target (camera, notifications, geolocation).
- **Pluggable persistence** so a future CRDT/sync store slots in without a rewrite.

## Non-goals (initial)

- No visual/drag-drop app builder. (A nicer authoring front-end may *generate* JSON5 later,
  but the definition stays the source of truth.)
- No multi-user collaboration, CRDT, or realtime sync in the initial milestones. The `Store`
  seam keeps the door open; that's all.
- No restricted expression DSL for logic. Logic is full TypeScript. (Structure stays
  declarative data — that is a schema, not a DSL.)
- No server requirement. A self-hosted push relay or sync server is an *optional* later
  add-on for specific features (reminders on web, cross-device sync).
- Not a database for large-scale or multi-tenant data. Personal-scale (thousands, not
  millions, of records per app).

## What "done enough to use daily" looks like

The author runs the shell, has recipes/plants/places as three loaded definitions, uses the
plant reminder to actually water plants, cooks from the steps view, and logs places on a map
— all on their phone, offline. New app #4 is a new text file, no code changes.

## Relationship to prior art (borrow, don't reinvent)

- **Object/relation + views model** — study Anytype's object model and Notion's
  database/view split; adopt the good decomposition, reject the heavy authoring UI.
- **Config/JSON-defined UI** — amis and Budibase prove interpretation works, but their logic
  story is a DSL that hits walls; Karta keeps *structure* declarative and makes *logic* full
  code instead.
- **Local-first data** — follow the Ink & Switch "local-first" principles; use a mature
  local DB rather than hand-rolling. Sync engines (Jazz/Triplit/Automerge/Loro) are the
  eventual `Store` implementation, not something to build.
- **Schema evolution** — the hard part; take the lens idea from Ink & Switch's *Cambria* as
  the north star for `docs/06`, but ship a pragmatic subset.
- **Plugin trust models** — VS Code / Obsidian extensions and browser userscripts are the model
  for running full-language app code safely by provenance + capability grants (docs/07).
