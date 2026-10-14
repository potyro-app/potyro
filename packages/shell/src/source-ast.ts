// The parsing half of the shell's source tools (app-source.ts): a lazy @babel/parser + magic-string,
// and the helpers that find things in an app's `defineApp({...})` literal. Split out of app-source.ts
// so the structural editor and its words (app-source-words.ts, #302) share one toolchain.

import type MagicStringType from "magic-string";

// ---------------------------------------------------------------------------------------------
// Lazy toolchain. Both are only needed once someone actually opens the editor, and together they
// are ~85 kB gzipped — the same lazy treatment MapLibre gets.

export interface Node {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}
export interface Tools {
  parse: (code: string, opts: object) => Node;
  MagicString: new (s: string) => MagicStringType;
}
let tools: Promise<Tools | null> | null = null;

/** Test seam: drop the cached toolchain so the next call re-imports. */
export function resetSourceTools(): void {
  tools = null;
}

export async function load(): Promise<Tools | null> {
  tools ??= (async () => {
    try {
      const [babel, magic] = await Promise.all([import("@babel/parser"), import("magic-string")]);
      return {
        parse: babel.parse as unknown as Tools["parse"],
        MagicString: (magic.default ?? magic) as unknown as Tools["MagicString"],
      };
    } catch (e) {
      console.warn("[potyro] structural editing unavailable:", e);
      tools = null; // a transient chunk failure shouldn't disable it for the session
      return null;
    }
  })();
  return tools;
}

export function parseModule(t: Tools, source: string): Node | null {
  try {
    // TSX, because a custom view is a React component in the same file.
    return t.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: false });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Locating things

export const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
export const keyOf = (prop: Node): string | undefined => {
  const key = prop.key as { name?: string; value?: unknown } | undefined;
  if (typeof key?.name === "string") return key.name;
  return typeof key?.value === "string" ? key.value : undefined;
};

/** The object literal handed to `defineApp(...)`, or null if the call isn't shaped that way. */
export function findDefinition(ast: Node): Node | null {
  let found: Node | null = null;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "CallExpression" && (node.callee as Node | undefined)?.name === "defineApp") {
      const arg = asArray(node.arguments)[0];
      found = arg?.type === "ObjectExpression" ? arg : null;
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

/** A named property of an object literal, if it is written literally (not spread, not computed). */
export function prop(obj: Node | null, name: string): Node | null {
  if (obj?.type !== "ObjectExpression") return null;
  for (const p of asArray(obj.properties)) {
    if (p.type === "ObjectProperty" && p.computed !== true && keyOf(p) === name) return p;
  }
  return null;
}
export const propValue = (obj: Node | null, name: string): Node | null => (prop(obj, name)?.value as Node | undefined) ?? null;

/** True when an object literal has anything we can't address by key. */
export const hasOpaqueMembers = (obj: Node): boolean =>
  asArray(obj.properties).some((p) => p.type !== "ObjectProperty" || p.computed === true);

export function literalString(node: Node | null): string | undefined {
  return node?.type === "StringLiteral" && typeof node.value === "string" ? node.value : undefined;
}

/** Words written literally (#302): a string, or a translation map whose every entry is a string. */
export function literalWords(node: Node | null): string | Record<string, string> | undefined {
  const s = literalString(node);
  if (s !== undefined || node?.type !== "ObjectExpression") return s;
  const map = literalOf(node);
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  const entries = Object.entries(map);
  return entries.length && entries.every(([, v]) => typeof v === "string") ? (map as Record<string, string>) : undefined;
}

/** The app's `language`/`languages`, when written literally. */
export function literalLanguages(def: Node | null): { language?: string; languages?: string[] } {
  const language = literalString(propValue(def, "language"));
  const languages = literalOf(propValue(def, "languages"));
  const list = Array.isArray(languages) && languages.every((l) => typeof l === "string") ? (languages as string[]) : undefined;
  return { ...(language ? { language } : {}), ...(list ? { languages: list } : {}) };
}

export type JsonLiteral = string | number | boolean | null | JsonLiteral[] | { [k: string]: JsonLiteral };

/** A node's value when it is written as a literal; `undefined` for anything that would need running.
 *  Object members that aren't literal are dropped, so `{ type: "text", default: () => "" }` reads as
 *  `{ type: "text" }`. */
export function literalOf(node: Node | null | undefined): JsonLiteral | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value as JsonLiteral;
    case "NullLiteral":
      return null;
    case "TemplateLiteral":
      return asArray(node.expressions).length === 0 ? asArray(node.quasis).map((q) => (q.value as { cooked: string }).cooked).join("") : undefined;
    case "UnaryExpression": {
      const arg = literalOf(node.argument as Node);
      return node.operator === "-" && typeof arg === "number" ? -arg : undefined;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return literalOf(node.expression as Node);
    case "ArrayExpression": {
      const items = asArray(node.elements).map((el) => literalOf(el));
      return items.every((v) => v !== undefined) ? (items as JsonLiteral[]) : undefined;
    }
    case "ObjectExpression": {
      const obj: Record<string, JsonLiteral> = {};
      for (const p of asArray(node.properties)) {
        if (p.type !== "ObjectProperty" || p.computed === true) continue;
        const key = keyOf(p);
        const value = literalOf(p.value as Node);
        if (key && value !== undefined) obj[key] = value;
      }
      return obj;
    }
    default:
      return undefined;
  }
}
