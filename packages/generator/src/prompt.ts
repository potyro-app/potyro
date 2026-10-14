// Prompt assembly for the cloud generator (KA-05): the system prompt teaches the `defineApp`
// contract with a couple of few-shot examples, and the user/repair messages frame each request.
// Kept pure + exported so the assembly is unit-testable without any model call.

import type { GenPrompt } from "./backend.js";
import { EDIT_FORMAT } from "./edits.js";
import { changeLanguageInstruction, createLanguageInstruction, type TurnLanguage } from "./language.js";
import { SCHEMA_REFERENCE } from "./reference.generated.js";
import { FIELD_TYPES, PAGE_FIELDS, VIEW_FIELDS } from "potyro";

export const EXAMPLE_TODO = `import { defineApp } from "potyro";

export default defineApp({
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    task: {
      label: "Task",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        done: { type: "boolean", default: false },
        due: { type: "datetime" },
      },
    },
  },
  pages: [
    { id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } },
  ],
});`;

export const EXAMPLE_COMPUTED = `import { defineApp } from "potyro";

export default defineApp({
  id: "books",
  name: "Books",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [
    { id: "add-book", label: "Add book", icon: "＋", entity: "book", open: true },
  ],
  entities: {
    book: {
      label: "Book",
      icon: "📚",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        status: { type: "enum", options: ["to read", "reading", "done"], default: "to read" },
        pages: { type: "number", min: 0 },
        pagesRead: { type: "number", min: 0, default: 0 },
      },
      computed: {
        percent: (b) => (b.pages ? Math.round((Number(b.pagesRead) / Number(b.pages)) * 100) : 0),
      },
    },
  },
  pages: [
    {
      // ONE top-level list per entity; rows open the (hidden) detail so records are viewable/editable.
      id: "all",
      title: "Books",
      view: {
        type: "list",
        entity: "book",
        display: { primary: "title", secondary: (b) => \`\${b.percent}%\` },
        onOpen: { page: "detail", param: { bookId: "id" } },
      },
    },
    {
      id: "detail",
      title: "Book",
      hidden: true,
      view: { type: "detail", entity: "book", param: "bookId", sections: [{ fields: ["title", "status", "pages", "pagesRead"] }] },
    },
  ],
});`;

export const EXAMPLE_CUSTOM_VIEW = `import { defineApp, type ViewProps } from "potyro";
import { useEffect, useState } from "react";

// A custom view is a NORMAL React component in the same file. Import React hooks from "react";
// they are NOT on \`props\`. Reach data through \`props.runtime\`.
function Today({ runtime }: ViewProps) {
  const { rows } = runtime.useQuery("glass");           // live query hook — re-renders on change
  const [now, setNow] = useState(0);
  useEffect(() => {                                     // timers/subscriptions go in an effect
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const total = rows.reduce((n, r) => n + Number(r.ml ?? 0), 0);
  return (
    <div>
      <h2>{total} ml today</h2>
      <progress value={total} max={2000} />
      <button type="button" onClick={() => void runtime.create("glass", { ml: 250 })}>
        + glass
      </button>
    </div>
  );
}

export default defineApp({
  id: "water",
  name: "Water",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    glass: {
      label: "Glass",
      icon: "💧",
      displayField: "ml",
      fields: { ml: { type: "number", default: 250 }, at: { type: "datetime", default: (ctx) => ctx.now() } },
    },
  },
  pages: [
    { id: "today", title: "Today", view: { type: "custom", entity: "glass", render: (props) => Today(props) } },
    { id: "all", title: "Glasses", view: { type: "list", entity: "glass", display: { primary: "ml" } } },
  ],
});`;

/**
 * The model's reference: the `potyro` module's declarations, verbatim (see reference.ts). The
 * hand-written catalogue this replaces said less than the schema did, and every gap was a refusal
 * (#130). Now what the model is told exists is, byte for byte, what the validator enforces.
 */
function fullReferenceSection(): string {
  return `REFERENCE — THE \`potyro\` MODULE'S TYPE DECLARATIONS, VERBATIM. This is the complete and authoritative
surface: every field type, every view type and each option it accepts, every member of \`ctx\`, with the
doc comment that says what it does. If an option is declared here, it works; if it is not declared
here, it does not exist — do not invent one and do not assume one is missing without reading the
declaration. Before saying something cannot be done, find the type it would live on and read it.

\`\`\`ts
${SCHEMA_REFERENCE}
\`\`\``;
}

/**
 * The same facts at a fraction of the size, for on-device models whose context cannot hold the full
 * declarations (Gemini Nano, WebLLM's 4k-context Qwen builds). Still DERIVED from the schema —
 * `FIELD_TYPES` and `VIEW_FIELDS` come from the Zod validator — so it lists every option the full
 * reference lists; what it drops is the doc comments and the types of each option.
 */
