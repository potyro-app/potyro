// The request's words in the corpus's terms, whatever language the request is in (#306 follow-up).
//
// Priming (corpus.ts) matches a request's words against the corpus. The corpus's code, keys and docs
// are English, so a Polish or Portuguese request used to match only by accident. No hand-written
// dictionary: app sources already pair words across languages, and the pairs are mined from them —
//   - a translation map, `{ en: "Rating", pl: "Ocena", "pt-BR": "Avaliação" }`, pairs each
//     language's words with the English ones;
//   - a key and its label, `rating: { type: "number", label: "Ocena" }`, pairs the label's words with
//     the key's (keys and ids are English by the product's own rule), so even an app written in one
//     language that is not English teaches its words.
// The corpus (every example carries six languages) and the app being edited are both mined, so the
// lexicon grows with every language an app carries, and is only as strong as they are: a word no app
// has said in two languages stays as it is, and is still matched literally.
//
// Pure and deterministic: no model, no network, the same answer every time.

/** Words, in any script: letters and digits of every language, lower-cased. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
}

/** `caloriesPerServing` → `calories per serving`; `opening_hours` → `opening hours`. */
export const splitKey = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");

/** One of Potyro's own messages in a language, beside its English: `["pl", "Mapa", "Map"]`. */
export type WordPair = readonly [language: string, text: string, english: string];

/** A pairing the sources make: these words (any language) mean those English words. */
interface Pair {
  words: string[];
  english: string[];
}

const STRING = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const LANG_KEY = String.raw`(?:"([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?)"|([a-z]{2,3}))`;
/** One `{ en: "…", pl: "…", … }` map, on one line or several. */
const MAP = new RegExp(String.raw`\{\s*(?:${LANG_KEY}\s*:\s*${STRING}\s*,?\s*)+\}`, "g");
const MAP_ENTRY = new RegExp(String.raw`${LANG_KEY}\s*:\s*${STRING}`, "g");
/** The same entry, only as a whole key: `pl: "…"`, never the end of `sampl: "…"`. */
const VIEW_ENTRY = new RegExp(String.raw`(?<![\w$-])${LANG_KEY}\s*:\s*${STRING}`, "g");
/** `key: { … label: "…"` or `key: { … label: { … } }`, the label before any nested object. */
const KEYED_LABEL = new RegExp(String.raw`\b([A-Za-z_$][\w$]*)\s*:\s*\{[^{}]*?\blabel\s*:\s*(?:${STRING}|(\{[^{}]*\}))`, "g");

function mapEntries(map: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of map.matchAll(MAP_ENTRY)) out[m[1] ?? m[2]!] = m[3]!;
  return out;
}

/** Every pairing one source makes. */
export function pairsIn(source: string): Pair[] {
  const pairs: Pair[] = [];
  for (const m of source.matchAll(MAP)) {
    const entries = mapEntries(m[0]);
    const en = entries.en;
    if (en === undefined) continue;
    const english = wordsOf(en);
    if (!english.length) continue;
    for (const [lang, text] of Object.entries(entries)) if (lang !== "en") pairs.push({ words: wordsOf(text), english });
  }
  for (const m of source.matchAll(KEYED_LABEL)) {
    const english = wordsOf(splitKey(m[1]!));
    const label = m[2] !== undefined ? [m[2]] : Object.values(mapEntries(m[3] ?? ""));
    for (const text of label) pairs.push({ words: wordsOf(text), english });
  }
  return pairs.filter((p) => p.words.length > 0 && p.words.length <= 8 && p.english.length <= 8);
}

/** A language other than English that this many of the sources' maps carry beside `en`: a language,
 *  not a key that happens to be two letters. */
const MIN_MAPS = 2;

