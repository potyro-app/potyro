// Prompt assembly for the cloud generator (KA-05): the system prompt teaches the `defineApp`
// contract with a couple of few-shot examples, and the user/repair messages frame each request.
// Kept pure + exported so the assembly is unit-testable without any model call.

import type { GenPrompt } from "./backend.js";

export const EXAMPLE_TODO = `import { defineApp } from "karta";

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

export const EXAMPLE_COMPUTED = `import { defineApp } from "karta";

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

export const EXAMPLE_CUSTOM_VIEW = `import { defineApp, type ViewProps } from "karta";
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

export const SYSTEM_PROMPT = `You generate a single Karta app module (a \`.app.ts\` file) from a natural-language description.

CONTRACT
- The file default-exports \`defineApp({ ... })\` imported from "karta".
- Top-level: \`id\` (kebab-case), \`name\`, \`version\` ("1.0.0"), \`schemaVersion\` (1), \`entities\`, \`pages\`.
- An entity has \`label\`, \`displayField\`, \`fields\`, and optional \`computed\` / \`actions\`.
- Field \`type\` is one of: text, richtext, url, number, duration, boolean, datetime, enum (with \`options\`),
  tags (with \`options\`), media, geo, relation (with \`to\`), list (with \`of\`). There is NO "object" type.
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
    - \`datetime\` -> a real \`Date\` (call \`.getTime()\`, never compare strings).
    - \`media\` -> a \`MediaRef\`; render it through a media binding, do not read it as a URL.
    - text/number/boolean/enum/tags/geo/list read as written.
  When you WRITE one, do the opposite: store the id. \`ctx.patch("todo", t.id, { list: list.id })\`.
- \`computed\` entries are FUNCTIONS \`(record, ctx) => value\` (may be \`async\`).
- \`actions\` entries are BARE FUNCTIONS \`(record, ctx) => void | Promise<void>\` — NOT objects. Write
  \`actions: { water: async (plant, ctx) => { await ctx.patch("plant", plant.id, { ... }); } }\`.
  NEVER \`actions: { water: { label: "...", run: ... } }\`. A detail view lists action KEYS:
  \`actions: ["water", "repot"]\`.

THE \`ctx\` API — THIS IS THE COMPLETE SURFACE. Calling anything not on this list is a runtime crash.
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

So whenever you change \`entities\`:

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
- \`ctx.ui\` — \`toast(msg)\`, \`await confirm(msg)\`, \`await prompt(msg)\`, \`await pick(items, opts)\`
  (there is NOTHING else on \`ctx.ui\` — no \`openUrl\`, no \`alert\`)
- \`ctx.navigate(pageId, params?)\`, \`ctx.log(...)\`
Because reads are async, a computed that queries other records MUST be \`async\` and \`await\` the call.
- A page has \`id\`, \`title\`, and a \`view\`. View \`type\` is one of: list, gallery, table, detail, calendar,
  map, custom. A \`display.primary\`/\`secondary\` binding is a field-key string OR a function \`(r) => ...\`.
- EACH VIEW TYPE HAS REQUIRED OPTIONS — omitting one fails validation:
  \`list\`     { entity, display?: { primary, secondary?, media?, badges? }, sort?, filter?, onOpen?, emptyText? }
  \`gallery\`  same as list; \`display.media\` names a \`media\` field to show as the tile image
  \`table\`    { entity, display: { columns: string[] } }   — columns live under \`display\`, not top level
  \`detail\`   { entity, param, sections: [{ title?, fields: string[] }], actions?: string[] }
  \`calendar\` { entity, date: <REQUIRED binding to a datetime field>, title?, color? }
  \`map\`      { entity, geo: "<REQUIRED name of a geo field>", title?, color?, filters?, onOpen? }
             — give a map \`onOpen\` so tapping a pin opens that record's detail page; without it a
             pin only shows its \`title\` in a popup. Tapping EMPTY map always starts a new record
             with the geo field pre-filled, so no separate "add here" affordance is needed.
  \`custom\`   { entity, param?, render }
- A \`map\` view REQUIRES \`geo\` — the KEY of a \`geo\` field on that entity (a string, not a function):
  \`{ type: "map", entity: "place", geo: "location", title: "name" }\`
- Filter chips (list/map \`filters\`) are declarative: \`{ label, param, from: "<enum-or-tags field>", multi? }\`,
  or \`{ label, param, type: "boolean" }\`, or \`{ label, param, type: "geo" }\` for a "near me" button. Read the
  chosen value in the view's \`filter\` via \`ctx.params[param]\`.
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
- Give every entity a \`label\` and an \`icon\` (a single emoji).
- Make exactly ONE top-level LIST page per entity (title = plural, e.g. "Sessions"). NEVER add a
  separate top-level page for a single record (no "Session" tab next to "Sessions").
- To show a record's details, add a \`detail\` page, mark it \`hidden: true\`, and link the list to it with
  \`onOpen: { page: "<detailPageId>", param: { <detailParam>: "id" } }\`. Rows are then tappable to
  open + edit — this is how users edit existing records.
- Add \`quickActions\` for the main create flows: \`{ id, label, icon, entity, open: true }\`. If the
  entity's ONLY required field is a single enum (a "type"/"day"), add \`mode: "menu"\` to pick it inline;
  otherwise the shell opens the create form. \`open: true\` lands the user in the new record.
- Set top-level \`nav: "grid"\` when the app has 3+ entities (an object-grid home); otherwise omit it.
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


export function buildUserMessage(prompt: GenPrompt): string {
  return `Create a Karta app for this request:\n\n"${prompt.description}"\n\nReturn only the .app.ts source in one \`\`\`ts block.`;
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
  /** Edits already attempted on this app, newest first. */
  priorAttempts?: readonly string[];
  /** Requests already answered as host-side, so the same verdict is not re-derived. */
  priorDiagnoses?: readonly string[];
}