function compactReferenceSection(): string {
  const views = Object.entries(VIEW_FIELDS)
    .map(([type, fields]) => `  \`${type}\`  { ${fields.join(", ")} }`)
    .join("\n");
  return `REFERENCE (compact — every option that exists, from the validator; \`?\` marks optional)
- Field \`type\`: ${FIELD_TYPES.join(", ")}.
- A page declares: ${PAGE_FIELDS.join(", ")} and a \`view\`. Each view type and everything it accepts:
${views}
An option not listed here does not exist; one listed here works.`;
}

function assembleSystemPrompt(reference: string): string {
  return `You generate a single Potyro app module (a \`.app.ts\` file) from a natural-language description.

CONTRACT
- The file default-exports \`defineApp({ ... })\` imported from "potyro".
- Top-level: \`id\` (kebab-case), \`name\`, \`version\` ("1.0.0"), \`schemaVersion\` (1), \`language\`, \`entities\`, \`pages\`.
- An entity has \`label\`, \`displayField\`, \`fields\`, and optional \`computed\` / \`actions\`.
- Field \`type\` is one of the \`Field\` union in the REFERENCE below. There is NO "object" type.
- To REFERENCE another object type, use a \`relation\` field: \`{ type: "relation", to: "<entity>" }\` (add
  \`many: true\` for a multi-select). The form then shows a PICKER of that entity's existing records.
- A \`list\` field's \`of\` is a FLAT MAP of sub-fields — the sub-fields go DIRECTLY in \`of\`, keyed by name.
  Do NOT wrap them: NEVER \`of: { type: "object", fields: {...} }\`. A sub-field may itself be a
  \`relation\` (to reference another object) or another \`list\` (to nest). Example:
  \`sets: { type: "list", of: { exercise: { type: "relation", to: "exercise" }, reps: { type: "number" } } }\`
- Structure (entities/fields/view layout) is plain data. All LOGIC — computed, filters, sorts, actions,
  display bindings — is ordinary TypeScript functions that receive the record (and \`ctx\`). There is NO
  expression language; write real functions.
- HOW A RECORD READS INSIDE YOUR FUNCTIONS. Filters, sorts, computed and actions receive a RESOLVED
  record, not the raw stored row. This is the single most common way a generated app validates,
  renders, and then does nothing:
    - \`relation\` -> the RELATED RECORD, an object. Compare ids: \`todo.list?.id === list.id\`.
      \`todo.list === list.id\` compares an object with a string, is always false, and produces an
      empty page or a count stuck at 0 with no error anywhere.
    - \`relation\` with \`many: true\` -> an ARRAY of records: \`todo.tags?.some((t) => t.id === x)\`.
    - \`member\` -> a \`Person\` (\`{ id, name }\`), so compare \`row.addedBy?.id === ctx.me.id\`.
    - \`datetime\` -> a real \`Date\` (call \`.getTime()\`, never compare strings). It is a DAY unless the
      field says \`precision: "minute"\` — do that only when the hour matters (a session start).
    - \`media\` -> a \`MediaRef\`; render it through a media binding, do not read it as a URL.
    - \`media\` is a tile with a preview and (on a phone) Camera / Library; set \`accept\` and, when
      a record can have several, \`multiple: true\`. Never ask for a URL field "for the photo".
    - text/number/boolean/enum/tags/geo/list read as written. An \`enum\` picks its own control
      from the option count (up to five are a row of buttons, more a searchable picker) — never
      write a control; give it \`colors\` (red orange yellow green teal blue purple pink grey) only
      when a value's colour MEANS something ("overdue" red), never for decoration.
  When you WRITE one, do the opposite: store the id. \`ctx.patch("todo", t.id, { list: list.id })\`.

LANGUAGES — the app's own words (labels, titles, help, empty texts, buttons)
- Write a new app in ONE language: the person's, the one their request is written in, and declare it
  — \`language: "pl"\` with Polish words. Every app declares \`language\`, even when all its strings are plain.
- Add a language only when the person asks for one ("also in German"), and then with the \`translate\`
  tool, not by hand. Its words become maps — \`label: { en: "Quantity", pl: "Ilość" }\` — and
  \`languages: ["en", "pl"]\` lists every language, the app's own first.
- Every map has the app's own \`language\`. In an app with several languages, everything you add or
  change carries all of them: a new field gets every label; a renamed one is renamed in each.
  Inside functions: \`ctx.t({ en: "Due now", pl: "Do podlania" })\`, with \`vars\` for plurals
  (\`{n, plural, one {# plant} other {# plants}}\`), and \`ctx.format.date/number/money/relative/list\`
  for formats — but return a Date or a number where a view formats it.
- Records are never translated. An enum's options are stored values and stay as they are; their words
  go in \`labels: { todo: { en: "To do", pl: "Do zrobienia" } }\`.
- Words and languages are not data: a translation moves \`version\` but never \`schemaVersion\`, and
  needs no migration.
- \`computed\` entries are FUNCTIONS \`(record, ctx) => value\` (may be \`async\`). A computed a page
  shows under a heading — listed in a group, a detail \`sections\` entry or a table's \`columns\` — says
  what it is called: \`perServing: { label: "Calories per serving", value: (r) => r.kcal / r.servings }\`.
  Without a label the heading is the key ("Per Serving"), in every language. A computed used only in
  a binding, a filter or a sort stays a bare function. A shown one returning a key takes \`labels\` (as
  an enum); one returning an object, \`format: "{kg, number} kg × {reps}"\`.
- \`actions\` entries are BARE FUNCTIONS \`(record, ctx) => void | Promise<void>\` — NOT objects. Write
  \`actions: { water: async (plant, ctx) => { await ctx.patch("plant", plant.id, { ... }); } }\`.
  NEVER \`actions: { water: { label: "...", run: ... } }\`. A detail view lists action KEYS:
  \`actions: ["water", "repot"]\`.

${reference}

NOTES ON \`ctx\` — the surface is \`interface Ctx\` above; these are the mistakes models make with it.
There is NO \`ctx.data\` namespace. Data methods live directly on \`ctx\` and are ALL async:
- \`await ctx.query(entity, { filter?, sort?, limit?, offset? })\` → Resolved[]   (NOT \`ctx.data.list\`,
  NOT a \`where\` option — the option is \`filter\`, a JS predicate \`(r) => boolean\`)
- \`await ctx.get(entity, id)\` → Resolved | null
- \`await ctx.create(entity, data)\` → Resolved                                    (NOT \`ctx.data.create\`)
- \`await ctx.patch(entity, id, data)\` → Resolved   — this is how you UPDATE      (NOT \`ctx.update\`,
  NOT \`ctx.data.update\`)
- \`await ctx.increment(entity, id, field, delta)\` → Resolved — **use this for anything people COUNT.**
  Never \`ctx.patch(id, { n: record.n + 1 })\`: that reads on one device and writes on another, so when
  two people press at the same moment both read the old value, both write the same new one, and one
  press is silently lost. Say the CHANGE (\`+1\`, \`-1\`) and the store adds them up. The field is still
  an ordinary number to read.
- \`await ctx.delete(entity, id)\`
- \`await ctx.transaction(async (tx) => { ... })\` — NOT atomic across devices. Two records that must
  agree (a swap, a transfer, a running total) can still be left inconsistent when two people act at
  once. Prefer recording what HAPPENED and deriving the total, over writing the total.
- \`ctx.now()\` → Date, \`ctx.today()\` → Date          (sync; NOT \`ctx.data.now\`)

## CHANGING AN APP THAT ALREADY HAS DATA

When you MODIFY an app, records already exist. Adding, removing or renaming a field, or adding a
required relation, leaves every existing record in the old shape — and a required field they do not
have makes them vanish from the app. That reads to the user as "you deleted my data".

So whenever you change what \`entities\` STORE (fields, relations, keys — not labels or other words):

1. Bump BOTH versions. \`version\` is semver and moves e.g. "1.0.0" -> "1.1.0"; \`schemaVersion\` is an
   integer and goes up by one. Migrations are keyed off \`version\`, so leaving it alone means nothing
   runs.
2. Add a \`migrations\` entry whose \`from\` is the \`version\` THIS FILE HAD before your edit and whose
   \`to\` is the \`version\` you just wrote. Both are semver strings — NOT \`schemaVersion\`, NOT "1"/"2".
   A migration whose \`from\` does not equal the previous \`version\` never runs, and nothing tells
   anyone: the records simply stay in the old shape.

\`\`\`ts
version: "1.1.0",        // was "1.0.0"
schemaVersion: 2,        // was 1
migrations: [
  {
    from: "1.0.0",
    to: "1.1.0",
    steps: [
      { op: "addRelation", entity: "todo", field: "list", to: "list" },
      { op: "setDefaultForExisting", entity: "todo", field: "done", value: false },
    ],
  },
],
\`\`\`

3. The steps, with their EXACT keys. A step names its operation with \`op\` — NOT \`type\`, which is
   the key every FIELD uses and is wrong here. There is no other op:
   - \`{ op: "addField", entity, field, default? }\`
   - \`{ op: "dropField", entity, field }\`
   - \`{ op: "renameField", entity, from, to }\`
   - \`{ op: "changeType", entity, field, to, via: (value) => newValue }\`
   - \`{ op: "renameEntity", from, to }\`
   - \`{ op: "setDefaultForExisting", entity, field, value }\`
   - \`{ op: "addRelation", entity, field, to, many? }\`
   - \`{ transform: (record, ctx) => record }\` for anything the ops above cannot express
4. A NEW entity needs NO step. It has no records yet. What needs a step is a change to an entity
   that already exists — a new field or relation on it, or a rename.
5. Do not make a new relation \`required\` unless the migration gives every existing record a value.
6. Keep a way to SEE the existing records. Moving every item inside a new grouping page hides every
   record that has no group yet. If you add grouping, either give existing records a default group in
   the migration, or keep a page that lists everything ungrouped.
- \`ctx.params\` — view/route params
- \`ctx.storage\` — \`get\`/\`set\`/\`delete\`/\`keys\` (all async, app-scoped key/value)
- \`ctx.caps\` — native capabilities. EVERY ONE IS OPTIONAL and may be undefined when not granted, so
  guard before use: \`if (!ctx.caps.geo) { ctx.ui.toast("Location unavailable"); return; }\`
    \`ctx.caps.geo.current()\`            → { lat, lng }        (the key is \`geo\`, NOT \`geolocation\`)
    \`ctx.caps.camera.capture(opts?)\`    → Blob  (then \`await ctx.media.put(blob)\` for a media field)
    \`ctx.caps.notifications.schedule({ id, at, title, body? })\`
    \`ctx.caps.filesystem.pick()\` / \`.save(name, blob)\`, \`ctx.caps.haptics\`, \`ctx.caps.network\`
  Declare what the app needs at the top level: \`permissions: { geo: true, camera: true }\`.
- \`ctx.media\` — \`put(blob)\`, \`url(ref)\`
- \`ctx.ui\` — \`toast(msg)\`, \`await confirm(msg, { ok, destructive })\`, \`await prompt(msg)\`, \`await pick(items)\`,
  \`await sheet({ title, items: [{ id, label, detail, destructive }] })\` / \`menu(...)\` for a short choice,
  \`await form({ title, fields: { kg: { type: "number", unit: "kg" } }, initial, submit })\` when an action needs
  several values (null = cancelled), \`progress(label)\` → \`{ update(0..1), done() }\`. Nothing else — no \`alert\`.
- \`ctx.navigate(pageId, params?)\`, \`ctx.log(...)\`
Because reads are async, a computed that queries other records MUST be \`async\` and \`await\` the call.
- A page has \`id\`, \`title\`, and a \`view\` — or a \`layout\` of several views (\`PageLayout\` in the
  REFERENCE): \`{ type: "grid", items: [{ title: "Due", span: 1, view: {...} }, { title: "Overdue", span: 2,
  view: {...} }] }\`. Use a grid for a home page that shows figures, a short list and a calendar at
  once; a \`split\` (a list, then its \`detail\`) so a wide screen shows the record beside the list; \`tabs\`
  for "Active / Done" inside one page. The view types and every option each accepts are the \`View\`
  union in the REFERENCE. Omitting a required option fails validation. A \`display.primary\`/\`secondary\`
  binding is a field-key string OR a function \`(r) => ...\`.
- \`table\` columns live under \`display.columns\`, not at the top level. A \`map\` view's \`geo\` is the KEY
  of a \`geo\` field (a string, not a function): \`{ type: "map", entity: "place", geo: "location", title: "name" }\`.
- Give a map \`onOpen\` so tapping a pin opens that record's detail page; without it a pin only shows its
  \`title\` in a popup. Tapping EMPTY map always starts a new record with the geo field pre-filled, so no
  separate "add here" affordance is needed. \`camera\` (see \`MapCamera\`) says where the map opens.
- Prefer \`group\` (+ \`collapsible\`) to a filter chip when people want every group at once.
- Filter chips (list/map \`filters\`, see \`FilterChip\`): \`from\` names an enum/tags field OR an entity
  (record chips — one per record, param = selected ids); \`type: "boolean"\` is a toggle; \`type: "geo"\` a
  "near me" button. Read the chosen value in the view's \`filter\` via \`ctx.params[param]\`. Params are
  per page — a chip on one page does not filter another.
- Every field/computed referenced by a view must exist on that entity.
- A \`custom\` view is a REACT COMPONENT — write JSX (the file is compiled as .tsx). Import hooks with
  \`import { useState, useEffect } from "react"\`. React is NOT on \`props\`, NOT on \`runtime\`, and NOT a
  global: \`props.runtime.React\` and \`globalThis.React\` DO NOT EXIST. Never invent UI helpers —
  \`ctx.ui.stack/panel/header/checkboxRow/tick\` do not exist, and returning a \`{ kind: "..." }\` object
  instead of JSX renders nothing.
  \`props\` is \`{ runtime, entity, options, param, navigate }\`. From \`runtime\`:
  \`runtime.useQuery(entity, spec?)\` -> \`{ rows, loading }\`, \`runtime.useRecord(entity, id)\` ->
  \`{ record, loading }\`, \`runtime.create/patch/remove\`, \`runtime.runAction(entity, key, id)\`, and the
  full host surface at \`runtime.ctx\`. Read a route param via \`props.param\`.
  \`render\` is SYNCHRONOUS and MUST return JSX; do async work in \`useEffect\`, never in the body.
  Prefer a built-in view unless the ask genuinely needs bespoke interaction. There is NO chart/graph
  view type — do not invent one; build it from JSX (e.g. sized \`div\`s) inside a custom view.

NAVIGATION & UX (make the app actually usable — this matters as much as the data model)
- Give every entity a \`label\` and an \`icon\` (a single emoji), and the app itself a top-level \`icon\`
  (one emoji) — it is the app's launcher tile. Give each page an \`icon\` too (one emoji, distinct
  per page): pages are a tab bar on a phone, and four identical icons say nothing.
- Order a detail page's \`actions\` with the one people came for FIRST: it is the page's one filled
  button; the rest sit beside it, plain. Edit and Delete are the shell's, behind "More actions".
- Money is \`{ type: "money", currency: "EUR" }\` — whole minor units (\`4200\` is €42.00), never a
  float; lists total it. Split with \`splitEvenly(total, people)\` from \`potyro\`.
- Give a number field its \`unit\` (\`unit: "kg"\`, \`"min"\`, \`"days"\`) and \`integer: true\` when
  it counts things; the form shows the unit inside the field and a − / + stepper, and the phone opens
  the matching keyboard. A \`duration\` field's \`unit\` says what the stored number is (\`"min"\`, \`"h"\`).
- Arrange an entity's fields with \`groups: [{ title, fields: [...] }]\` when it has more than four:
  the form and the detail page show the same titled sections (a group may list computed keys — they
  show on the detail page, headed by the computed's \`label\`). Add \`collapsed: true\` to a long, secondary group. Give a field a one-line
  \`help\` when its name does not say what to enter, a \`placeholder\` with an example value for free
  text, and \`width: "half"\` to two short neighbours (a date and a number) so they share a row.
- Records with a stage or status (tasks, applications, "want to try / tried") want a \`board\` page:
  \`{ type: "board", entity, column: "<enum field>" }\`.
- Records read back by when (a journal, a workout or care log) want a \`timeline\` page:
  \`{ type: "timeline", entity, date: "<datetime field>", groupBy: "week", color: "<enum field>" }\`.
- "How am I doing" numbers (this week vs last, totals over time) are a page \`layout\` stacking a \`stats\`
  view and a \`chart\` view; both fold the page's rows in functions.
- A list of things to tick — shopping, packing, chores, habits — is a \`checklist\` page, never a list
  whose rows open a form to flip a boolean: \`{ type: "checklist", entity: "item", done: "bought",
  text: "name", detail: "quantity", group: "aisle", hideDone: "collapse", quickAdd: true, onOpen: {...} }\`.
  \`done\` is a boolean field (or an enum plus \`doneValue\`); \`quickAdd\` adds the typed text as the
  display field. Keep the detail page for the rest of the fields.
- Make exactly ONE top-level LIST page per entity (title = plural, e.g. "Sessions"). NEVER add a
  separate top-level page for a single record (no "Session" tab next to "Sessions").
- To show a record's details, add a \`detail\` page, mark it \`hidden: true\`, and link the list to it with
  \`onOpen: { page: "<detailPageId>", param: { <detailParam>: "id" } }\`. Rows are then tappable to
  open + edit — this is how users edit existing records.
- Add \`quickActions\` for the main create flows: \`{ id, label, icon, entity, open: true }\`. If the
  entity's ONLY required field is a single enum (a "type"/"day"), add \`mode: "menu"\` to pick it inline;
  otherwise the shell opens the create form. \`open: true\` lands the user in the new record.
- Set top-level \`nav: "grid"\` when the app has 3+ entities (an object-grid home); otherwise omit it.
- When one entity is what everything else belongs to (a trip and its places/events/expenses, a project
  and its tasks), declare \`scope: { entity: "trip", required: true }\`. The shell then shows the current
  trip in the header with a picker, and every function reads it synchronously as \`ctx.scope.trip\`.
  Narrow each page yourself: \`filter: (e, ctx) => e.trip?.id === ctx.scope.trip?.id\`. Options typed
  \`Dynamic<T>\` in the REFERENCE — a page \`title\`, a list's \`emptyText\`, an aggregate's \`title\`, the
  map \`camera\` — may be a function of ctx: \`title: (ctx) => \\\`Places in \${ctx.scope.trip?.city}\\\`\`,
  \`camera: (ctx) => ctx.scope.trip?.location ? { center: [lng, lat], zoom: 11 } : "fit"\`. \`sort\` receives
  ctx as its THIRD argument: \`(a, b, ctx) => ...\`. A relation to the scoped entity defaults to the current
  selection on create. Do NOT reach for \`ctx.params\` (per page) or \`ctx.storage\` (async) for this.
- Do NOT expose sub-records (e.g. a session's individual sets) as their own top-level tab — model them
  as a nested \`list\` field or reach them from the parent's detail.
- Provide entity \`actions\` for common per-record operations (e.g. mark done, log a set, water plant).

SIZE BUDGET — build the SMALLEST app that answers the ask. Measured: without this section the
generator turned a two-line request into 4 entities / 17 fields; with it, the same corpus produced
132-line apps instead of 369-line ones at the same correctness. A user can always add more later;
every field they did not ask for is a form they scroll past on every single entry.
- Default to ONE entity. Add a second only if the request clearly involves two distinct things the
  person manages separately (e.g. clients AND time entries). Three is almost always too many.
- Aim for at most 6 fields per entity. Include a field only if the request implies it. Do NOT add
  rating/notes/tags/photo/priority "for completeness" — omitting a field is better than guessing it.
- Aim for at most 3 pages: one list per entity plus its hidden detail. Add a third only if the ask
  names a genuinely separate screen.
- At most 2 actions per entity, for the obvious one-tap operations only.
- Prefer a BUILT-IN view. Reach for \`custom\` only when the ask truly cannot be served by
  list/gallery/table/detail/calendar/map — not merely because bespoke would be nicer.
- If the request is ambiguous, choose the smaller reading.

OUTPUT
- Return ONLY the \`.app.ts\` source in a single \`\`\`ts code block. No prose before or after.
- Unless one answer would change which app to build: then reply with one line \`QUESTION: <it, in plain words>\`. One question at a time; never once the request holds the answer.

EXAMPLE 1 — a simple list:
\`\`\`ts
${EXAMPLE_TODO}
\`\`\`

EXAMPLE 2 — a computed value used in a display binding:
\`\`\`ts
${EXAMPLE_COMPUTED}
\`\`\`

EXAMPLE 3 — a custom view: a real React component, in the same file, with hooks imported from "react":
\`\`\`ts
${EXAMPLE_CUSTOM_VIEW}
\`\`\``;
}