/** The languages, other than English, the sources' translation maps carry beside `en`. */
export function translationLanguages(sources: readonly string[]): Set<string> {
  const maps = new Map<string, number>();
  for (const source of sources) {
    for (const m of source.matchAll(MAP)) {
      const langs = Object.keys(mapEntries(m[0]));
      if (!langs.includes("en")) continue;
      for (const lang of langs) if (lang !== "en") maps.set(lang, (maps.get(lang) ?? 0) + 1);
    }
  }
  return new Set([...maps].filter(([, n]) => n >= MIN_MAPS).map(([lang]) => lang));
}

/**
 * A text as it reads in English: every `pl: "…"`, `"pt-BR": "…"` entry of a translation map taken
 * out, `en: "…"` kept. A map's other entries say what its `en` says, and a request in another
 * language reaches that through its English words (englishFor); left in, a table of an app's words in
 * six languages would match every request in any of them, by the request's own words, and outrank
 * the passages that do what it asks.
 */
export function englishView(text: string, languages: ReadonlySet<string>): string {
  if (!languages.size) return text;
  return text.replace(VIEW_ENTRY, (entry, quoted: string | undefined, bare: string | undefined) => (languages.has(quoted ?? bare!) ? "" : entry));
}

/** How often each word, and each word with each English word, is paired. */
export interface Lexicon {
  count: Map<string, number>;
  /** Every word on the English side of a pairing: a request word among these is matched as it is. */
  englishCount: Map<string, number>;
  together: Map<string, Map<string, number>>;
  /** The same, counting only short pairings (a label of a word or two): those say what a word means. */
  strong: Map<string, Map<string, number>>;
  /** How often each word is in a short pairing. */
  strongCount: Map<string, number>;
}

const SHORT = 2;

export function buildLexicon(sources: readonly string[], words: readonly WordPair[] = []): Lexicon {
  const lex: Lexicon = { count: new Map(), englishCount: new Map(), together: new Map(), strong: new Map(), strongCount: new Map() };
  for (const source of sources) addPairs(lex, pairsIn(source));
  addPairs(lex, words.map(([, text, english]) => ({ words: wordsOf(text), english: wordsOf(english) })).filter((p) => p.words.length && p.english.length));
  return lex;
}

function bump(table: Map<string, Map<string, number>>, w: string, es: ReadonlySet<string>): void {
  let row = table.get(w);
  if (!row) table.set(w, (row = new Map()));
  for (const e of es) row.set(e, (row.get(e) ?? 0) + 1);
}

function addPairs(lex: Lexicon, pairs: readonly Pair[]): void {
  for (const { words, english } of pairs) {
    const ws = new Set(words);
    const es = new Set(english);
    for (const e of es) lex.englishCount.set(e, (lex.englishCount.get(e) ?? 0) + 1);
    const short = ws.size <= SHORT && es.size <= SHORT;
    for (const w of ws) {
      lex.count.set(w, (lex.count.get(w) ?? 0) + 1);
      bump(lex.together, w, es);
      if (!short) continue;
      bump(lex.strong, w, es);
      lex.strongCount.set(w, (lex.strongCount.get(w) ?? 0) + 1);
    }
  }
}

/** The lexicon with one more source's pairings, the corpus's own left untouched. */
export function withSource(base: Lexicon, source: string): Lexicon {
  const pairs = pairsIn(source);
  if (!pairs.length) return base;
  const lex: Lexicon = { count: new Map(base.count), englishCount: new Map(base.englishCount), together: new Map(base.together), strong: new Map(base.strong), strongCount: new Map(base.strongCount) };
  // Copy only the rows this source touches, before adding to them.
  for (const { words } of pairs) {
    for (const w of words) {
      if (base.together.has(w)) lex.together.set(w, new Map(base.together.get(w)));
      if (base.strong.has(w)) lex.strong.set(w, new Map(base.strong.get(w)));
    }
  }
  addPairs(lex, pairs);
  return lex;
}