/** Either an edit, or a reasoned refusal to make one. */
export type ModifyReply =
  | { kind: "source"; source: string; rationale?: string }
  | { kind: "diagnosis"; text: string };

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
    "Reply with exactly one of:",
    "1. The complete updated .app.ts (the whole file, not a diff) in one ```ts block.",
    `2. \`${NOT_IN_APP} <which host behaviour is responsible, and what would have to change there>\` - and no code.`,
    "",
    "Answering (2) when it is true is cheap. A plausible edit that cannot possibly work is the more damaging mistake,",
    "because it is indistinguishable from a fix until someone tries it.",
    "",
    "Put your reasoning in the prose before the block. Do NOT write comments that assert a cause",
    '("// the map ignores this") - a causal claim in a comment is unverifiable and the next edit',
    "reads it as fact.",
  );

  return lines.join("\n");
}

/**
 * Read a reply as either an edit or a diagnosis.
 *
 * A diagnosis WINS over code the model attached anyway: models habitually ship a patch while
 * explaining that the patch cannot help, and acting on source the model has just disowned is
 * precisely the failure this contract exists to prevent.
 */
export function parseModifyReply(reply: string): ModifyReply {
  const marker = new RegExp(`^${NOT_IN_APP}`, "m").exec(reply);
  if (marker) {
    const after = reply.slice(marker.index + NOT_IN_APP.length);
    // Stop at any code fence, so a disowned patch never leaks into the explanation.
    const text = after.split(/^```/m)[0]!.trim();
    return { kind: "diagnosis", text };
  }

  // Any language tag, not just `ts` — see `fencedBlocks`. A ```tsx reply used to fall through to
  // the branch below and hand the model's prose to the bundler.
  const block = pickAppBlock(fencedBlocks(reply));
  if (block) {
    const rationale = reply.slice(0, block.index).trim();
    // Reasoning belongs in the version's rationale, not in source comments (docs/04).
    return rationale ? { kind: "source", source: block.code, rationale } : { kind: "source", source: block.code };
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

/** Does this look like an app module at all, or did the model just talk? */
export function looksLikeApp(source: string): boolean {
  return /defineApp\s*\(/.test(source);
}

export function extractSource(text: string): string {
  return (pickAppBlock(fencedBlocks(text))?.code ?? text).trim();
}