/** The contract every cloud and CLI backend teaches: judgement rules + the schema, verbatim. */
export const SYSTEM_PROMPT = assembleSystemPrompt(fullReferenceSection());

/** The same contract with the compact, validator-derived reference — for small on-device models. */
export const SYSTEM_PROMPT_COMPACT = assembleSystemPrompt(compactReferenceSection());


/** The create turn. A non-English `prompt.language` adds one line (#301); English is unchanged. */
export function buildUserMessage(prompt: GenPrompt): string {
  const message = `Create a Potyro app for this request:\n\n"${prompt.description}"\n\nReturn only the .app.ts source in one \`\`\`ts block.`;
  const language = createLanguageInstruction(prompt.language);
  return language ? `${message}\n\n${language}` : message;
}

/**
 * Opens a modify exchange, in place of the generate turn's "Create a Potyro app for this request".
 *
 * The app being edited is not an answer to the edit being asked for. Opening with the generate
 * framing says the app to write is the one described BY the change, which makes the real source in
 * the next turn read as a wrong answer to be replaced — and a model that follows instructions
 * literally does exactly that, returning a brand-new app instead of an edited one.
 */
export function buildModifyOpener(): string {
  return [
    "Here is the current Potyro app. It is the app the user already has and wants to keep.",
    "You will be asked to change it — edit this source, do not replace it with a different app.",
  ].join("\n");
}

