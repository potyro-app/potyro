// An app's messages, extracted from its source, and its catalogs kept in step with them (docs/30).
//
// The app is written in one language. Its messages are every words slot of the definition — the
// schema's own walker says which values those are (`sourceSlots`) — and every `ctx.t("…")` in its
// functions. They become `locales/messages.pot`, and are merged into each `locales/<lang>.po`:
//   - a new message is added untranslated;
//   - a message that is gone is kept as obsolete, so a word that comes back finds its translation;
//   - a message whose source changed a little takes the old translation, marked fuzzy: it shows in
//     the app's own language until someone checks it.
// Nothing here edits the app's code.

import { parse as parseIcu, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { readPo, writePo, type CatalogEntry } from "@potyro/i18n/app-catalogs";
import { CODE, FN, parseModuleSource, readSourceWords, sourceSlots } from "./source-words.js";

/** One message the app shows, with where it is used. */
export interface Message {
  id: string;
  context?: string;
  /** Where it is used: a slot's path ("pages.0.title"), or "ctx.t". */
  references: string[];
}

/** What the extractor could not take, and why: a translator would never see these words. */
export interface ExtractProblem {
  line: number;
  text: string;
  /**
   * `not-literal`: `ctx.t(variable)`, fine when its words are marked with `msg` where they are written.
   * `msg-not-literal`: `msg(variable)`, which marks nothing. `behind-code`: a slot's words behind a
   * const or a helper, invisible unless marked with `msg`.
   */
  why: "not-literal" | "msg-not-literal" | "behind-code";
}

export interface Extracted {
  /** The app's own language, as it declares it. */
  language?: string;
  messages: Message[];
  problems: ExtractProblem[];
}

interface Node {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } };
  [k: string]: unknown;
}

const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);

/** A literal's text: a string, or a template without holes. Null for anything computed. */
function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return String(node.value);
  if (node.type === "TemplateLiteral" && asArray(node.expressions).length === 0) return asArray(node.quasis).map((q) => (q.value as { cooked: string }).cooked).join("");
  if (node.type === "TSAsExpression" || node.type === "ParenthesizedExpression") return literalText(node.expression as Node);
  return null;
}

/** `{ text: "Water", context: "verb" }` written out: its two literals. Null for anything else. */
function contextWords(node: Node | undefined): { text: string; context: string } | null {
  if (node?.type !== "ObjectExpression") return null;
  const props = asArray(node.properties);
  if (props.length !== 2) return null;
  const out: Record<string, string> = {};
  for (const p of props) {
    const key = p.key as { name?: string; value?: string } | undefined;
    const k = key?.name ?? key?.value;
    const v = literalText(p.value as Node);
    if ((k !== "text" && k !== "context") || v === null) return null;
    out[k] = v;
  }
  return out.text !== undefined && out.context !== undefined ? { text: out.text, context: out.context } : null;
}

/** Every `x.t(…)` call in the source (`ctx.t`, `runtime.ctx.t` in a custom view), and every `msg(…)`. */
function tCalls(sw: { source: string; ast: unknown }): Array<{ line: number; first: Node | undefined; raw: string; marker: boolean }> {
  const out: Array<{ line: number; first: Node | undefined; raw: string; marker: boolean }> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (!node.type) return;
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const name = callee?.type === "MemberExpression" && callee.computed !== true ? ((callee.property as Node)?.name as string | undefined) : undefined;
      const args = asArray(node.arguments);
      if (name === "t") out.push({ line: node.loc?.start.line ?? 0, first: args[0], raw: sw.source.slice(node.start, node.end).slice(0, 120), marker: false });
      // `msg("…")`: words marked where they are written, translated by a `ctx.t(variable)` later.
      if (callee?.type === "Identifier" && callee.name === "msg") out.push({ line: node.loc?.start.line ?? 0, first: args[0], raw: sw.source.slice(node.start, node.end).slice(0, 120), marker: true });
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && (value as Node).type) visit(value);
    }
  };
  visit(sw.ast);
  return out;
}

const isMsgCall = (node: Node | undefined): boolean => node?.type === "CallExpression" && (node.callee as Node | undefined)?.name === "msg";

/** Names declared as `const NAME = msg("…")`: a slot that names one has its words marked. */
function msgConsts(ast: unknown): Set<string> {
  const names = new Set<string>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "VariableDeclarator" && (node.id as Node | undefined)?.type === "Identifier" && isMsgCall(node.init as Node | undefined)) names.add((node.id as Node).name as string);
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast);
  return names;
}

