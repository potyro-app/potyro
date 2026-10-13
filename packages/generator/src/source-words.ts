// An app's words, read from its SOURCE and spliced back into it (#302, docs/20 §5).
//
// The same rule as the shell's structural editor: parse for positions, splice text, never reprint.
// `@babel/parser` finds where each word sits; `magic-string` writes the new language beside it, so
// everything outside the edited ranges is byte-identical. Both are loaded lazily.
//
// Which slots hold words is not decided here: the definition is read out of the source as plain data
// (functions and code become markers) and `wordSlots` — the schema's one walker — says which of its
// values are words. So this file can only ever splice where the schema says words go.

import { appLanguages, humanizeKey, LANGUAGE_TAG, wordSlots, wordsPathText, type AppDefinition, type Language, type Words } from "potyro";

interface Node {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } };
  [k: string]: unknown;
}
interface Tools {
  parse: (code: string, opts: object) => Node;
  MagicString: new (s: string) => { overwrite(s: number, e: number, t: string, o?: { contentOnly?: boolean }): unknown; appendLeft(i: number, t: string): unknown; toString(): string };
}

let tools: Promise<Tools> | null = null;
function load(): Promise<Tools> {
  tools ??= Promise.all([import("@babel/parser"), import("magic-string")]).then(([babel, magic]) => ({
    parse: babel.parse as unknown as Tools["parse"],
    MagicString: ((magic as { default?: unknown }).default ?? magic) as Tools["MagicString"],
  }));
  return tools;
}

/** Where a function sat in the source: its words are not data, they are in its body. */
export const FN = "__potyro_fn__";
/** Where code sat (a const, a helper call, a template with holes): words behind it cannot be spliced. */
export const CODE = "__potyro_code__";

const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const keyOf = (prop: Node): string | undefined => {
  const key = prop.key as { name?: string; value?: unknown } | undefined;
  if (prop.computed === true) return undefined;
  if (typeof key?.name === "string") return key.name;
  return typeof key?.value === "string" ? key.value : undefined;
};

function findDefinition(ast: Node): Node | null {
  let found: Node | null = null;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "CallExpression" && (node.callee as Node | undefined)?.name === "defineApp") {
      const arg = asArray(node.arguments)[0];
      if (arg?.type === "ObjectExpression") found = arg;
      if (found) return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object" && (value as Node).type) walk(value);
    }
  };
  walk(ast);
  return found;
}

/** The definition read from the source as data, and the node behind every value by path. */
export interface SourceWords {
  source: string;
  ast: Node;
  /** The definition object literal. */
  root: Node;
  /** The definition as plain data: `FN` for a function, `CODE` for any other code. */
  data: Record<string, unknown>;
  nodes: Map<string, Node>;
}

function toData(node: Node, path: string, nodes: Map<string, Node>): unknown {
  nodes.set(path, node);
  const at = (k: string | number): string => (path ? `${path}.${k}` : String(k));
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "TemplateLiteral":
      return asArray(node.expressions).length === 0 ? asArray(node.quasis).map((q) => (q.value as { cooked: string }).cooked).join("") : CODE;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return toData(node.expression as Node, path, nodes);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return FN;
    case "ArrayExpression":
      return asArray(node.elements).map((el, i) => (el ? toData(el, at(i), nodes) : null));
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const p of asArray(node.properties)) {
        const key = p.type === "ObjectProperty" || p.type === "ObjectMethod" ? keyOf(p) : undefined;
        if (!key) continue;
        out[key] = p.type === "ObjectMethod" ? FN : toData(p.value as Node, at(key), nodes);
        nodes.set(`${at(key)}#prop`, p);
      }
      return out;
    }
    default:
      return CODE;
  }
}

/** Read an app's definition out of its source, without running it. Null when there is no `defineApp({...})`. */
export async function readSourceWords(source: string): Promise<SourceWords | null> {
  const t = await load();
  let ast: Node;
  try {
    ast = t.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    return null;
  }
  const root = findDefinition(ast);
  if (!root) return null;
  const nodes = new Map<string, Node>();
  const data = toData(root, "", nodes) as Record<string, unknown>;
  return { source, ast, root, data, nodes };
}