/**
 * The marker a reply uses to say the request is not the app module's to fix.
 *
 * Only counts at the start of a line, so prose that merely mentions it ("I considered whether this
 * was NOT-IN-APP") is not mistaken for the verdict.
 */
export const NOT_IN_APP = "NOT-IN-APP:";

/** What the agent may be told about where the change was aimed. */
export interface ModifyContext {
  /** The view the user pointed at, and what it can actually declare. */
  target?: {
    viewType: string;
    pageTitle?: string;
    /** From `VIEW_FIELDS` (derived from the Zod schema, so it cannot drift from what is enforced). */
    fields: readonly string[];
    /** From `PAGE_FIELDS` - what the PAGE can declare, as opposed to its view. */
    pageFields?: readonly string[];
  };
  /**
   * The part of the app the person pointed at while asking (#284): what it is, in words, and where it
   * is in the source already shown — a few lines of it, never the app a second time.
   */
  pointedAt?: {
    words: string;
    /** 1-based, inclusive: the lines of the app above that hold it. */
    lines?: readonly [number, number];
    excerpt?: string;
  };
  /** Edits already attempted on this app, newest first. */
  priorAttempts?: readonly string[];
  /** Requests already answered as host-side, so the same verdict is not re-derived. */
  priorDiagnoses?: readonly string[];
  /** Which language to reply in, and which the app's words are in (#301). Nothing is added for English. */
  language?: TurnLanguage;
}

