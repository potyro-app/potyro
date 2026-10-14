/// <reference path="./po.d.ts" />
// "Suggest a better wording" (#300): Potyro's own messages as a person reads them, which of them a
// screen is showing, and finding one by what it says.
//
// The drafts in five languages were written by a model (#297), and the person reading one is the
// best judge of where it reads wrong. To point at a sentence they need to see it as it is on their
// screen, so a message is matched against the screen's text with its placeholders as wildcards —
// "Usunąć {label}?" is the message behind "Usunąć Monstera?" — and found by its words in the
// language shown or in English. No DOM here: the shell hands in the texts it read off the screen.

import { messages as en } from "../locales/en/messages.po";
import { i18n } from "./i18n.js";

/** One of Potyro's messages: its id, how it reads now (a placeholder as …), the same in English. */
export interface CatalogMessage {
  id: string;
  text: string;
  english: string;
  /** The compiled message, for matching the screen. */
  pattern: unknown;
  /** Found on screen: the text there, its placeholders filled in ("Usunąć Monstera?"). */
  seen?: string;
}

type Token = string | unknown[];
const MARKUP = /<\/?\d+\/?>/g;
const PLACEHOLDER = "…";

/** A compiled message as one line a person reads: a placeholder as …, a plural or a select as its `other` arm. */
export function messageText(message: unknown): string {
  const tokens: Token[] = typeof message === "string" ? [message] : Array.isArray(message) ? (message as Token[]) : [];
  return tokens
    .map((t) => {
      if (typeof t === "string") return t.replace(MARKUP, "");
      const [, type, format] = t as [string, string?, unknown?];
      if ((type === "plural" || type === "select" || type === "selectordinal") && format && typeof format === "object") {
        const branches = format as Record<string, unknown>;
        const arm = branches.other ?? Object.values(branches)[0];
        return messageText(arm).replace(/#/g, PLACEHOLDER);
      }
      return PLACEHOLDER;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The message as a pattern over the text it renders: its words as they are, anything where it fills something in. */
function patternOf(message: unknown): RegExp | null {
  const tokens: Token[] = typeof message === "string" ? [message] : Array.isArray(message) ? (message as Token[]) : [];
  let source = "";
  let literal = "";
  for (const t of tokens) {
    if (typeof t === "string") {
      const words = t.replace(MARKUP, "");
      literal += words;
      source += escape(words).replace(/\s+/g, "\\s+");
    } else source += ".+?";
  }
  // A message that is all placeholder ("{autonym} — {language}") would match any text at all: it is
  // found by searching, never offered off the screen.
  if (!/\p{L}/u.test(literal)) return null;
  return new RegExp(`^\\s*${source}\\s*$`, "s");
}

const patterns = new WeakMap<object, RegExp | null>();
const cachedPattern = (m: CatalogMessage): RegExp | null => {
  const key = m as object;
  if (!patterns.has(key)) patterns.set(key, patternOf(m.pattern));
  return patterns.get(key)!;
};

/** The longest run of plain words in a message: a cheap test for whether a screen could show it at all. */
function anchorOf(m: CatalogMessage): string {
  const tokens: Token[] = typeof m.pattern === "string" ? [m.pattern] : Array.isArray(m.pattern) ? (m.pattern as Token[]) : [];
  return tokens
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(MARKUP, "").trim())
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

const hasPlaceholder = (m: CatalogMessage): boolean => Array.isArray(m.pattern) && (m.pattern as Token[]).some((t) => typeof t !== "string");

/**
 * The messages behind these texts (each a whole text on screen: an element's words, a label, a
 * placeholder), in the order the screen shows them, and each wording once — two messages that read
 * the same are one thing to the person. A text that is a message word for word is that message,
 * not also every message with a placeholder that could have produced it ("Dodaj aplikację" is not
 * "Dodaj {name}").
 */
export function messagesShown(texts: readonly string[], messages: readonly CatalogMessage[]): CatalogMessage[] {
  const all = texts.join("\n");
  const candidates = messages.filter((m) => {
    const anchor = anchorOf(m);
    return anchor && all.includes(anchor.split(/\s+/)[0]!);
  });
  const seen = new Set<string>();
  const out: CatalogMessage[] = [];
  for (const text of texts) {
    const matching = candidates.filter((m) => cachedPattern(m)?.test(text));
    const exact = matching.filter((m) => !hasPlaceholder(m));
    for (const m of exact.length ? exact : matching) {
      if (seen.has(m.text)) continue;
      seen.add(m.text);
      out.push({ ...m, seen: text });
    }
  }
  return out;
}

const fold = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();

/** The messages whose words — as they read now, or in English — have `query` in them; none for an empty query. */
export function findMessages(query: string, messages: readonly CatalogMessage[], max = 20): CatalogMessage[] {
  const q = fold(query.trim());
  if (!q) return [];
  const seen = new Set<string>();
  return messages
    .filter((m) => (fold(m.text).includes(q) || fold(m.english).includes(q)) && !seen.has(m.text) && Boolean(seen.add(m.text)))
    .slice(0, max);
}

/** Every message of the language being shown, beside its English. */
export function catalogMessages(): CatalogMessage[] {
  const shown = i18n.messages;
  const out: CatalogMessage[] = [];
  for (const [id, source] of Object.entries(en)) {
    const pattern = shown[id] ?? source;
    const text = messageText(pattern);
    const english = messageText(source);
    if (!text.replace(/…/g, "").trim()) continue;
    out.push({ id, text, english, pattern });
  }
  return out;
}
