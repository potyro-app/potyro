// Move an app's inline translation maps into catalogs (docs/30 §7); the command is
// scripts/maps-to-po.ts.
//
// Move an app's inline translation maps into catalogs:
//   - every `{ en: "…", pl: "…", … }` whose keys are all languages and whose values are all literal
//     strings becomes its own-language string, and the other languages become `locales/<lang>.po`;
//   - a map inside a function that is not already the first argument of `.t(` becomes `ctx.t("…")`,
//     so the extractor finds it (the `ctx` must be in scope; where it is not, the map is reported);
//   - a map at the top of the module (a const used in a slot) becomes its string too, and is
//     reported: the extractor cannot see words behind a const, so it must be inlined by hand.
// One source text with two translations in a language is reported: the first is kept.
// Positions come from @babel/parser and text is spliced with magic-string: nothing else moves.

import { parse } from "@babel/parser";
import MagicString from "magic-string";

interface Node {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } };
  [k: string]: unknown;
}

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const keyName = (p: Node): string | undefined => {
  const k = p.key as { name?: string; value?: unknown } | undefined;
  return p.computed === true ? undefined : (k?.name ?? (typeof k?.value === "string" ? k.value : undefined));
};
const literal = (n: Node | undefined): string | null => {
  if (!n) return null;
  if (n.type === "StringLiteral") return String(n.value);
  if (n.type === "TemplateLiteral" && asArray(n.expressions).length === 0) return asArray(n.quasis).map((q) => (q.value as { cooked: string }).cooked).join("");
  return null;
};

/** A translation map: every key a language, every value a literal string, the app's language among them. */
function asMap(n: Node, own: string): Record<string, string> | null {
  if (n.type !== "ObjectExpression") return null;
  const props = asArray(n.properties);
  if (props.length < 2) return null;
  const out: Record<string, string> = {};
  for (const p of props) {
    if (p.type !== "ObjectProperty") return null;
    const k = keyName(p);
    const v = literal(p.value as Node);
    if (!k || !LANGUAGE.test(k) || v === null) return null;
    out[k] = v;
  }
  return typeof out[own] === "string" ? out : null;
}

export interface Converted {
  source: string;
  /** language → catalog key (`context\u0004text`, or the text) → translation */
  catalogs: Record<string, Map<string, string>>;
  maps: number;
  wrapped: number;
  /** Words marked with `msg` where they are written (behind a const, or with no ctx in scope). */
  marked: number;
  /** Texts translated more than one way, now told apart by a context. */
  contexts: number;
  reports: string[];
}

interface Occurrence {
  node: Node;
  text: string;
  map: Record<string, string>;
  isTArg: boolean;
  inFn: boolean;
  ctxInScope: boolean;
  inDef: boolean;
  /** Where it sits, for a context's name: the nearest meaningful property keys. */
  hint: string;
}

/** Keys that say nothing about meaning ("label", "fields"): a context is named by the others. */
const GENERIC = new Set(["label", "labels", "title", "fields", "entities", "pages", "view", "views", "display", "items", "layout", "actions", "sections", "summary", "groups", "of", "input", "options", "primary", "secondary", "detail", "value", "text", "placeholder", "help", "emptyText", "description", "name", "en"]);