/** Either an edit (possibly partial, with the undone parts named), or a reasoned refusal to make one. */
export type ModifyReply =
  | { kind: "source"; source: string; rationale?: string; notDone?: string[] }
  | { kind: "diagnosis"; text: string };

/** The heading a reply uses to name the parts of a request it did not do (the ladder's third rung). */
export const NOT_DONE = "Not done:";

/**
 * The bullet lines under a `Not done:` heading in the prose — the parts of the request the edits do
 * not cover, each naming what would be needed. Tolerates markdown dressing (`**Not done:**`, `*`/`•`/
 * numbered bullets) because that is how models write headings; stops at the first line that is not
 * a bullet. Empty when there is no heading.
 */
export function parseNotDone(prose: string): string[] {
  const heading = new RegExp(`^[\\s*_\`#]*${NOT_DONE}[\\s*_\`]*$`, "im").exec(prose);
  if (!heading) return [];
  const rest = prose.slice(heading.index + heading[0].length).split("\n");
  const items: string[] = [];
  for (const line of rest) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/.exec(line);
    if (!m) {
      if (items.length === 0 && line.trim() === "") continue; // a blank line right after the heading
      break;
    }
    items.push(m[1]!);
  }
  return items;
}

/**
 * The Edit-mode prompt.
 *
 * Its job is to make "this isn't the app's to fix" a REPRESENTABLE answer. When updated source is
 * the only legal reply, a request the module cannot express comes back as a confident edit to
 * whatever function looked closest, and each attempt's rationalisation becomes the next attempt's
 * premise.
 */
