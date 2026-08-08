// Syntax highlighting for app source, as DATA rather than as HTML.
//
// Prism is the tokenizer (its TSX grammar handles what a hand-rolled lexer gets wrong: JSX, template
// literals, regex-vs-division) but its `highlight()` returns an HTML string, which would mean
// `dangerouslySetInnerHTML` over source that can come from an app someone else wrote. So this module
// stops at `tokenize` and returns plain runs; the callers render real React spans and the escaping
// question never arises.
//
// Output is grouped BY LINE because both callers need lines: the Studio paints a highlighted layer
// behind a textarea (one line must sit exactly on one line), and the History diff renders one row per
// line. Tokens that straddle a newline — block comments, template literals — are split across lines
// with their class preserved.
//
// Prism is lazy-imported, like MapLibre: highlighting is not on the path to running an app, and it
// should not be in the bundle you download before you can.

/** A stretch of text sharing one set of token classes. `cls` is absent for unhighlighted text. */
export interface CodeRun {
  text: string;
  /** Prism classes, e.g. `token keyword`. */
  cls?: string;
}

interface PrismToken {
  type: string;
  content: PrismContent;
  alias?: string | string[];
}
type PrismContent = string | PrismToken | PrismContent[];
interface PrismApi {
  languages: Record<string, object | undefined>;
  tokenize(text: string, grammar: object): PrismContent[];
}

let prism: Promise<PrismApi | null> | null = null;

/** Test seam: drop the cached loader so the next call re-imports. */
export function resetHighlighter(): void {
  prism = null;
}

async function load(): Promise<PrismApi | null> {
  prism ??= (async () => {
    try {
      // Prism auto-highlights the whole document on load unless told not to. Nothing here wants
      // that: it would walk the DOM behind React's back. The flag is read as core evaluates, so it
      // has to be set before the import.
      const g = globalThis as { Prism?: { manual?: boolean } };
      g.Prism = { ...g.Prism, manual: true };

      // Sequential, not Promise.all: each grammar registers itself against the previous one, and
      // `tsx` is built from `jsx` + `typescript`.
      const core = (await import("prismjs")) as unknown as { default?: PrismApi } & PrismApi;
      await import("prismjs/components/prism-typescript.js");
      await import("prismjs/components/prism-jsx.js");
      await import("prismjs/components/prism-tsx.js");
      return core.default ?? core;
    } catch (e) {
      // Highlighting is decoration. Losing it must not cost the user their editor.
      console.warn("[karta] syntax highlighting unavailable:", e);
      prism = null; // a transient chunk failure shouldn't disable highlighting for the session
      return null;
    }
  })();
  return prism;
}

function classOf(token: PrismToken): string {
  const alias = Array.isArray(token.alias) ? token.alias.join(" ") : token.alias;
  return `token ${token.type}${alias ? ` ${alias}` : ""}`;
}

/** Walk Prism's token tree into a flat run list, keeping the OUTERMOST class of each leaf. */
function flatten(content: PrismContent, cls: string | undefined, out: CodeRun[]): void {
  if (typeof content === "string") {
    if (content) out.push(cls ? { text: content, cls } : { text: content });
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content) flatten(part, cls, out);
    return;
  }
  // A nested token wins over its parent's class — that is what gives `${…}` inside a template
  // literal, or an attribute inside a JSX tag, its own colour.
  flatten(content.content, classOf(content), out);
}

/** Split runs into lines, breaking any run that spans a newline. */
function toLines(runs: readonly CodeRun[]): CodeRun[][] {
  const lines: CodeRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push(run.cls ? { text: part, cls: run.cls } : { text: part });
    });
  }
  return lines;
}

/** One entry per line of `code`. Falls back to unhighlighted lines if Prism can't load. */
export async function highlightLines(code: string): Promise<CodeRun[][]> {
  const plain = (): CodeRun[][] => code.split("\n").map((text) => (text ? [{ text }] : []));
  const api = await load();
  const grammar = api?.languages.tsx;
  if (!api || !grammar) return plain();
  try {
    const runs: CodeRun[] = [];
    flatten(api.tokenize(code, grammar), undefined, runs);
    const lines = toLines(runs);
    // A tokenizer that dropped or invented a line would silently misalign the Studio's paint layer
    // against its textarea. Cheaper to check than to debug.
    return lines.length === code.split("\n").length ? lines : plain();
  } catch (e) {
    console.warn("[karta] could not highlight source:", e);
    return plain();
  }
}
