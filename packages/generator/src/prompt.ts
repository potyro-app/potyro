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
- A page has \`id\`, \`title\`, and a \`view\`. View \`type\` is one of: list, gallery, table, detail, calendar,
  map, custom. A \`display.primary\`/\`secondary\` binding is a field-key string OR a function \`(r) => ...\`.
- Every field/computed referenced by a view must exist on that entity.

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

OUTPUT
- Return ONLY the \`.app.ts\` source in a single \`\`\`ts code block. No prose before or after.

EXAMPLE 1 — a simple list:
\`\`\`ts
${EXAMPLE_TODO}
\`\`\`

EXAMPLE 2 — a computed value used in a display binding:
\`\`\`ts
${EXAMPLE_COMPUTED}
\`\`\``;

export function buildUserMessage(prompt: GenPrompt): string {
  return `Create a Karta app for this request:\n\n"${prompt.description}"\n\nReturn only the .app.ts source in one \`\`\`ts block.`;
}

export function buildModifyMessage(instruction: string): string {
  return [
    "Apply this change to the app above, keeping everything else intact:",
    "",
    `"${instruction}"`,
    "",
    "Return the complete updated .app.ts (the whole file, not a diff) in one ```ts block.",
  ].join("\n");
}

export function buildRepairMessage(errors: string[]): string {
  return [
    "The app you produced failed these checks:",
    ...errors.map((e) => `- ${e}`),
    "",
    "Return a corrected, complete .app.ts (the whole file, not a diff) in one ```ts block.",
  ].join("\n");
}

/** Pull the app source out of a model reply — strips a ```ts / ``` code fence if present. */
export function extractSource(text: string): string {
  const fence = text.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  return (fence ? fence[1]! : text).trim();
}
