// The pseudo-language (#298): English, with every letter swapped for an accented look-alike, every
// message bracketed and padded by about a third.
//
//   "Find an app"  →  "⟦Ƒîñð åñ åþþ ·····⟧"
//
// It answers three questions by looking: is this text in a catalog (a plain-ASCII word is not), is
// it one message or two glued together (each message has its own brackets), and does the layout
// survive the longer strings German and Polish will bring (the padding).
//
// Built from the compiled English catalog at the moment it is chosen, never shipped as a catalog:
// it can never be stale, and a production build does not carry it (the shell only offers it in dev).

import type { Messages } from "@lingui/core";
import { accent } from "./accent.js";

export { accent };
export const PSEUDO_OPEN = "⟦";
export const PSEUDO_CLOSE = "⟧";

const padFor = (length: number): string => (length > 0 ? ` ${"·".repeat(Math.max(1, Math.ceil(length * 0.35)))}` : "");

type Token = string | unknown[];

/** Visible length of a compiled message: its literal text, ignoring placeholders and markers. */
function textLength(tokens: readonly Token[]): number {
  return tokens.reduce<number>((n, t) => {
    if (typeof t === "string") return n + t.replace(/<\/?\d+\/?>/g, "").length;
    // A plural or select: as long as its longest branch.
    const format = (t as unknown[])[2];
    if (!format || typeof format !== "object" || Array.isArray(format)) return n;
    const branches = Object.values(format as Record<string, unknown>).map((b) => (typeof b === "string" ? b.length : Array.isArray(b) ? textLength(b as Token[]) : 0));
    return n + Math.max(0, ...branches);
  }, 0);
}

function accentTokens(tokens: readonly Token[]): Token[] {
  return tokens.map((t) => {
    if (typeof t === "string") return accent(t);
    // [name] | [name, "plural"|"select"|"selectordinal", { branch: CompiledMessage }] | [name, "number"|"date", format]
    const [name, type, format] = t as [string, string?, unknown?];
    if (format && typeof format === "object" && !Array.isArray(format)) {
      const branches = Object.fromEntries(
        Object.entries(format as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? accent(v) : Array.isArray(v) ? accentTokens(v as Token[]) : v]),
      );
      return [name, type, branches];
    }
    return t;
  });
}

/** One compiled message in the pseudo-language. */
export function pseudoMessage(message: unknown): unknown {
  const tokens: Token[] = typeof message === "string" ? [message] : Array.isArray(message) ? (message as Token[]) : [];
  if (!tokens.length) return message;
  const body = accentTokens(tokens);
  return [PSEUDO_OPEN, ...body, `${padFor(textLength(tokens))}${PSEUDO_CLOSE}`];
}

/** A whole compiled catalog in the pseudo-language. */
export function pseudoMessages(source: Messages): Messages {
  return Object.fromEntries(Object.entries(source).map(([id, m]) => [id, pseudoMessage(m)])) as Messages;
}