export function convert(source: string, own = "en"): Converted {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }) as unknown as Node;
  const ms = new MagicString(source);
  const reports: string[] = [];
  const found: Occurrence[] = [];

  /** Is `ctx` a parameter of one of the enclosing functions (or a name in a destructured one)? */
  const hasCtx = (fns: Node[]): boolean =>
    fns.some((f) =>
      asArray(f.params).some((p) => {
        const id = p.type === "AssignmentPattern" ? (p.left as Node) : p;
        return (id.type === "Identifier" && id.name === "ctx") || (id.type === "ObjectPattern" && asArray(id.properties).some((q) => keyName(q) === "ctx"));
      }),
    );

  const visit = (n: unknown, parent: Node | null, fns: Node[], inDef: boolean, keys: string[]): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (!node.type) return;
    const map = asMap(node, own);
    // `{ en: "English", pl: "Polski" } as const`: data looked up by language (each language's own name),
    // not words to translate. Left as it is.
    if (map && parent?.type === "TSAsExpression") {
      reports.push(`line ${node.loc?.start.line}: a map under \`as const\` is left as it is: data looked up by language, not words`);
      return;
    }
    if (map) {
      const isTArg = parent?.type === "CallExpression" && (parent.callee as Node)?.type === "MemberExpression" && ((parent.callee as Node).property as Node)?.name === "t" && asArray(parent.arguments)[0] === node;
      const meaningful = keys.filter((k) => !GENERIC.has(k) && !/^\d+$/.test(k));
      found.push({ node, text: map[own]!, map, isTArg, inFn: fns.length > 0, ctxInScope: hasCtx(fns), inDef, hint: meaningful.slice(-2).join(" ") || keys.filter((k) => !/^\d+$/.test(k)).slice(-1).join("") || "other" });
      return;
    }
    const isFn = node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration" || node.type === "ObjectMethod";
    const inner = isFn ? [...fns, node] : fns;
    // Inside `defineApp({...})`: a map there is a slot, which the extractor reads.
    const def = inDef || (node.type === "CallExpression" && (node.callee as Node)?.name === "defineApp");
    const here = node.type === "ObjectProperty" || node.type === "ObjectMethod" ? [...keys, keyName(node) ?? ""] : node.type === "VariableDeclarator" ? [...keys, String((node.id as Node)?.name ?? "")] : keys;
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      if (Array.isArray(value)) value.forEach((v) => visit(v, node, inner, def, here));
      else if (value && typeof value === "object" && (value as Node).type) visit(value, node, inner, def, here);
    }
  };
  visit(ast, null, [], false, []);

  // One text translated more than one way means two meanings. The first way keeps the plain text;
  // each other way is told apart by a context named for where it sits.
  const contextOf = new Map<Occurrence, string>();
  const byText = new Map<string, Occurrence[]>();
  for (const o of found) byText.set(o.text, [...(byText.get(o.text) ?? []), o]);
  let contexts = 0;
  for (const [text, list] of byText) {
    const ways = new Map<string, Occurrence[]>();
    for (const o of list) {
      const key = JSON.stringify(Object.entries(o.map).filter(([l]) => l !== own).sort());
      ways.set(key, [...(ways.get(key) ?? []), o]);
    }
    if (ways.size < 2) continue;
    const used = new Set<string>();
    [...ways.values()].slice(1).forEach((group) => {
      let name = group[0]!.hint;
      for (let i = 2; used.has(name) || name === ""; i++) name = `${group[0]!.hint} ${i}`;
      used.add(name);
      contexts++;
      for (const o of group) contextOf.set(o, name);
      reports.push(`"${text}" means two things here: the one at line ${group[0]!.node.loc?.start.line} is now { text, context: "${name}" }`);
    });
  }

  const catalogs: Record<string, Map<string, string>> = {};
  let wrapped = 0;
  let marked = 0;
  for (const o of found) {
    const context = contextOf.get(o);
    const key = context ? `${context}\u0004${o.text}` : o.text;
    for (const [lang, t] of Object.entries(o.map)) if (lang !== own) (catalogs[lang] ??= new Map()).set(key, t);
    const words = context ? `{ text: ${JSON.stringify(o.text)}, context: ${JSON.stringify(context)} }` : JSON.stringify(o.text);
    if (o.isTArg || (!o.inFn && o.inDef)) {
      // A slot, or the words of a ctx.t: the extractor reads them where they are.
      ms.overwrite(o.node.start, o.node.end, words);
    } else if (o.inFn && o.ctxInScope) {
      ms.overwrite(o.node.start, o.node.end, `ctx.t(${words})`);
      wrapped++;
    } else {
      // Behind a const, or in a function with no ctx: marked where it is written, translated where a
      // ctx.t shows it (or where a slot reads it — a slot's words are looked up all the same).
      ms.overwrite(o.node.start, o.node.end, `msg(${words})`);
      marked++;
    }
  }
  // `msg` comes from potyro, beside whatever the app already imports from it.
  if (marked) {
    const potyro = asArray((ast as Node & { program?: Node }).program?.body).find((n) => n.type === "ImportDeclaration" && (n.source as Node)?.value === "potyro" && n.importKind !== "type");
    const named = potyro ? asArray(potyro.specifiers).filter((sp) => sp.type === "ImportSpecifier") : [];
    if (named.some((sp) => (sp.imported as Node)?.name === "msg")) {
      // already there
    } else if (named.length) ms.appendLeft(named[named.length - 1]!.end, ", msg");
    else ms.prepend('import { msg } from "potyro";\n');
  }
  return { source: ms.toString(), catalogs, maps: found.length, wrapped, marked, contexts, reports };
}