const asDef = (sw: SourceWords): AppDefinition => sw.data as unknown as AppDefinition;

/** One words slot as the `translate` tool lists it. */
export interface WordSlot {
  path: string;
  /** The words as written: a string, or the map. Absent for a slot that has no words yet. */
  value?: Words;
  /** `literal`: it can be spliced. `code`: words behind a const or a helper — SEARCH/REPLACE it. */
  kind: "literal" | "code";
  /** A slot with no words yet — a field leaning on its key, an option with no label. `value` is what shows today. */
  suggested?: string;
}

/** Every slot the schema says holds words, in this source, plus the ones a translation should add. */
export function sourceSlots(sw: SourceWords): WordSlot[] {
  const out: WordSlot[] = [];
  for (const { path, value } of wordSlots(sw.data)) {
    if (value === FN) continue; // a Dynamic<Words> function: its words are in its body
    out.push({ path: wordsPathText(path), value, kind: value === CODE ? "code" : "literal" });
  }
  const have = new Set(out.map((s) => s.path));
  const add = (path: string, shows: string): void => {
    if (!have.has(path)) out.push({ path, kind: "literal", suggested: shows });
  };
  const fieldsAt = (fields: unknown, at: string): void => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
    for (const [key, f] of Object.entries(fields as Record<string, Record<string, unknown>>)) {
      if (!f || typeof f !== "object") continue;
      add(`${at}.${key}.label`, humanizeKey(key));
      if ((f.type === "enum" || f.type === "tags") && Array.isArray(f.options)) {
        for (const o of f.options) if (typeof o === "string") add(`${at}.${key}.labels.${o}`, o);
      }
      if (f.type === "list") fieldsAt(f.of, `${at}.${key}.of`);
    }
  };
  for (const [name, e] of Object.entries((sw.data.entities ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!e || typeof e !== "object") continue;
    add(`entities.${name}.label`, humanizeKey(name));
    fieldsAt(e.fields, `entities.${name}.fields`);
  }
  return out;
}

/** The languages the source declares. */
export function sourceLanguages(sw: SourceWords): { language?: Language; languages: Language[] } {
  const def = asDef(sw);
  return { language: typeof def.language === "string" ? def.language : undefined, languages: appLanguages(def) };
}

// ── strings inside functions ─────────────────────────────────────────────────────────────────

/** Calls whose string arguments are names (an entity, a page, a key), never words. */
const NAME_CALLS = new Set(["query", "get", "create", "patch", "delete", "increment", "navigate", "map", "storage", "files", "text", "json", "bytes", "url", "write", "stat", "list", "remove", "rename", "log", "format"]);

/** A string inside a function the person will read, not yet in `ctx.t`. */
export interface FunctionString {
  line: number;
  text: string;
}

function looksLikeWords(text: string): boolean {
  const t = text.trim();
  return /\p{L}{2,}/u.test(t) && (/\s/.test(t) || /^\p{Lu}/u.test(t) || /[.!?:…]$/.test(t));
}

/**
 * The strings in the app's functions that read as words and are not inside `ctx.t(...)`: what a
 * translation still has to wrap. A guess — names passed to `ctx.query`, keys, comparisons and JSX
 * attributes are left out — so it is a list to read, never something spliced automatically.
 */