/**
 * The app's messages, in the order its source has them: the definition's slots first, then the
 * strings in its functions, then those in its own modules (`modules`: their sources, as `./words.ts`
 * and the like). A message used in several places is listed once, with every place.
 */
export async function extractMessages(source: string, modules: readonly string[] = []): Promise<Extracted | null> {
  const sw = await readSourceWords(source);
  if (!sw) return null;
  const language = typeof sw.data.language === "string" ? sw.data.language : undefined;
  const byKey = new Map<string, Message>();
  const problems: ExtractProblem[] = [];
  const add = (id: string, reference: string, context?: string): void => {
    if (!id.trim()) return;
    const key = context ? `${context}\u0004${id}` : id;
    const m = byKey.get(key);
    if (m) {
      if (!m.references.includes(reference)) m.references.push(reference);
    }
    else byKey.set(key, { id, ...(context ? { context } : {}), references: [reference] });
  };

  const markedConsts = msgConsts(sw.ast);
  for (const slot of sourceSlots(sw)) {
    if (slot.suggested !== undefined) continue; // no words written there: nothing to translate
    const v = slot.value;
    if (typeof v === "string") {
      const node = sw.nodes.get(slot.path);
      const marked = isMsgCall(node) || (node?.type === "Identifier" && markedConsts.has(node.name as string));
      // A marked const's words are taken where `msg` is called, below.
      if (v === CODE) {
        if (!marked) problems.push({ line: node?.loc?.start.line ?? 0, text: slot.path, why: "behind-code" });
      } else if (v !== FN) add(v, slot.path);
    } else if (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" && typeof (v as { context?: unknown }).context === "string" && Object.keys(v).length === 2) {
      add((v as { text: string }).text, slot.path, (v as { context: string }).context);
    } else if (v && typeof v === "object") {
      // A legacy map: its own language is the message. The codemod moves the rest into catalogs.
      const own = language && typeof (v as Record<string, unknown>)[language] === "string" ? (v as Record<string, string>)[language]! : undefined;
      if (own) add(own, slot.path);
    }
  }

  const parsed = [sw, ...(await Promise.all(modules.map((m) => parseModuleSource(m)))).filter((m): m is { source: string; ast: unknown } => m !== null)];
  for (const call of parsed.flatMap((p) => tCalls(p))) {
    const withContext = contextWords(call.first);
    if (withContext) {
      add(withContext.text, call.marker ? "msg" : "ctx.t", withContext.context);
      continue;
    }
    const text = literalText(call.first);
    if (text === null) {
      // A map `ctx.t({ en, pl })` is legacy and has its words already. `ctx.t(variable)` is fine when
      // its words were marked with `msg` where they are written — which the extractor cannot check.
      if (call.first?.type !== "ObjectExpression") problems.push({ line: call.line, text: call.raw, why: call.marker ? "msg-not-literal" : "not-literal" });
      continue;
    }
    // No line number: it would change with every edit above it, and churn every catalog (as Lingui's own).
    add(text, call.marker ? "msg" : "ctx.t");
  }
  return { ...(language ? { language } : {}), messages: [...byKey.values()], problems };
}

// ── merge ──────────────────────────────────────────────────────────────────────────────────────

const keyOf = (m: { id: string; context?: string }): string => (m.context ? `${m.context}\u0004${m.id}` : m.id);
const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}{}#]+/gu, " ").trim();