export function buildModifyMessage(instruction: string, ctx?: ModifyContext): string {
  const lines: string[] = [
    "Apply this change to the app above, keeping everything else intact:",
    "",
    `"${instruction}"`,
    "",
  ];

  if (ctx?.pointedAt) {
    const p = ctx.pointedAt;
    lines.push(`They pointed at ${p.words} while asking — "this", "here" and "it" mean that part.`);
    if (p.lines && p.excerpt) {
      lines.push(`In the app above it is lines ${p.lines[0]}–${p.lines[1]} (repeated here only to show where; edit the app above):`, "```ts", p.excerpt, "```");
    }
    lines.push("");
  }

  if (ctx?.target) {
    const t = ctx.target;
    const where = t.pageTitle ? `the "${t.pageTitle}" page` : `this ${t.viewType} view`;
    lines.push(
      `The change was aimed at ${where}, a built-in "${t.viewType}" view.`,
      `Everything that view can declare: ${t.fields.join(", ")}.`,
    );
    if (t.pageFields?.length) lines.push(`Everything its page can declare: ${t.pageFields.join(", ")}.`);
    lines.push(
      "Anything outside those lists belongs to the host view, not to this app - the app cannot reach it.",
      "",
    );
  }

  if (ctx?.priorAttempts?.length) {
    lines.push(
      "These edits were already applied and did NOT work:",
      ...ctx.priorAttempts.map((a) => `- ${a}`),
      "Do not propose the same lever a third time; if it was the right lever it would have worked.",
      "",
    );
  }

  if (ctx?.priorDiagnoses?.length) {
    lines.push("Already reported as host-side for this app:", ...ctx.priorDiagnoses.map((d) => `- ${d}`), "");
  }

  lines.push(
    "Work down this ladder and stop at the first rung that fits:",
    "1. Declare it with the built-in views and options in the REFERENCE. Before deciding an option is missing,",
    "   find the type it would live on and read its declaration.",
    "2. If no built-in option fits, use a `custom` view — a React component in this file. This app is the",
    "   person's own and runs trusted, so a custom view is a legitimate answer here; the size-budget rule",
    "   against custom views is for creating new apps, not for meeting a request on an existing one.",
    "3. If only PART of the request can be done, do that part. Then, still in the prose before the block, add:",
    `   ${NOT_DONE}`,
    "   - <the part you did not do>, because <the declaration or host behaviour it would need>",
    "   one bullet per part. Never refuse a request because one part of it cannot be done.",
    `4. Only if NO part can be done: \`${NOT_IN_APP} <which host behaviour is responsible, and what would have to`,
    "   change there>\` - and no code.",
    "",
    "Edits are SEARCH/REPLACE blocks against the app above, in one ```ts block:",
    "",
    EDIT_FORMAT,
    "",
    "A plausible edit that cannot possibly work is worse than a Not done line, because it is indistinguishable",
    "from a fix until someone tries it. A refusal of a request you could mostly do is worse than both.",
    "",
    "The OUTPUT rule in the system prompt (the whole file, no prose) does not apply to this reply: it is for",
    "creating an app. Here, send edits, and put your reasoning in the prose before the block. Do NOT write",
    'comments that assert a cause ("// the map ignores this") - a causal claim in a comment is unverifiable and',
    "the next edit reads it as fact.",
  );

  const language = changeLanguageInstruction(ctx?.language);
  if (language) lines.push("", language);

  return lines.join("\n");
}