export function functionStrings(sw: SourceWords): FunctionString[] {
  const out: FunctionString[] = [];
  const seen = new Set<number>();
  const visit = (n: unknown, inFn: boolean, parent: Node | null): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (!node.type) return;
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const name = callee?.type === "MemberExpression" ? ((callee.property as Node)?.name as string | undefined) : undefined;
      if (name === "t") return; // ctx.t(...) — already words
      if (name && NAME_CALLS.has(name)) {
        visit(callee, inFn, node);
        return; // its arguments are names
      }
    }
    if (node.type === "BinaryExpression" && ["===", "!==", "==", "!="].includes(node.operator as string)) return;
    if (node.type === "SwitchCase" || node.type === "ImportDeclaration" || node.type === "TSLiteralType") return;
    const fn = inFn || node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "ObjectMethod";
    if (fn && !seen.has(node.start) && (node.type === "StringLiteral" || node.type === "TemplateLiteral" || node.type === "JSXText")) {
      const isKey = parent?.type === "ObjectProperty" && parent.key === node;
      const isAttr = parent?.type === "JSXAttribute";
      const text = node.type === "TemplateLiteral" ? sw.source.slice(node.start + 1, node.end - 1) : node.type === "JSXText" ? String(node.value) : String(node.value);
      if (!isKey && !isAttr && looksLikeWords(text.replace(/\$\{[^}]*\}/g, " x "))) {
        seen.add(node.start);
        out.push({ line: node.loc?.start.line ?? 0, text: text.trim().slice(0, 120) });
      }
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(value)) value.forEach((v) => visit(v, fn, node));
      else if (value && typeof value === "object" && (value as Node).type) visit(value, fn, node);
    }
  };
  visit(sw.root, false, null);
  return out;
}

/** Every `ctx.t({ … })` map in the source that lacks one of `languages` — the functions' half of completeness. */
export function tMapGaps(sw: SourceWords, languages: readonly Language[]): Array<{ line: number; missing: Language[]; text: string }> {
  const out: Array<{ line: number; missing: Language[]; text: string }> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const arg = asArray(node.arguments)[0];
      if (callee?.type === "MemberExpression" && (callee.property as Node)?.name === "t" && arg?.type === "ObjectExpression") {
        const keys = asArray(arg.properties).map((p) => keyOf(p)).filter((k): k is string => Boolean(k));
        const missing = languages.filter((l) => !keys.includes(l));
        if (missing.length) out.push({ line: node.loc?.start.line ?? 0, missing, text: sw.source.slice(arg.start, Math.min(arg.end, arg.start + 80)) });
      }
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && (value as Node).type) visit(value);
    }
  };
  visit(sw.ast);
  return out;
}

// ── splicing a language in ───────────────────────────────────────────────────────────────────

const quoteKey = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
const lit = (s: string): string => JSON.stringify(s);

export interface SpliceResult {
  source: string;
  /** Paths written, and the line each now reads as. */
  written: Array<{ path: string; line: string }>;
  /** Paths that were not written, and why. */
  refused: Array<{ path: string; why: string }>;
}

function lineAround(source: string, at: number): string {
  const start = source.lastIndexOf("\n", at - 1) + 1;
  const end = source.indexOf("\n", at);
  return source.slice(start, end < 0 ? undefined : end).trim();
}

/**
 * Write `language`'s words into the source: into each literal map, turning a plain string into
 * `{ <own>: "…", <language>: "…" }`, adding a missing `label` or option `labels`; `language` joins
 * `languages`. `from` is the app's own language, needed only when the source declares none.
 */