/** How alike two source texts are, 0–1: one minus the edit distance over the longer length. */
export function likeness(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const prev = new Array(y.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

/** How alike an old message must be to lend its translation, marked fuzzy. */
export const FUZZY_AT = 0.8;

export interface MergeReport {
  added: number;
  fuzzy: number;
  obsolete: number;
  /** Messages that have a translation, out of all the app uses. */
  translated: number;
  total: number;
}

/**
 * A catalog for `language` with exactly the app's messages: what was translated keeps its
 * translation; the rest is added empty, or fuzzy from a near match; what the app no longer uses is
 * kept at the end, obsolete.
 */
export function mergeCatalog(existing: string | null, language: string, messages: readonly Message[]): { po: string; report: MergeReport } {
  const old = existing ? readPo(existing).entries : [];
  const byKey = new Map(old.map((e) => [keyOf(e), e]));
  const used = new Set<string>();
  const report: MergeReport = { added: 0, fuzzy: 0, obsolete: 0, translated: 0, total: messages.length };
  const entries: CatalogEntry[] = messages.map((m) => {
    const key = keyOf(m);
    const had = byKey.get(key);
    if (had) {
      used.add(key);
      if (had.text && !had.fuzzy) report.translated++;
      return { ...had, obsolete: false, references: [...m.references], notes: had.notes };
    }
    // A near match among the messages no longer used lends its translation, to be checked.
    let best: CatalogEntry | undefined;
    let score = 0;
    for (const e of old) {
      if (!e.text || byKey.get(keyOf(e)) !== e || messages.some((n) => keyOf(n) === keyOf(e)) || (e.context ?? "") !== (m.context ?? "")) continue;
      const s = likeness(e.id, m.id);
      if (s > score) [best, score] = [e, s];
    }
    if (best && score >= FUZZY_AT) {
      report.fuzzy++;
      return { id: m.id, ...(m.context ? { context: m.context } : {}), text: best.text, fuzzy: true, obsolete: false, references: [...m.references], notes: [] };
    }
    report.added++;
    return { id: m.id, ...(m.context ? { context: m.context } : {}), text: "", fuzzy: false, obsolete: false, references: [...m.references], notes: [] };
  });
  for (const e of old) {
    const key = keyOf(e);
    if (used.has(key) || messages.some((m) => keyOf(m) === key) || !e.text) continue;
    report.obsolete++;
    entries.push({ ...e, obsolete: true, fuzzy: false, references: [] });
  }
  return { po: writePo(language, entries), report };
}

/** The template: every message, nothing translated. */
export function writeTemplate(messages: readonly Message[]): string {
  return writePo("", messages.map((m) => ({ id: m.id, ...(m.context ? { context: m.context } : {}), text: "", fuzzy: false, obsolete: false, references: [...m.references], notes: [] })));
}

// ── the check an app's own tests run ───────────────────────────────────────────────────────────

/**
 * A message's variables, `{name}` and `{n, plural, …}` alike, sorted: what every translation must keep.
 * Read as ICU (the words inside a plural's branches are not variables). A message that is not valid ICU
 * says so.
 */
export function messageHoles(text: string): string {
  const names = new Set<string>();
  const visit = (elements: readonly MessageFormatElement[]): void => {
    for (const el of elements) {
      if ("value" in el && typeof el.value === "string" && el.type !== TYPE.literal) names.add(el.value);
      if ("options" in el) for (const o of Object.values(el.options)) visit(o.value);
      if ("children" in el) visit(el.children);
    }
  };
  try {
    visit(parseIcu(text, { ignoreTag: true }));
  } catch {
    return "(not a message ICU can read)";
  }
  return [...names].sort().join(",");
}

/**
 * What is wrong with an app's translations, as an app's own test asks it (docs/30): an inline map left
 * in the source, a catalog missing for a language the app carries, a catalog out of step with the
 * source (run `pnpm i18n:app`), or a message left untranslated that is not one of the words that read
 * the same everywhere (`same`: units, a name). Empty when all is well.
 */
export async function catalogProblems(opts: {
  source: string;
  /** The app's own modules' sources (`./words.ts`): their `ctx.t` and `msg` words are the app's. */
  modules?: readonly string[];
  /** language → the `.po` file's text, for every language the app carries but its own. */
  catalogs: Readonly<Record<string, string | undefined>>;
  /** Words a translator would leave alone: `/^(\S{1,5}|Breakout)$/`. */
  same: RegExp;
}): Promise<string[]> {
  const out: string[] = [];
  const extracted = await extractMessages(opts.source, opts.modules);
  if (!extracted) return ["no defineApp({...}) in the source"];
  for (const s of [opts.source, ...(opts.modules ?? [])]) {
    if (/\{\s*en:\s*"/.test(s)) out.push("an inline translation map is left in the app's code: its words belong in locales/<lang>.po");
  }
  for (const p of extracted.problems) if (p.why !== "not-literal") out.push(`line ${p.line}: ${p.why}: ${p.text}`);
  for (const [language, po] of Object.entries(opts.catalogs)) {
    if (po === undefined) {
      out.push(`locales/${language}.po is missing`);
      continue;
    }
    if (mergeCatalog(po, language, extracted.messages).po !== po) out.push(`locales/${language}.po is out of step with the source: run pnpm i18n:app`);
    for (const e of readPo(po).entries) {
      if (e.obsolete) continue;
      if (!e.text && !opts.same.test(e.id)) out.push(`${language}: "${e.id}" is not translated`);
      // A translation keeps the message's {holes}: a missing one would show nothing, an extra one fail.
      else if (e.text && messageHoles(e.text) !== messageHoles(e.id)) out.push(`${language}: "${e.id}" → "${e.text}" has other {placeholders}: ${messageHoles(e.text) || "none"} for ${messageHoles(e.id) || "none"}`);
    }
  }
  return out;
}