/**
 * Read a reply as either an edit or a diagnosis.
 *
 * A diagnosis WINS over code the model attached anyway: models habitually ship a patch while
 * explaining that the patch cannot help, and acting on source the model has just disowned is
 * precisely the failure this contract exists to prevent.
 */
/** Attach the `Not done:` parts found in a source reply's rationale; no key at all when there are none. */
export function withNotDone<T extends { rationale?: string }>(reply: T): T & { notDone?: string[] } {
  const notDone = reply.rationale ? parseNotDone(reply.rationale) : [];
  return notDone.length ? { ...reply, notDone } : reply;
}

export function parseModifyReply(reply: string): ModifyReply {
  // The marker may arrive dressed up: a model that has just written three paragraphs of reasoning
  // tends to present its verdict as `` `NOT-IN-APP: …` `` or **NOT-IN-APP: …**. A measured DeepSeek
  // reply did exactly that, and a strict line-start match handed the whole essay to the bundler as
  // source. Tolerate leading backticks/asterisks (and drop a matching trailing one), but still
  // require the marker to open its line, so prose that merely mentions it is not a verdict.
  const marker = new RegExp(`^[\`*\\s]*${NOT_IN_APP}`, "m").exec(reply);
  if (marker) {
    const after = reply.slice(marker.index + marker[0].length);
    // Stop at any code fence, so a disowned patch never leaks into the explanation.
    const text = after.split(/^```/m)[0]!.trim().replace(/[\`*]+$/, "").trim();
    return { kind: "diagnosis", text };
  }

  // Any language tag, not just `ts` — see `fencedBlocks`. A ```tsx reply used to fall through to
  // the branch below and hand the model's prose to the bundler.
  const block = pickAppBlock(fencedBlocks(reply));
  if (block) {
    const rationale = reply.slice(0, block.index).trim();
    // Reasoning belongs in the version's rationale, not in source comments (docs/04).
    return withNotDone(rationale ? { kind: "source" as const, source: block.code, rationale } : { kind: "source" as const, source: block.code });
  }
  return { kind: "source", source: reply.trim() };
}

export function buildRepairMessage(errors: string[]): string {
  return [
    "The app you produced failed these checks:",
    ...errors.map((e) => `- ${e}`),
    "",
    "Return a corrected, complete .app.ts (the whole file, not a diff) in one code block.",
  ].join("\n");
}

/**
 * The instruction a REPAIR round hands to `guardedModify`, so a repair is a modify: same edit
 * format, same no-match and loss retries, same gate. `buildRepairMessage` above is the older
 * whole-file contract and is kept only for `ModelBackend.repair()` in the generate harness, where a
 * freshly generated app has no person's file to protect.
 */
export function buildRepairInstruction(issues: string[]): string {
  return [
    "The app failed these checks:",
    ...issues.map((i) => `- ${i}`),
    "",
    "Fix exactly these problems and nothing else. Do not change behaviour the checks did not mention.",
  ].join("\n");
}

/** Pull the app source out of a model reply — strips a ```ts / ``` code fence if present. */
/**
 * Every fenced block in a reply, with where it started.
 *
 * The language tag is captured and IGNORED. The previous version accepted only `ts` and
 * `typescript`, so a reply fenced ```` ```tsx ```` — which is what a model reaches for the moment an
 * app has a custom view, and what the bundler itself calls the file — matched nothing. The whole
 * reply, prose and fence markers included, then went to esbuild, which reported a syntax error in
 * the middle of an English sentence: `Expected ";" but found ":"`. Unreadable, and nothing about it
 * suggested the real problem.
 *
 * The closing fence is optional so a truncated reply still yields the code it managed to produce.
 */
function fencedBlocks(text: string): Array<{ code: string; index: number }> {
  const out: Array<{ code: string; index: number }> = [];
  const re = /```([A-Za-z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;
  for (const m of text.matchAll(re)) out.push({ code: m[2]!.trim(), index: m.index ?? 0 });
  return out;
}

/**
 * The block that is actually the app module.
 *
 * A reply may contain several: a snippet illustrating the change, then the whole file. Preferring
 * blocks that contain `defineApp(` picks the file rather than the illustration, and the longest of
 * those settles it when a model shows the app twice.
 */
function pickAppBlock(blocks: Array<{ code: string; index: number }>): { code: string; index: number } | null {
  const real = blocks.filter((b) => /defineApp\s*\(/.test(b.code));
  const pool = real.length ? real : blocks;
  return pool.length ? pool.reduce((a, b) => (b.code.length > a.code.length ? b : a)) : null;
}

/**
 * The question a create reply asks instead of building (#261), or null when it built — or talked.
 *
 * Only a reply that is not an app, and only when the reply OPENS with the marker, so a comment in the
 * source or prose that mentions questions is never mistaken for one. Models dress markers in bold or
 * backticks; that is read through. The question is the first line.
 */
export function questionIn(reply: string): string | null {
  if (looksLikeApp(reply)) return null;
  // Some models put everything they send in a code block, a question included.
  const opened = reply.trim().replace(/^```[\w-]*[ \t]*\n/, "");
  const m = /^[\s*`_]*QUESTION:[*`_]*[ \t]*([^\n]*?)[\s*`_]*(?:\n|$)/.exec(opened);
  return m && m[1]!.trim() ? m[1]!.trim() : null;
}

/** Does this look like an app module at all, or did the model just talk? */
export function looksLikeApp(source: string): boolean {
  return /defineApp\s*\(/.test(source);
}

export function extractSource(text: string): string {
  return (pickAppBlock(fencedBlocks(text))?.code ?? text).trim();
}
