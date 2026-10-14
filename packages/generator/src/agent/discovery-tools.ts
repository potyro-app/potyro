// What the model can DISCOVER, as opposed to what it is told (#131).
//
// A developer who does not know whether `camera` accepts a function writes it and reads the error.
// These tools give the model that loop: `lookup` returns the real declaration from the schema
// reference (the same text the system prompt carries, so nothing here can disagree with it),
// `check` runs a candidate through the real bundler and validator, and `example` returns the
// few-shot app that uses a feature. A refusal is only worth anything after these have been used —
// `runModifyLoop` enforces that; this module only makes it possible.
//
// #262 added what a developer has beyond the declarations: `check` takes the edits the model would
// answer with (never a second copy of the app), applies them and also RUNS the result when the caller
// can (`run`), so a computed that throws or a page that shows nothing comes back as words;
// and `search_corpus` / `read` open the release's corpus — the example apps, the personal apps, the
// API docs and the schema types — so the model can see how a real app puts the parts together.

import { SCHEMA_REFERENCE } from "../reference.generated.js";
import { exampleFromCorpus, readCorpus, searchCorpus, type Corpus } from "../corpus.js";
import { loadCorpus } from "../load-corpus.js";
import { describeRun, type RunGate } from "../run-report.js";
import { readEditsOrFile } from "../guarded-modify.js";
import { describeEditFailures } from "../edits.js";
import { EXAMPLE_COMPUTED, EXAMPLE_CUSTOM_VIEW, EXAMPLE_TODO } from "../prompt.js";
import { VIEW_FIELDS } from "potyro";
import type { AgentTool } from "./tools.js";
import { buildTranslateTool, type TranslationDraft } from "./translate-tool.js";
import { describeWordsReport, wordsReport } from "../source-words.js";

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
  // A type NAMED after the query ("scope" → ScopeDef) answers it before the big interfaces that only
  // hold a property of that name, which can fill the answer on their own (Ctx is ~4k characters).
  const byPrefix = byPartialName.filter((d) => d.name.toLowerCase().startsWith(lower));

  const picked: Declaration[] = [];
  for (const d of [...byName, ...viewType, ...byPrefix, ...byProperty, ...byPartialName]) {
    if (!picked.includes(d)) picked.push(d);
    if (picked.length >= 4) break;
  }
  if (!picked.length) {
    return (
      `Nothing in the potyro module is called "${query}" or declares a "${query}". It does not exist. ` +
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
  /** The app as first shown: what `check`'s edits are applied to (#262 — the app is in the conversation once). */
  source: string;
  /** Run a candidate that validates on sample records, against the app as first shown
   *  (`regressionGate`): what it broke, and what was already broken. Optional — without it `check`
   *  stops at the validator, as it did before #262. */
  run?: RunGate;
  /** The release's corpus. Defaults to the one shipped with this build, loaded on first use. */
  corpus?: () => Promise<Corpus>;
  /** With it, `translate` is offered, and `check`'s edits apply to the app it has written into (#302). */
  draft?: TranslationDraft;
}

const EXAMPLES: ReadonlyArray<{ title: string; source: string }> = [
  { title: "a simple list (todo)", source: EXAMPLE_TODO },
  { title: "computed values, icons, quickActions, list → hidden detail", source: EXAMPLE_COMPUTED },
  { title: "a custom view (React component in the app file)", source: EXAMPLE_CUSTOM_VIEW },
];

export function buildDiscoveryTools(deps: DiscoveryDeps): AgentTool[] {
  const corpus = deps.corpus ?? loadCorpus;
  return [
    {
      name: "lookup",
      description:
        "Read the real declaration of a type, a property or a view type from the potyro module — the same text as the REFERENCE in your instructions, " +
        "found for you. Use it BEFORE deciding an option does not exist: lookup(\"MapView\"), lookup(\"camera\"), lookup(\"map\"), lookup(\"ctx.scope\"). " +
        "If it answers that nothing declares it, that is the fact to quote in a NOT-IN-APP.",
      parameters: { type: "object", properties: { query: { type: "string", description: "A type name, property name, view type, or ctx.<member>" } }, required: ["query"] },
      run: async (args) => ({ ok: true, detail: lookupReference(SCHEMA_REFERENCE, String(args.query ?? "")) }),
    },
    {
      name: "check",
      description:
        "Try a change before sending it: SEARCH/REPLACE edits against the app as first shown — the same blocks you would answer with. " +
        "They are applied, bundled and validated" +
        (deps.run ? ", then the result is RUN on sample records and compared with the app as it was," : ",") +
        " and you get the validator's words or the run's — never the app back. Do NOT send the whole app: it is already here, once.",
      parameters: {
        type: "object",
        properties: { edits: { type: "string", description: "One or more <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks against the app as first shown" } },
        required: ["edits"],
      },
      run: async (args) => {
        const edits = String(args.edits ?? args.source ?? "");
        const read = readEditsOrFile(deps.draft?.source ?? deps.source, edits);
        if (read.kind === "whole-file") {
          return {
            ok: false,
            detail:
              "check takes SEARCH/REPLACE edits against the app as first shown, not the whole app — the app is already in this conversation. " +
              "Send the blocks you would answer with.",
          };
        }
        if (read.kind === "unusable") return { ok: false, detail: "That was not a set of SEARCH/REPLACE edits. Send the blocks you would answer with, against the app as first shown." };
        if (read.kind === "no-match") return { ok: false, detail: `The edits could not be applied to the app as first shown:\n${describeEditFailures(read.failures)}` };
        const applied = `${read.applied} edit${read.applied === 1 ? "" : "s"} applied to the app as first shown`;
        let issues: string[];
        try {
          issues = await deps.check(read.source);
        } catch (e) {
          return { ok: false, detail: `${applied}; the result does not compile: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (issues.length) return { ok: false, detail: `${applied}; the result fails validation:\n${issues.map((i) => `- ${i}`).join("\n")}` };
        // Translations kept in step (#302): a gap the edits add fails, like a validation issue.
        const words = describeWordsReport(await wordsReport(deps.source, read.source));
        const wordsLine = words.text ? `\n${words.text}` : "";
        if (words.fails) return { ok: false, detail: `${applied}; it compiles and validates, but${wordsLine}` };
        if (!deps.run) return { ok: true, detail: `${applied}; it compiles and validates.${wordsLine}` };
        const { report, preexisting } = await deps.run(read.source);
        return { ok: report.errors.length === 0, detail: `${applied}; it compiles and validates. ${describeRun(report, preexisting)}${wordsLine}` };
      },
    },
    {
      name: "example",
      description:
        "A real app that uses a feature (quickActions, computed, a custom view, onOpen, ctx.files…), to copy the shape from — " +
        "the smallest one in the examples and personal apps that uses it.",
      parameters: { type: "object", properties: { feature: { type: "string" } }, required: ["feature"] },
      run: async (args) => {
        const feature = String(args.feature ?? "").trim();
        const inline = EXAMPLES.find((e) => feature && e.source.includes(feature));
        if (inline) return { ok: true, detail: `${inline.title}:\n\`\`\`ts\n${inline.source}\n\`\`\`` };
        const found = feature ? exampleFromCorpus(await corpus(), feature) : undefined;
        if (found) return { ok: true, detail: found };
        return { ok: false, detail: `No app uses "${feature}". search_corpus for it, or look its declaration up.` };
      },
    },
    {
      name: "search_corpus",
      description:
        "Search this release's example apps, personal apps, API docs (docs/04, docs/05) and schema types for a few words, and get the " +
        "best passages with their file and lines. Use it to see how a real app does something before writing it: " +
        'search_corpus("custom view canvas"), search_corpus("ctx.files read json"), search_corpus("relation many detail").',
      parameters: { type: "object", properties: { query: { type: "string", description: "A few words: a feature, a ctx member, a field type" } }, required: ["query"] },
      run: async (args) => ({ ok: true, detail: searchCorpus(await corpus(), String(args.query ?? "")) }),
    },
    {
      name: "read",
      description: "Read a file from the corpus by its path (as search_corpus shows it), from a line. Long files come in pages; the answer says how to continue.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, line: { type: "number", description: "First line to show, 1-based (default 1)" } },
        required: ["path"],
      },
      run: async (args) => ({ ok: true, detail: readCorpus(await corpus(), String(args.path ?? ""), Number(args.line ?? 1)) }),
    },
    ...(deps.draft ? [buildTranslateTool({ draft: deps.draft, check: deps.check })] : []),
  ];
}
