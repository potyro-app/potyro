// What the model can DISCOVER, as opposed to what it is told (#131).
//
// A developer who does not know whether `camera` accepts a function writes it and reads the error.
// These tools give the model that loop: `lookup` returns the real declaration from the schema
// reference (the same text the system prompt carries, so nothing here can disagree with it),
// `check` runs a candidate through the real bundler and validator, and `example` returns the
// few-shot app that uses a feature. A refusal is only worth anything after these have been used —
// `runModifyLoop` enforces that; this module only makes it possible.

import { SCHEMA_REFERENCE } from "../reference.generated.js";
import { EXAMPLE_COMPUTED, EXAMPLE_CUSTOM_VIEW, EXAMPLE_TODO } from "../prompt.js";
import { VIEW_FIELDS } from "karta";
import type { AgentTool } from "./tools.js";

interface Declaration {
  name: string;
  /** The doc comment (if any) and the declaration itself. */
  text: string;
}

// A top-level declaration: an optional doc comment, then `export interface X { … }` closed by a
// brace at column 0 (nested object types are indented), or `export type X = …;`.
const DECLARATION = /(\/\*\*[\s\S]*?\*\/\n)?export (?:interface|type) (\w+)\b[^\n]*(?:\n[\s\S]*?\n\}|[^;]*;)/g;

function declarations(reference: string): Declaration[] {
  const out: Declaration[] = [];
  for (const m of reference.matchAll(DECLARATION)) out.push({ name: m[2]!, text: m[0] });
  return out;
}

const MAX_CHARS = 6000;

/**
 * The declarations that answer a query: a type by name, the interfaces that declare a property of
 * that name, a view type by its short name (`map` → `MapView` plus what the validator accepts), or
 * `ctx.<member>`. Plain text the model can quote; a clear "nothing declares it" when there is none,
 * so a refusal can cite this rather than an assumption.
 */
export function lookupReference(reference: string, rawQuery: string): string {
  const query = rawQuery.trim().replace(/^ctx\./i, "").replace(/[?:]+$/, "");
  if (!query) return "Ask for a type name (MapView, Ctx, FilterChip), a property (camera, scope) or a view type (map, list).";
  const decls = declarations(reference);
  const lower = query.toLowerCase();
  const byName = decls.filter((d) => d.name.toLowerCase() === lower);
  const viewType = VIEW_FIELDS[lower] ? decls.filter((d) => d.name.toLowerCase() === `${lower}view`) : [];
  const propertyRe = new RegExp(`^\\s*(?:readonly\\s+)?${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\??\\s*[:(]`, "im");
  const byProperty = decls.filter((d) => propertyRe.test(d.text));
  const byPartialName = decls.filter((d) => d.name.toLowerCase().includes(lower) && d.name.toLowerCase() !== lower);

  const picked: Declaration[] = [];
  for (const d of [...byName, ...viewType, ...byProperty, ...byPartialName]) {
    if (!picked.includes(d)) picked.push(d);
    if (picked.length >= 4) break;
  }
  if (!picked.length) {
    return (
      `Nothing in the karta module is called "${query}" or declares a "${query}". It does not exist. ` +
      `If the request needs it, say so with NOT-IN-APP and quote this; if a different name might, look that up.`
    );
  }
  const parts = picked.map((d) => d.text.trim());
  if (VIEW_FIELDS[lower]) parts.unshift(`\`${lower}\` view — what the validator accepts: ${VIEW_FIELDS[lower]!.join(", ")}`);
  let text = parts.join("\n\n");
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n… (truncated; ask for a more specific name)`;
  return text;
}

export interface DiscoveryDeps {
  /** Bundle + validate a candidate; the validator's issues, empty when it is a well-formed app. Throws when it does not compile. */
  check: (source: string) => Promise<string[]>;
}

const EXAMPLES: ReadonlyArray<{ title: string; source: string }> = [
  { title: "a simple list (todo)", source: EXAMPLE_TODO },
  { title: "computed values, icons, quickActions, list → hidden detail", source: EXAMPLE_COMPUTED },
  { title: "a custom view (React component in the app file)", source: EXAMPLE_CUSTOM_VIEW },
];

export function buildDiscoveryTools(deps: DiscoveryDeps): AgentTool[] {
  return [
    {
      name: "lookup",
      description:
        "Read the real declaration of a type, a property or a view type from the karta module — the same text as the REFERENCE in your instructions, " +
        "found for you. Use it BEFORE deciding an option does not exist: lookup(\"MapView\"), lookup(\"camera\"), lookup(\"map\"), lookup(\"ctx.scope\"). " +
        "If it answers that nothing declares it, that is the fact to quote in a NOT-IN-APP.",
      parameters: { type: "object", properties: { query: { type: "string", description: "A type name, property name, view type, or ctx.<member>" } }, required: ["query"] },
      run: async (args) => ({ ok: true, detail: lookupReference(SCHEMA_REFERENCE, String(args.query ?? "")) }),
    },
    {
      name: "check",
      description:
        "Bundle and validate a complete candidate .app.ts source and return the validator's own issues, or that it validates. " +
        "Use it to TRY an option you are unsure of instead of guessing. The edits you finally send are checked the same way automatically.",
      parameters: { type: "object", properties: { source: { type: "string", description: "The complete app source to check" } }, required: ["source"] },
      run: async (args) => {
        try {
          const issues = await deps.check(String(args.source ?? ""));
          return issues.length ? { ok: false, detail: issues.map((i) => `- ${i}`).join("\n") } : { ok: true, detail: "ok: it compiles and validates." };
        } catch (e) {
          return { ok: false, detail: `does not compile: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    },
    {
      name: "example",
      description: "A complete example app that uses a feature (quickActions, computed, custom view, onOpen, actions…), to copy the shape from.",
      parameters: { type: "object", properties: { feature: { type: "string" } }, required: ["feature"] },
      run: async (args) => {
        const feature = String(args.feature ?? "").trim();
        const hit = EXAMPLES.find((e) => feature && e.source.includes(feature));
        if (!hit) return { ok: false, detail: `No example uses "${feature}". Look its declaration up instead.` };
        return { ok: true, detail: `${hit.title}:\n\`\`\`ts\n${hit.source}\n\`\`\`` };
      },
    },
  ];
}
