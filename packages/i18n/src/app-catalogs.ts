// An app's own translations (docs/30): `locales/<lang>.po` beside the app, the source text as the
// msgid, gettext style. These are the APP's words; Potyro's own are the Lingui catalogs in
// `locales/` of this package, compiled at build time. An app's catalogs change at run time (a person
// edits one in Files, a package brings them), so they are read here, in the browser.
//
// A catalog compiles to `{ msgid → msgstr }`, the map `potyro`'s `lookup()` reads; a `msgctxt` is
// `context\u0004msgid`, as gettext writes it.

import PO from "pofile";

/** One language's translations: source text → translated text. */
export type Catalog = Readonly<Record<string, string>>;

/** One message of a catalog, as a translator sees it. */
export interface CatalogEntry {
  id: string;
  context?: string;
  /** The translation; empty when there is none yet. */
  text: string;
  /** Translated for an earlier source text: shown in the source language until it is checked. */
  fuzzy: boolean;
  /** No longer in the app; kept so a word that comes back finds its translation. */
  obsolete: boolean;
  /** Where the app uses it ("pages.today.title", "ctx.t"), for the translator. */
  references: string[];
  /** A note for the translator (the slot, the code around a `ctx.t`). */
  notes: string[];
}

export const CONTEXT_SEPARATOR = "\u0004";

/** The language a catalog's path names: `locales/pt-BR.po` → `pt-BR`. Null for anything else. */
export function catalogLanguage(path: string): string | null {
  const m = /^locales\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.po$/.exec(path);
  return m ? m[1]! : null;
}

/** A `.po` file's messages. Throws a readable error for a file that is not one. */
export function readPo(text: string): { language?: string; entries: CatalogEntry[] } {
  let po: PO;
  try {
    po = PO.parse(text);
  } catch (e) {
    throw new Error(`not a translations file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const entries = po.items
    .filter((item) => item.msgid !== "")
    .map((item) => ({
      id: item.msgid,
      ...(item.msgctxt ? { context: item.msgctxt } : {}),
      text: item.msgstr[0] ?? "",
      fuzzy: Boolean(item.flags.fuzzy),
      obsolete: Boolean(item.obsolete),
      references: [...item.references],
      notes: [...item.extractedComments],
    }));
  return { ...(po.headers.Language ? { language: po.headers.Language } : {}), entries };
}

/**
 * What the runtime reads: every translated message, keyed as `lookup()` expects. A fuzzy, obsolete or
 * empty one is left out, so it shows in the app's own language.
 */
export function compileCatalog(text: string): Catalog {
  const out: Record<string, string> = {};
  for (const e of readPo(text).entries) {
    if (e.fuzzy || e.obsolete || !e.text) continue;
    out[e.context ? `${e.context}${CONTEXT_SEPARATOR}${e.id}` : e.id] = e.text;
  }
  return out;
}

/** A `.po` file with these messages, in the order given. */
export function writePo(language: string, entries: readonly CatalogEntry[]): string {
  const po = new PO();
  po.headers = { Language: language, "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "8bit", "MIME-Version": "1.0" } as PO["headers"];
  for (const e of entries) {
    const item = new PO.Item();
    item.msgid = e.id;
    if (e.context) item.msgctxt = e.context;
    item.msgstr = [e.text];
    item.references = [...e.references];
    item.extractedComments = [...e.notes];
    if (e.fuzzy) item.flags = { fuzzy: true };
    item.obsolete = e.obsolete;
    po.items.push(item);
  }
  return po.toString() + "\n";
}
