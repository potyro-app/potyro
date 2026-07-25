// Prompt assembly for the cloud generator (KA-05): the system prompt teaches the `defineApp`
// contract with a couple of few-shot examples, and the user/repair messages frame each request.
// Kept pure + exported so the assembly is unit-testable without any model call.

import type { GenPrompt } from "./backend.js";

const EXAMPLE_TODO = `import { defineApp } from "karta";

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

const EXAMPLE_COMPUTED = `import { defineApp } from "karta";

export default defineApp({
  id: "books",
  name: "Books",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
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
      id: "all",
      title: "Books",
      view: { type: "list", entity: "book", display: { primary: "title", secondary: (b) => \`\${b.percent}%\` } },
    },
  ],
});`;

export const SYSTEM_PROMPT = `You generate a single Karta app module (a \`.app.ts\` file) from a natural-language description.

CONTRACT
- The file default-exports \`defineApp({ ... })\` imported from "karta".
- Top-level: \`id\` (kebab-case), \`name\`, \`version\` ("1.0.0"), \`schemaVersion\` (1), \`entities\`, \`pages\`.
- An entity has \`label\`, \`displayField\`, \`fields\`, and optional \`computed\` / \`actions\`.
- Field \`type\` is one of: text, richtext, url, number, duration, boolean, datetime, enum (with \`options\`),
  tags (with \`options\`), media, geo, relation (with \`to\`), list (with \`of\`).
- Structure (entities/fields/view layout) is plain data. All LOGIC — computed, filters, sorts, actions,
  display bindings — is ordinary TypeScript functions that receive the record (and \`ctx\`). There is NO
  expression language; write real functions.
- A page has \`id\`, \`title\`, and a \`view\`. View \`type\` is one of: list, gallery, table, detail, calendar,
  map, custom. A \`display.primary\`/\`secondary\` binding is a field-key string OR a function \`(r) => ...\`.
- Every field/computed referenced by a view must exist on that entity.

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
