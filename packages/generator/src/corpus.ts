// The project's own material, for the model to search and read (#262).
//
// The reference (reference.generated.ts) tells the model what an app CAN declare; it cannot show how
// a real app puts those parts together. When Claude Code built apps/piano it read the example apps
// and the API docs and copied what worked. The Studio's model got three small inline examples. This
// is the same material as the repository has, collected at build time into one versioned corpus
// that ships with each release — so what the model reads always matches the code the person is
// running, works offline, and reaches every engine the same way.
//
// Pure functions only: the corpus is data, and searching it needs no Node. `corpus-files.ts` collects
// the sources from disk (Node, for the build script and the staleness test); `load-corpus.ts` loads
// the generated corpus lazily, as its own chunk, in the browser.

import { buildLexicon, englishFor, englishView, translationLanguages, withSource, type Lexicon, type WordPair } from "./corpus-lexicon.js";
import { classifyText, type Language } from "./language.js";

export interface CorpusFile {
  /** Repository-relative, forward slashes: `examples/recipes.app.tsx`. */
  path: string;
  text: string;
}

export interface Corpus {
  /** A hash of every path and text, so a transcript can say which corpus the model read. */
  version: string;
  files: CorpusFile[];
  /** Potyro's own short messages in each language beside their English (the shell's catalogs): words
   *  priming reads a request in, never a passage to show (corpus-lexicon.ts). */
  words?: WordPair[];
}

/** What a release's corpus is made of, as plain rules. `corpus-files.ts` applies them to the disk. */
export const CORPUS_SOURCES = {
  /** Every example app module. */
  examples: /^examples\/[^/]+\.app\.tsx?$/,
  /** A personal app's own source: its modules and README, never its tests, build config or output. */
  apps: /^apps\/[^/]+\/(?!.*\.config\.)[^/]+\.(?:tsx?|md)$/,
  docs: ["docs/04-app-module-api.md", "docs/05-runtime-interfaces.md"],
  /** The schema's type declarations, the same files the reference is generated from. */
  types: /^packages\/schema\/src\/types\/[^/]+\.ts$/,
} as const;

export function inCorpus(path: string): boolean {
  return (
    CORPUS_SOURCES.examples.test(path) ||
    CORPUS_SOURCES.apps.test(path) ||
    (CORPUS_SOURCES.docs as readonly string[]).includes(path) ||
    CORPUS_SOURCES.types.test(path)
  );
}

/** FNV-1a, 32 bits, hex. Not security — a stable name for one corpus's content. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Files sorted by path, so the same sources always make the same corpus and the same version. */
export function buildCorpus(files: readonly CorpusFile[], words: readonly WordPair[] = []): Corpus {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const content = sorted.map((f) => `${f.path}\0${f.text}`).join("\0");
  if (!words.length) return { version: hash(content), files: sorted };
  return { version: hash(`${content}\0${words.map((w) => w.join("\u0001")).join("\0")}`), files: sorted, words: [...words] };
}

// ---- search ----

const CHUNK_LINES = 30;
const SEARCH_MAX_CHARS = 6000;
const SEARCH_MAX_HITS = 5;

interface Chunk {
  path: string;
  /** 1-based first line. */
  start: number;
  lines: string[];
}

function chunks(file: CorpusFile): Chunk[] {
  const lines = file.text.split("\n");
  const out: Chunk[] = [];
  // Overlapping windows, so a match near a boundary still comes with the lines around it.
  for (let i = 0; i < lines.length; i += CHUNK_LINES / 2) {
    out.push({ path: file.path, start: i + 1, lines: lines.slice(i, i + CHUNK_LINES) });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return out;
}

/** A query's words, in any script ("ćwiczenie" stays one word), with `ctx.files` read as both parts. */
function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_$.]+/u).flatMap((t) => t.split(".")).filter((t) => t.length > 1))];
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

interface Scored {
  chunk: Chunk;
  score: number;
  /** Distinct query terms the passage has. */
  matched: number;
}

/**
 * Every passage of `files` that has any of the query's terms, best first. Each term is a group of
 * alternatives — a word and the English words it stands for (corpus-lexicon.ts) — that counts once,
 * by its best alternative. Every term found counts more than many hits of one, so `ctx.files import`
 * prefers a passage with both over one that says `files` twenty times; `bonus` terms (the app's own
 * shape) only tip the balance between equals. `view` is what of a passage is matched (a request in
 * another language matches its English, `englishView`); the passage shown is always the whole of it.
 */