const MIN_STEM = 4;
/** Letters an inflection may change at the end of the longer form: "przepis" / "przepisów". */
const MAX_TAIL = 2;
/**
 * Whether one word reads as a form of the other: they differ only in their last letters — at most
 * two after the letters they share ("przepisu" / "przepisów" / "przepis"), three when they share at
 * least five ("przepisami" / "przepis") — and they share at least four, or three in two words of four
 * ("mapa" / "mapę"). Measured on the longer word too: "przy" shares "prz" with "przepisu", and is no
 * form of it. Shorter words only as themselves.
 */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  let shared = 0;
  while (shared < Math.min(a.length, b.length) && a[shared] === b[shared]) shared++;
  const tail = longer - shared;
  if (tail <= MAX_TAIL) return shared >= MIN_STEM || (shared === MIN_STEM - 1 && longer === MIN_STEM);
  return tail === MAX_TAIL + 1 && shared >= MIN_STEM + 1;
}

/**
 * The English words a word was paired with, each with its own forms ("page" and "pages", "place" and
 * "places") counted as one: a word paired half the time with "page" and half with "pages" means
 * "page". The form paired most stands for the rest, the shorter on a tie, so a passage that says
 * "pages" still has "page" in it.
 */
function englishForms(together: ReadonlyMap<string, number>, strong: ReadonlyMap<string, number>): Array<{ members: string[]; both: number; strongly: number }> {
  const byUse = [...together].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1));
  const groups: Array<{ members: string[]; both: number; strongly: number }> = [];
  for (const [e, both] of byUse) {
    const group = groups.find((g) => sameStem(g.members[0]!, e));
    if (group) {
      group.members.push(e);
      group.both += both;
      group.strongly += strong.get(e) ?? 0;
    } else groups.push({ members: [e], both, strongly: strong.get(e) ?? 0 });
  }
  return groups;
}

/** A word's labels say what it means when they are at least this share of its pairings; under it the
 *  word is a common one ("się", "que") that an odd label happens to hold, and is read by them all. */
const LABEL_SHARE = 0.25;
/** Below this share of a word's pairings, an English word is not what it means. */
const MIN_SHARE = 0.5;
/** English words a lookup may give for one word: a label of two words gives both. */
const MAX_PER_WORD = 2;

/**
 * The English words `word` stands for, best first: over every form of it the sources paired
 * ("przepisu" is "przepis", "przepisy"), the English words beside it in at least half its pairings —
 * "Przepis" beside "Recipe" — and in a short pairing at least once or in two pairings of any length,
 * so one long phrase cannot pair every word in it with every other. The more specific English word
 * wins a tie. Empty when no source paired it.
 */
export function englishFor(lex: Lexicon, word: string): string[] {
  // An English word (a key's, or a map's `en`) is no form of the word, however alike: "receipt" is not "receita".
  const forms = [...lex.together.keys()].filter((w) => w === word || (sameStem(w, word) && !lex.englishCount.has(w)));
  const together = new Map<string, number>();
  const strong = new Map<string, number>();
  let n = 0;
  let nShort = 0;
  for (const form of forms) {
    n += lex.count.get(form)!;
    nShort += lex.strongCount.get(form) ?? 0;
    for (const [e, k] of lex.together.get(form)!) together.set(e, (together.get(e) ?? 0) + k);
    for (const [e, k] of lex.strong.get(form) ?? []) strong.set(e, (strong.get(e) ?? 0) + k);
  }
  const picked: Array<{ e: string; share: number; spread: number }> = [];
  for (const { members, both, strongly } of englishForms(together, strong)) {
    if (members.some((e) => forms.includes(e))) continue; // the same word on both sides: English or a cognate, matched as it is
    // A word some label pairs is read by its labels; the sentences it is in only when none does.
    const share = nShort && nShort >= LABEL_SHARE * n ? strongly / nShort : both / n;
    if (share < MIN_SHARE || (!strongly && both < 2)) continue;
    const e = members[0]!;
    picked.push({ e, share, spread: lex.englishCount.get(e)! });
  }
  return picked
    .sort((a, b) => b.share - a.share || a.spread - b.spread)
    .slice(0, MAX_PER_WORD)
    .map((p) => p.e);
}
