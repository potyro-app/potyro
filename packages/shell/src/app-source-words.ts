// The structural editor and a translated app's words (#302, docs/20 §5.1).
//
// A label or a page title written as a translation map — `{ en: "Quantity", pl: "Ilość" }` — is
// still a literal, so the editor offers one input per language instead of no control at all. Saving
// one language writes that entry of the map and nothing else; the other languages stay as written.
// Changing the app's own language makes the others possibly stale, which the panel says — and only
// the panel: nothing is written to the source for it.

import type MagicStringType from "magic-string";
import { asArray, keyOf, literalWords, type Node } from "./source-ast.js";

/** A literal translation map's entries, when `node` is one. */
export function wordsMapOf(node: Node | null): Record<string, string> | undefined {
  const w = literalWords(node);
  return w && typeof w === "object" ? w : undefined;
}

const quoteKey = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/**
 * Write `value` as the `language` entry of the map at `node`: replaced when there, added after the
 * last entry when not. `false` when `node` is not a literal map — the caller says why.
 */
export function setWordsEntry(ms: MagicStringType, node: Node | null, language: string, value: string): boolean {
  if (!node || node.type !== "ObjectExpression" || !wordsMapOf(node)) return false;
  const props = asArray(node.properties);
  const entry = props.find((p) => keyOf(p) === language);
  if (entry) ms.overwrite((entry.value as Node).start, (entry.value as Node).end, JSON.stringify(value), { contentOnly: true });
  else if (props.length) ms.appendLeft(props[props.length - 1]!.end, `, ${quoteKey(language)}: ${JSON.stringify(value)}`);
  else ms.appendLeft(node.start + 1, ` ${quoteKey(language)}: ${JSON.stringify(value)} `);
  return true;
}

/** The languages a panel shows inputs for: the app's own first, then the rest it carries, then any the map has. */
export function editorLanguages(map: Record<string, string>, own: string | undefined, carried: readonly string[] | undefined): string[] {
  const order = [...(own ? [own] : []), ...(carried ?? []), ...Object.keys(map)];
  return order.filter((l, i) => order.indexOf(l) === i);
}
