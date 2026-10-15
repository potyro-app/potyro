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

import { CAPABILITY_REFERENCE, SCHEMA_REFERENCE } from "../reference.generated.js";
import { capabilityBlock, capabilityNamed, declarations, memberLine, type Declaration } from "../reference.js";
import { exampleFromCorpus, readCorpus, searchCorpus, type Corpus } from "../corpus.js";
import { loadCorpus } from "../load-corpus.js";
import { describeRun, runSafely, type RunGate, type RunReport } from "../run-report.js";
import { readEditsOrFile } from "../guarded-modify.js";
import { describeEditFailures } from "../edits.js";
import { EXAMPLE_COMPUTED, EXAMPLE_CUSTOM_VIEW, EXAMPLE_TODO, extractSource, looksLikeApp } from "../prompt.js";
import { VIEW_FIELDS } from "potyro";
import type { AgentTool } from "./tools.js";
import { buildTranslateTool, type TranslationDraft } from "./translate-tool.js";
import { describeWordsReport, wordsReport } from "../source-words.js";

/**
 * What `lookup` reads (#341): the core the system prompt carries AND every capability's declarations,
 * which the prompt only names. A capability that left the prompt is still one lookup away.
 */
export const LOOKUP_REFERENCE: string = [SCHEMA_REFERENCE, ...Object.values(CAPABILITY_REFERENCE)].join("\n\n");

const MAX_CHARS = 6000;

/** The names a member's type mentions that are declared (`Promise<LiveCamera>` → LiveCamera). */
function typesNamed(line: string, decls: readonly Declaration[]): Declaration[] {
  const names = new Set([...line.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]!));
  return decls.filter((d) => names.has(d.name));
}

/**
 * `ctx.caps.camera.live`, `ctx.files.import`, `ctx.ui.share`: walk from `Ctx`, member by member, to
 * the interface that declares the last one. Answers with that declaration (every interface of the
 * name — `CtxUi` is declared in the core and continued with `share`) and the types the member's
 * signature names, so `live` comes with `LiveCameraOptions` and `LiveCamera`. Null when the path
 * leaves the declarations, so the query falls back to the name and property search.
 */
function lookupPath(decls: readonly Declaration[], path: readonly string[]): Declaration[] | null {
  let hosts = decls.filter((d) => d.name === "Ctx");
  for (let i = 0; i < path.length; i += 1) {
    const re = memberLine(path[i]!);
    const host = hosts.find((d) => d.text.split("\n").some((l) => re.test(l)));
    if (!host) return null;
    const line = host.text.split("\n").find((l) => re.test(l))!;
    const named = typesNamed(line.replace(re, ""), decls);
    if (i === path.length - 1) {
      const out = [host, ...named];
      return out.filter((d, k) => out.indexOf(d) === k);
    }
    const next = named.find((d) => /^export interface/m.test(d.text));
    if (!next) return null;
    hosts = decls.filter((d) => d.name === next.name);
  }
  return null;
}

/**
 * The declarations that answer a query: a capability by its index name (`ctx.caps.ai`, `Face`,
 * `languages`) with what the prompt says about it, a `ctx.` path (`ctx.caps.camera.live`), a type
 * by name, the interfaces that declare a property of that name, a view type by its short name
 * (`map` → `MapView` plus what the validator accepts), or `ctx.<member>`. Plain text the model can
 * quote; a clear "nothing declares it" when there is none, so a refusal can cite this rather than an
 * assumption.
 */
export function lookupReference(reference: string, rawQuery: string): string {
  const trimmed = rawQuery.trim().replace(/[?:]+$/, "").replace(/\(\)$/, "");
  const capability = capabilityNamed(trimmed);
  if (capability) return clip(capabilityBlock(capability, CAPABILITY_REFERENCE));
  const decls = declarations(reference);
  const path = /^ctx\./i.test(trimmed) ? trimmed.slice(4).split(".").filter(Boolean) : [];
  if (path.length > 1) {
    const found = lookupPath(decls, path);
    if (found) return clip(found.slice(0, 4).map((d) => d.text.trim()).join("\n\n"));
  }
  const query = trimmed.replace(/^ctx\./i, "");
  if (!query) return "Ask for a type name (MapView, Ctx, FilterChip), a property (camera, scope), a view type (map, list) or a capability (ctx.caps.ai).";
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
  return clip(parts.join("\n\n"));
}