export async function spliceLanguage(source: string, language: Language, words: Record<string, string>, from?: Language): Promise<SpliceResult> {
  if (!LANGUAGE_TAG.test(language)) return { source, written: [], refused: [{ path: "(language)", why: `"${language}" is not a language tag like "de" or "pt-BR"` }] };
  const sw = await readSourceWords(source);
  if (!sw) return { source, written: [], refused: [{ path: "(app)", why: "the source has no defineApp({...}) object to write into" }] };
  const t = await load();
  const ms = new t.MagicString(source);
  const own = sourceLanguages(sw).language ?? from;
  if (!own) return { source, written: [], refused: [{ path: "(language)", why: "the app declares no `language`, so say which one it is written in with `from`" }] };
  if (own === language) return { source, written: [], refused: [{ path: "(language)", why: `${language} is the app's own language already` }] };
  const slots = new Map(sourceSlots(sw).map((s) => [s.path, s]));
  const written: SpliceResult["written"] = [];
  const refused: SpliceResult["refused"] = [];
  const touched: number[] = [];
  /** New `labels` objects, per field, gathered so one field gets one property. */
  const newLabels = new Map<string, string[]>();

  for (const [path, text] of Object.entries(words)) {
    const slot = slots.get(path);
    if (typeof text !== "string" || !text.trim()) {
      refused.push({ path, why: "no words given" });
      continue;
    }
    if (!slot) {
      refused.push({ path, why: "no words go there — use a path from the list" });
      continue;
    }
    if (slot.kind === "code") {
      refused.push({ path, why: "its words are behind code (a const or a helper) — change it with SEARCH/REPLACE" });
      continue;
    }
    const node = sw.nodes.get(path);
    if (slot.suggested !== undefined) {
      // A slot with no words yet: a field's label, or an option's.
      const option = /\.labels\.([^.]+)$/.exec(path);
      const ownText = slot.suggested;
      const map = `{ ${quoteKey(own)}: ${lit(ownText)}, ${quoteKey(language)}: ${lit(text)} }`;
      if (option) {
        const fieldPath = path.slice(0, option.index);
        const labelsNode = sw.nodes.get(`${fieldPath}.labels`);
        if (labelsNode?.type === "ObjectExpression") {
          const props = asArray(labelsNode.properties);
          const last = props[props.length - 1];
          if (last) ms.appendLeft(last.end, `, ${quoteKey(option[1]!)}: ${map}`);
          else ms.appendLeft(labelsNode.start + 1, ` ${quoteKey(option[1]!)}: ${map} `);
          touched.push(labelsNode.start);
          written.push({ path, line: `${option[1]}: ${map}` });
        } else (newLabels.get(fieldPath) ?? newLabels.set(fieldPath, []).get(fieldPath)!).push(`${quoteKey(option[1]!)}: ${map}`);
        continue;
      }
      const owner = sw.nodes.get(path.slice(0, path.lastIndexOf(".")));
      if (owner?.type !== "ObjectExpression") {
        refused.push({ path, why: "the thing it belongs to is not written as an object here" });
        continue;
      }
      const props = asArray(owner.properties);
      const last = props[props.length - 1];
      const insert = `label: ${map}`;
      if (last) ms.appendLeft(last.end, `, ${insert}`);
      else ms.appendLeft(owner.start + 1, ` ${insert} `);
      touched.push(owner.start);
      written.push({ path, line: insert });
      continue;
    }
    if (!node) {
      refused.push({ path, why: "could not find it in the source" });
      continue;
    }
    if (node.type === "StringLiteral" || node.type === "TemplateLiteral") {
      const raw = source.slice(node.start, node.end);
      const map = `{ ${quoteKey(own)}: ${raw}, ${quoteKey(language)}: ${lit(text)} }`;
      ms.overwrite(node.start, node.end, map, { contentOnly: true });
      touched.push(node.start);
      written.push({ path, line: lineAround(source, node.start).replace(raw, map) });
      continue;
    }
    if (node.type === "ObjectExpression") {
      const props = asArray(node.properties);
      const existing = props.find((p) => keyOf(p) === language);
      if (existing) ms.overwrite((existing.value as Node).start, (existing.value as Node).end, lit(text), { contentOnly: true });
      else if (props.length) ms.appendLeft(props[props.length - 1]!.end, `, ${quoteKey(language)}: ${lit(text)}`);
      else ms.appendLeft(node.start + 1, ` ${quoteKey(language)}: ${lit(text)} `);
      touched.push(node.start);
      written.push({ path, line: `${path}: … ${quoteKey(language)}: ${lit(text)}` });
      continue;
    }
    refused.push({ path, why: "its words are behind code — change it with SEARCH/REPLACE" });
  }

  for (const [fieldPath, entries] of newLabels) {
    const field = sw.nodes.get(fieldPath);
    if (field?.type !== "ObjectExpression") {
      for (const e of entries) refused.push({ path: `${fieldPath}.labels.${e.split(":")[0]}`, why: "the field is not written as an object here" });
      continue;
    }
    const props = asArray(field.properties);
    const insert = `labels: { ${entries.join(", ")} }`;
    ms.appendLeft(props.length ? props[props.length - 1]!.end : field.start + 1, props.length ? `, ${insert}` : ` ${insert} `);
    for (const e of entries) written.push({ path: `${fieldPath}.labels.${e.split(":")[0]}`, line: e });
  }

  if (written.length) declareLanguage(sw, ms, own, language, Boolean(sourceLanguages(sw).language));
  return { source: written.length ? ms.toString() : source, written, refused };
}