function rankChunks(
  files: readonly CorpusFile[],
  groups: readonly (readonly string[])[],
  bonus: readonly string[] = [],
  view: (text: string) => string = (text) => text,
): Scored[] {
  const all = files.flatMap(chunks);
  const lowered = all.map((c) => view(c.lines.join("\n")).toLowerCase());
  const docFreq = new Map<string, number>();
  for (const w of groups.flat()) if (!docFreq.has(w)) docFreq.set(w, lowered.filter((t) => t.includes(w)).length);
  return all
    .map((chunk, i) => {
      let score = 0;
      let matched = 0;
      for (const group of groups) {
        let best = 0;
        for (const w of group) {
          const n = count(lowered[i]!, w);
          if (n) best = Math.max(best, (1 + Math.log(n)) * Math.log(1 + all.length / (docFreq.get(w)! || 1)));
        }
        if (!best) continue;
        matched++;
        score += best;
      }
      const tip = bonus.filter((b) => lowered[i]!.includes(b)).length * BONUS;
      return { chunk, score: score * matched * matched + (matched ? tip : 0), matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

const BONUS = 0.1;

/** Keep one passage per region of a file: overlapping windows would otherwise repeat each other. */
function distinct(scored: readonly Scored[], max: number, perFile = Infinity): Chunk[] {
  const picked: Chunk[] = [];
  for (const { chunk } of scored) {
    if (picked.some((p) => p.path === chunk.path && Math.abs(p.start - chunk.start) < CHUNK_LINES)) continue;
    if (picked.filter((p) => p.path === chunk.path).length >= perFile) continue;
    picked.push(chunk);
    if (picked.length >= max) break;
  }
  return picked;
}

const passage = (c: Chunk, maxChars = Infinity): string => {
  const end = c.start + c.lines.length - 1;
  let body = c.lines.join("\n");
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n…`;
  return `--- ${c.path}:${c.start}-${end}\n${body}\n`;
};

/**
 * The passages that best answer a query, with where they live. Plain text, capped; a clear "nothing"
 * when there is nothing.
 */
export function searchCorpus(corpus: Corpus, query: string): string {
  const words = terms(query);
  if (!words.length) return "Ask with a few words: a feature (\"custom view canvas\"), a ctx member (\"ctx.files\"), a field type (\"relation many\").";
  const picked = distinct(rankChunks(corpus.files, words.map((w) => [w])), SEARCH_MAX_HITS);
  if (!picked.length) return `Nothing in the examples, the docs or the schema types mentions ${words.map((w) => `"${w}"`).join(" or ")}.`;

  let out = "";
  for (const c of picked) {
    const block = passage(c);
    if (out.length + block.length > SEARCH_MAX_CHARS) {
      if (!out) out = block.slice(0, SEARCH_MAX_CHARS);
      break;
    }
    out += block;
  }
  return `${out}\n(read(path, line) shows more of a file.)`;
}

// ---- priming: retrieval done by the harness, before the first turn ----

const PRIME_FILES = 2;
const PRIME_CHUNK_CHARS = 1400;
const PRIME_MAX_CHARS = 3000;
/** A request's words that say nothing about what it is for. Short, on purpose: the ranking's IDF does the rest. */
const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "when", "then", "also", "each", "every", "all", "its", "our", "your", "please", "can", "you", "want", "should", "make", "add", "new"]);

const primeTerms = (instruction: string): string[] => terms(instruction).filter((t) => t.length >= 3 && !STOPWORDS.has(t));

/** The corpus's lexicon and the languages its translation maps carry, mined once per corpus (it is a
 *  release's, and never changes). */
interface Mined {
  lex: Lexicon;
  languages: Set<string>;
}
const mined = new WeakMap<Corpus, Mined>();
function corpusMined(corpus: Corpus): Mined {
  let m = mined.get(corpus);
  if (!m) {
    const sources = corpus.files.filter((f) => /\.tsx?$/.test(f.path)).map((f) => f.text);
    mined.set(corpus, (m = { lex: buildLexicon(sources, corpus.words ?? []), languages: translationLanguages(sources) }));
  }
  return m;
}

/** Whether the request is in a language other than English: the one the loop was told, else as it reads. */
function foreign(instruction: string, language: Language | undefined): boolean {
  if (language) return language !== "en";
  const read = classifyText(instruction);
  return read !== null && read !== "en";
}

/**
 * The request's terms, each a group: the word, then the English words it stands for in the corpus
 * and the app being edited (corpus-lexicon.ts) when the request is not in English. A word the
 * sources also use in English is matched as it is. An English request's groups are its words alone,
 * so it primes exactly as it did.
 */
export function primeGroups(corpus: Corpus, instruction: string, source: string, language?: Language): string[][] {
  return primeQuery(corpus, instruction, source, language).groups;
}

/** The request's terms (primeGroups) and, for a request not in English, what of a passage they match. */
function primeQuery(corpus: Corpus, instruction: string, source: string, language?: Language): { groups: string[][]; view?: (text: string) => string } {
  const words = primeTerms(instruction);
  if (!foreign(instruction, language)) return { groups: words.map((w) => [w]) };
  const base = corpusMined(corpus);
  const lex = source ? withSource(base.lex, source) : base.lex;
  const groups = words.map((w) => {
    if (lex.englishCount.has(w) || !/\p{L}/u.test(w)) return [w];
    const english = englishFor(lex, w).filter((e) => e.length >= 3 && !STOPWORDS.has(e));
    return [w, ...english];
  });
  const languages = source ? new Set([...base.languages, ...translationLanguages([source])]) : base.languages;
  return { groups, view: (text) => englishView(text, languages) };
}

/** The `type: "…"` values an app source uses — its shape, as words the corpus can be matched on. */
const shapeTerms = (source: string): string[] => [...new Set([...source.matchAll(/\btype:\s*["']([a-z]+)["']/g)].map((m) => m[1]!))];

const appIdOf = (source: string): string | undefined => /\bid:\s*["']([^"']+)["']/.exec(source)?.[1];
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The passages priming would pick, best first, at most `max` of them and one per file. */
function primePicks(corpus: Corpus, instruction: string, source: string, language: Language | undefined, max: number): Chunk[] {
  const { groups, view } = primeQuery(corpus, instruction, source, language);
  if (groups.length < 2) return [];
  const self = appIdOf(source);
  const selfRe = self ? new RegExp(`\\bid:\\s*["']${escapeRe(self)}["']`) : null;
  const files = corpus.files.filter((f) => !f.path.startsWith("packages/") && !(selfRe && selfRe.test(f.text)));
  return distinct(
    rankChunks(files, groups, shapeTerms(source), view).filter((s) => s.matched >= 2),
    max,
    1,
  );
}

/** The files priming would quote with room for `max` (the eval's yardstick: English's top five). */
export function primeRankedFiles(corpus: Corpus, instruction: string, source: string, language: Language | undefined, max: number): string[] {
  return primePicks(corpus, instruction, source, language, max).map((c) => c.path);
}

/**
 * What the model should have read before its first turn (#262): the one or two corpus files that
 * speak to the request, around where they do. A passage must share at least two of the request's
 * words — one shared word is a coincidence, not a precedent. The app being edited is never offered
 * back to itself, and the schema types are left out: the reference carries the core, and the
 * request's own turn carries the declarations of the capabilities it names (`capabilityNotes`,
 * #341). Empty when the corpus has nothing to say, so the first message says nothing either.
 */
export function primeCorpus(corpus: Corpus, instruction: string, source: string, language?: Language): string {
  const picked = primePicks(corpus, instruction, source, language, PRIME_FILES);
  if (!picked.length) return "";
  let out = "";
  for (const c of picked) {
    const block = passage(c, PRIME_CHUNK_CHARS);
    if (out.length + block.length > PRIME_MAX_CHARS) break;
    out += block;
  }
  if (!out) return "";
  return `From this release's example apps and docs, passages that may speak to this request (search_corpus finds more; read(path, line) shows a file):\n${out}`;
}

// ---- read ----

const READ_MAX_LINES = 200;
const READ_MAX_CHARS = 10_000;

/** A file's lines from `line` (1-based), capped; says how to continue when there is more. */
export function readCorpus(corpus: Corpus, path: string, line = 1): string {
  const file = corpus.files.find((f) => f.path === path.trim().replace(/^\.?\//, ""));
  if (!file) {
    const near = corpus.files.filter((f) => f.path.includes(path.split("/").pop() ?? path)).map((f) => f.path);
    const list = (near.length ? near : corpus.files.map((f) => f.path)).slice(0, 40).join("\n");
    return `No file "${path}" in the corpus. ${near.length ? "Did you mean" : "The files are"}:\n${list}`;
  }
  const lines = file.text.split("\n");
  const from = Math.max(1, Math.floor(line) || 1);
  if (from > lines.length) return `${file.path} has ${lines.length} lines.`;
  let out = "";
  let last = from - 1;
  for (let i = from - 1; i < Math.min(lines.length, from - 1 + READ_MAX_LINES); i++) {
    const next = `${lines[i]}\n`;
    if (out.length + next.length > READ_MAX_CHARS && out) break;
    out += next;
    last = i + 1;
  }
  const more = last < lines.length ? `\n(lines ${from}-${last} of ${lines.length}; read("${file.path}", ${last + 1}) continues.)` : "";
  return `--- ${file.path}:${from}-${last}\n${out}${more}`;
}

/** Every example and personal app module: the files an `example` lookup may return. */
export function appFiles(corpus: Corpus): CorpusFile[] {
  return corpus.files.filter((f) => /\.app\.tsx?$/.test(f.path));
}

const EXAMPLE_CONTEXT = 40;

/**
 * An app in the corpus that uses a feature, around where it uses it. The smallest app that mentions
 * the feature wins — the shortest whole thing to copy the shape from. Undefined when none does.
 */
export function exampleFromCorpus(corpus: Corpus, feature: string): string | undefined {
  const needle = feature.trim();
  if (!needle) return undefined;
  const hit = appFiles(corpus)
    .filter((f) => f.text.includes(needle))
    .sort((a, b) => a.text.length - b.text.length)[0];
  if (!hit) return undefined;
  const lines = hit.text.split("\n");
  if (hit.text.length <= READ_MAX_CHARS) return `--- ${hit.path} (whole file)\n${hit.text}`;
  const at = lines.findIndex((l) => l.includes(needle));
  const from = Math.max(0, at - EXAMPLE_CONTEXT);
  const body = lines.slice(from, at + EXAMPLE_CONTEXT).join("\n");
  return `--- ${hit.path}:${from + 1}-${Math.min(lines.length, at + EXAMPLE_CONTEXT)} of ${lines.length} lines\n${body}\n(read("${hit.path}") for the whole app.)`;
}
