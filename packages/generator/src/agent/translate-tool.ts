// `translate` (#302, docs/20 §5.1): a whole new language in one structured answer.
//
// With inline maps, adding German to an app means a `de: "…"` beside every one of its 60–100
// words. As SEARCH/REPLACE that is dozens of blocks, any one of which can be missed or mangled.
// So the model asks for the list (every words slot with its path and current words), answers once
// with `{ path: words }`, and the host splices them in — parse for positions, splice text, never
// reprint — adds the language to `languages`, and checks the result. Only the strings inside
// functions are left to SEARCH/REPLACE, because only the model can decide how a template becomes a
// `ctx.t(...)`. Paths exist only for this one edit, read from the current source, so they cannot drift.
//
// The spliced app becomes the app the loop's edits apply to (`TranslationDraft`): later SEARCH
// blocks are matched against it, and a reply with no edits after a translation sends it as it is.

import { describeWordsReport, functionStrings, readSourceWords, sourceLanguages, sourceSlots, spliceLanguage, wordsReport } from "../source-words.js";
import type { AgentTool } from "./tools.js";

/** The app the loop's edits apply to: the source as first shown, until `translate` writes into it. */
export interface TranslationDraft {
  readonly original: string;
  source: string;
  /** Languages written in by `translate`, in order. */
  added: string[];
}

export function createDraft(source: string): TranslationDraft {
  return { original: source, source, added: [] };
}

export interface TranslateToolDeps {
  draft: TranslationDraft;
  /** Bundle + validate a candidate, as the loop's check does. */
  check: (source: string) => Promise<string[]>;
}

const MAX_LIST = 400;

const show = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v));

async function listing(draft: TranslationDraft, language: string): Promise<{ ok: boolean; detail: string }> {
  const sw = await readSourceWords(draft.source);
  if (!sw) return { ok: false, detail: "This app has no defineApp({...}) object written out, so its words cannot be listed." };
  const { language: own, languages } = sourceLanguages(sw);
  const slots = sourceSlots(sw);
  const literal = slots.filter((s) => s.kind === "literal");
  const code = slots.filter((s) => s.kind === "code");
  const strings = functionStrings(sw);
  const lines = [
    `Translating into ${language}. The app is written in ${own ?? "(no \`language\` declared — pass \`from\` with the language it is written in)"}` +
      (languages.length > 1 ? ` and carries ${languages.join(", ")}.` : "."),
    `Answer with ONE call: translate({ language: "${language}", ${own ? "" : 'from: "<its language>", '}words: { "<path>": "<the words in ${language}>", … } }) — every path below that should read differently in ${language}.`,
    "Leave out a path whose words are the same in every language (a brand, an emoji, a unit like kg). Records are never translated, and option values stay as they are: only their labels change.",
    "",
    `Words you give are spliced in for you (${literal.length}):`,
    ...literal.slice(0, MAX_LIST).map((s) => (s.suggested !== undefined ? `- ${s.path} (no words yet; shows ${show(s.suggested)})` : `- ${s.path}: ${show(s.value)}`)),
    ...(literal.length > MAX_LIST ? [`… and ${literal.length - MAX_LIST} more; translate these first, then list again.`] : []),
  ];
  if (code.length) lines.push("", "Behind code — a const or a helper; change these yourself with SEARCH/REPLACE:", ...code.map((s) => `- ${s.path}`));
  if (strings.length) {
    lines.push(
      "",
      `Strings inside functions, not in ctx.t yet — wrap them yourself with SEARCH/REPLACE, e.g. ctx.t({ ${own ?? "en"}: "Water {name}", ${language}: "…" }, { name: p.name }):`,
      ...strings.map((s) => `- line ${s.line}: ${JSON.stringify(s.text)}`),
    );
  }
  return { ok: true, detail: lines.join("\n") };
}

export function buildTranslateTool(deps: TranslateToolDeps): AgentTool {
  return {
    name: "translate",
    description:
      'Add a language to the app — only when the person asks for one ("translate it into German", "also in Polish"). ' +
      'Call it with { language } to list every word in the app with its path; then call it again with { language, words: { path: words } } ' +
      "and they are written into the app for you, the language added to `languages`, and the result checked. Strings inside functions are left " +
      "to you: wrap them in ctx.t with SEARCH/REPLACE edits, which then apply to the translated app. If nothing is left, reply with no edits.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", description: 'A language tag: "de", "pl", "pt-BR"' },
        from: { type: "string", description: "The language the app is written in — only when it declares no `language`" },
        words: { type: "object", description: "Path → the words in the new language, for the paths the listing gave", additionalProperties: { type: "string" } },
      },
      required: ["language"],
    },
    run: async (args) => {
      const language = String(args.language ?? "").trim();
      if (!language) return { ok: false, detail: 'Say which language: translate({ language: "de" }).' };
      const words = args.words && typeof args.words === "object" && !Array.isArray(args.words) ? (args.words as Record<string, string>) : null;
      if (!words) return listing(deps.draft, language);

      const from = typeof args.from === "string" && args.from.trim() ? args.from.trim() : undefined;
      const out = await spliceLanguage(deps.draft.source, language, words, from);
      if (!out.written.length) {
        return { ok: false, detail: `Nothing was written.${out.refused.length ? `\n${out.refused.map((r) => `- ${r.path}: ${r.why}`).join("\n")}` : ""}` };
      }
      let issues: string[];
      try {
        issues = await deps.check(out.source);
      } catch (e) {
        return { ok: false, detail: `The translated app does not compile, so it was not kept: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (issues.length) return { ok: false, detail: `The translated app fails validation, so it was not kept:\n${issues.map((i) => `- ${i}`).join("\n")}` };

      const before = deps.draft.source;
      deps.draft.source = out.source;
      if (!deps.draft.added.includes(language)) deps.draft.added.push(language);
      const report = describeWordsReport(await wordsReport(before, out.source));
      const sw = await readSourceWords(out.source);
      const strings = sw ? functionStrings(sw) : [];
      const lines = [
        `Wrote ${out.written.length} word${out.written.length === 1 ? "" : "s"} in ${language}; "${language}" is in \`languages\`, and the app compiles and validates.`,
        "The app your SEARCH/REPLACE edits apply to is now the translated one. The lines that changed read:",
        ...out.written.slice(0, 60).map((w) => `  ${w.line}`),
        ...(out.written.length > 60 ? [`  … and ${out.written.length - 60} more`] : []),
      ];
      if (out.refused.length) lines.push("Not written:", ...out.refused.map((r) => `- ${r.path}: ${r.why}`));
      if (report.text) lines.push(report.text);
      lines.push(
        strings.length
          ? `Still in functions, not in ctx.t (${strings.length}): ${strings.slice(0, 12).map((s) => `line ${s.line} ${JSON.stringify(s.text)}`).join("; ")}. Wrap them with SEARCH/REPLACE edits — every language the app carries.`
          : "Nothing is left in functions. Reply with no edits (a sentence saying what was done) and the translation is the change.",
      );
      return { ok: true, detail: lines.join("\n") };
    },
  };
}