function clip(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… (truncated; ask for a more specific name)` : text;
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

/** `lookup`, the tool every loop offers first. */
function lookupTool(): AgentTool {
  return {
    name: "lookup",
    description:
      "Read the real declaration of a type, a property or a view type from the potyro module — the same text as the REFERENCE in your instructions, " +
      "found for you, and the declarations of every capability in the CAPABILITIES index. Use it BEFORE deciding an option does not exist, and before using a capability: " +
      "lookup(\"MapView\"), lookup(\"camera\"), lookup(\"map\"), lookup(\"ctx.scope\"), lookup(\"ctx.caps.ai\"), lookup(\"ctx.caps.camera.live\"). " +
      "If it answers that nothing declares it, that is the fact to quote in a NOT-IN-APP.",
    parameters: { type: "object", properties: { query: { type: "string", description: "A type name, property name, view type, ctx.<member> path, or a capability from the index" } }, required: ["query"] },
    run: async (args) => ({ ok: true, detail: lookupReference(LOOKUP_REFERENCE, String(args.query ?? "")) }),
  };
}

export function buildDiscoveryTools(deps: DiscoveryDeps): AgentTool[] {
  const corpus = deps.corpus ?? loadCorpus;
  return [
    lookupTool(),
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
    ...readingTools(corpus),
    ...(deps.draft ? [buildTranslateTool({ draft: deps.draft, check: deps.check })] : []),
  ];
}

/** `example`, `search_corpus` and `read`: what a loop reads the release's corpus with. */
function readingTools(corpus: () => Promise<Corpus>): AgentTool[] {
  return [
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
  ];
}

export interface CreateToolDeps {
  /** Bundle + validate a candidate; the validator's issues, empty when it is a well-formed app. Throws when it does not compile. */
  check: (source: string) => Promise<string[]>;
  /** Run a candidate that validates on sample records (#262 phase 3). A new app has nothing to be
   *  compared with, so this is the run itself: what threw, and what looks wrong. Optional. */
  run?: (source: string) => Promise<RunReport>;
  corpus?: () => Promise<Corpus>;
}

/**
 * The tools for making a NEW app (#262 phase 3): the same `lookup` and corpus tools as a change, and
 * a `check` that takes the WHOLE app — there is no app yet to write edits against.
 */
export function buildCreateTools(deps: CreateToolDeps): AgentTool[] {
  const corpus = deps.corpus ?? loadCorpus;
  return [
    lookupTool(),
    {
      name: "check",
      description:
        "Try an app before sending it: the whole .app.ts source. It is bundled and validated" +
        (deps.run ? ", then RUN on sample records," : ",") +
        " and you get the validator's words or what the run showed. Use it when you are unsure an app validates; then send the app as your reply.",
      parameters: { type: "object", properties: { source: { type: "string", description: "The whole .app.ts source" } }, required: ["source"] },
      run: async (args) => {
        const source = extractSource(String(args.source ?? args.edits ?? ""));
        if (!looksLikeApp(source)) return { ok: false, detail: "That is not an app: send the whole .app.ts source, with `export default defineApp({ … })`." };
        let issues: string[];
        try {
          issues = await deps.check(source);
        } catch (e) {
          return { ok: false, detail: `It does not compile: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (issues.length) return { ok: false, detail: `It fails validation:\n${issues.map((i) => `- ${i}`).join("\n")}` };
        if (!deps.run) return { ok: true, detail: "It compiles and validates." };
        const report = await runSafely(deps.run, source);
        return { ok: report.errors.length === 0, detail: `It compiles and validates. ${describeRun(report)}` };
      },
    },
    ...readingTools(corpus),
  ];
}
