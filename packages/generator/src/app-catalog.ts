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

import { readPo, writePo, type CatalogEntry } from "@potyro/i18n/app-catalogs";
import { CODE, FN, readSourceWords, sourceSlots, type SourceWords } from "./source-words.js";

/** One message the app shows, with where it is used. */
export interface Message {
  id: string;
  context?: string;
  /** Where it is used: a slot's path ("pages.0.title") or "ctx.t:<line>". */
  references: string[];
}

/** What the extractor could not take, and why: a translator would never see these words. */
export interface ExtractProblem {
  line: number;
  text: string;
  why: "not-literal" | "behind-code";
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

/** `{ context: "verb" }`, the third argument of `ctx.t`. */
function contextOf(node: Node | undefined): string | undefined {
  if (node?.type !== "ObjectExpression") return undefined;
  for (const p of asArray(node.properties)) {
    const key = p.key as { name?: string; value?: string } | undefined;
    if ((key?.name ?? key?.value) === "context") return literalText(p.value as Node) ?? undefined;
  }
  return undefined;
}

/** Every `x.t(…)` call in the source: `ctx.t`, and `runtime.ctx.t` in a custom view. */
function tCalls(sw: SourceWords): Array<{ line: number; first: Node | undefined; third: Node | undefined; raw: string }> {
  const out: Array<{ line: number; first: Node | undefined; third: Node | undefined; raw: string }> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (!node.type) return;
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const name = callee?.type === "MemberExpression" && callee.computed !== true ? ((callee.property as Node)?.name as string | undefined) : undefined;
      if (name === "t") {
        const args = asArray(node.arguments);
        out.push({ line: node.loc?.start.line ?? 0, first: args[0], third: args[2], raw: sw.source.slice(node.start, node.end).slice(0, 120) });
      }
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

/**
 * The app's messages, in the order its source has them: the definition's slots first, then the
 * strings in its functions. A message used in several places is listed once, with every place.
 */
export async function extractMessages(source: string): Promise<Extracted | null> {
  const sw = await readSourceWords(source);
  if (!sw) return null;
  const language = typeof sw.data.language === "string" ? sw.data.language : undefined;
  const byKey = new Map<string, Message>();
  const problems: ExtractProblem[] = [];
  const add = (id: string, reference: string, context?: string): void => {
    if (!id.trim()) return;
    const key = context ? `${context}\u0004${id}` : id;
    const m = byKey.get(key);
    if (m) m.references.push(reference);
    else byKey.set(key, { id, ...(context ? { context } : {}), references: [reference] });
  };

  for (const slot of sourceSlots(sw)) {
    if (slot.suggested !== undefined) continue; // no words written there: nothing to translate
    const v = slot.value;
    if (typeof v === "string") {
      if (v === CODE) problems.push({ line: sw.nodes.get(slot.path)?.loc?.start.line ?? 0, text: slot.path, why: "behind-code" });
      else if (v !== FN) add(v, slot.path);
    } else if (v && typeof v === "object") {
      // A legacy map: its own language is the message. The codemod moves the rest into catalogs.
      const own = language && typeof (v as Record<string, unknown>)[language] === "string" ? (v as Record<string, string>)[language]! : undefined;
      if (own) add(own, slot.path);
    }
  }

  for (const call of tCalls(sw)) {
    const text = literalText(call.first);
    if (text === null) {
      // A map `ctx.t({ en, pl })` is legacy and has its words already; anything else is computed.
      if (call.first?.type !== "ObjectExpression") problems.push({ line: call.line, text: call.raw, why: "not-literal" });
      continue;
    }
    add(text, `ctx.t:${call.line}`, contextOf(call.third));
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