/** `language` joins `languages` (and `language:` is written when the app had none). */
function declareLanguage(sw: SourceWords, ms: InstanceType<Tools["MagicString"]>, own: Language, language: Language, hadOwn: boolean): void {
  const list = sw.nodes.get("languages");
  if (list?.type === "ArrayExpression") {
    const items = asArray(list.elements);
    const names = items.map((i) => (i?.type === "StringLiteral" ? String(i.value) : ""));
    if (names.includes(language)) return;
    if (items.length) ms.appendLeft(items[items.length - 1]!.end, `, ${lit(language)}`);
    else ms.appendLeft(list.start + 1, lit(language));
    return;
  }
  const after = hadOwn ? sw.nodes.get("language#prop") : (sw.nodes.get("schemaVersion#prop") ?? sw.nodes.get("version#prop") ?? sw.nodes.get("id#prop"));
  const text = `${hadOwn ? "" : `language: ${lit(own)}, `}languages: [${lit(own)}, ${lit(language)}]`;
  if (after) ms.appendLeft(after.end, `, ${text}`);
  else ms.appendLeft(sw.root.start + 1, ` ${text},`);
}

// ── completeness: the generator's `check` (docs/20 §5.1) ──────────────────────────────────────

export interface WordsReport {
  /** Gaps the candidate ADDS: a map, or a `ctx.t` map, without one of the app's languages. These fail. */
  added: string[];
  /** Gaps that were already there — a partial translation may be deliberate, so only reported. */
  existing: string[];
  /** Plain strings the candidate adds to an app with more than one language: "the same everywhere", or forgotten? */
  plain: string[];
}

async function gapsOf(source: string): Promise<{ gaps: string[]; plain: string[]; multi: boolean } | null> {
  const sw = await readSourceWords(source);
  if (!sw) return null;
  const { languages } = sourceLanguages(sw);
  if (languages.length < 2) return { gaps: [], plain: [], multi: false };
  const gaps: string[] = [];
  const plain: string[] = [];
  for (const { path, value } of wordSlots(sw.data)) {
    if (value === FN || value === CODE) continue;
    const at = wordsPathText(path);
    if (typeof value === "string") plain.push(`${at}: ${JSON.stringify(value)}`);
    else {
      const missing = languages.filter((l) => !(l in value));
      if (missing.length) gaps.push(`${at} has no ${missing.join(", ")}`);
    }
  }
  for (const g of tMapGaps(sw, languages)) gaps.push(`ctx.t(${g.text}${g.text.length >= 80 ? "…" : ""}) has no ${g.missing.join(", ")}`);
  return { gaps, plain, multi: true };
}

/** What a candidate does to the app's translations, against the app as first shown. */
export async function wordsReport(before: string, after: string): Promise<WordsReport> {
  const [a, b] = await Promise.all([gapsOf(before), gapsOf(after)]);
  if (!b || !b.multi) return { added: [], existing: [], plain: [] };
  const had = new Set(a?.gaps ?? []);
  const hadPlain = new Set(a?.plain ?? []);
  return {
    added: b.gaps.filter((g) => !had.has(g)),
    existing: b.gaps.filter((g) => had.has(g)),
    plain: b.plain.filter((p) => !hadPlain.has(p)),
  };
}

/** The report as the lines `check` adds; `fails` when the candidate added a gap. */
export function describeWordsReport(r: WordsReport): { fails: boolean; text: string } {
  const lines: string[] = [];
  if (r.added.length) lines.push(`Translations this change leaves incomplete (give every language):\n${r.added.map((g) => `- ${g}`).join("\n")}`);
  if (r.existing.length) lines.push(`Already incomplete before this change (fine to leave): ${r.existing.length} — ${r.existing.slice(0, 5).join("; ")}${r.existing.length > 5 ? "; …" : ""}`);
  if (r.plain.length) lines.push(`New plain strings read the same in every language — right for "OK" or a name, otherwise give a map: ${r.plain.slice(0, 8).join("; ")}`);
  return { fails: r.added.length > 0, text: lines.join("\n") };
}
