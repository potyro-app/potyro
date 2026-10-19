// "Translate into…" and "Update translations" (docs/30 §5): an app's catalog for one language,
// filled on the person's request, never on its own.
//
// The app's code is not touched: its words are read from its source and its own modules (`.src/` in
// its folder), the catalog `locales/<lang>.po` in the same folder is merged with them, and only what
// is new or changed goes to the model, through the same AI allowance as the Studio's voice (the free
// allowance first, then the person's own key). The catalog is written back as a file the app ships,
// so it travels with the app, and it can be read and fixed in Files.

import type { AiCap } from "@potyro/capabilities";
import { fileSpace, type Store } from "@potyro/store";

/** Where an app's catalog for `language` lives in its folder. */
export const catalogPath = (language: string): string => `locales/${language}.po`;

export const PO_MIME = "text/x-gettext-translation";

/**
 * Messages per call: the relay caps an answer at 4,000 tokens, and a message's translation with its
 * JSON key averages well under 40 of them.
 */
const RELAY_BATCH = 60;

/** The app's own modules' sources, as they sit in its folder: their words are the app's. */
async function ownModules(store: Store): Promise<string[]> {
  const space = fileSpace(store);
  const files = (await space.list(".src")).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f.path));
  const out: string[] = [];
  for (const f of files) {
    const blob = await space.read(f.path).catch(() => null);
    if (blob) out.push(await blob.text());
  }
  return out;
}

async function readCatalogText(store: Store, language: string): Promise<string | null> {
  const space = fileSpace(store);
  if (!(await space.find(catalogPath(language)))) return null;
  const blob = await space.read(catalogPath(language));
  return blob ? blob.text() : null;
}

export interface TranslateAppResult {
  /** Messages the model was asked for, and translated; those left show in the app's own language. */
  asked: number;
  translated: number;
  left: number;
}

/** Fill `language`'s catalog for the app whose source is `source` and whose folder is `store`. */
export async function translateApp(opts: { store: Store; source: string; language: string; ai: AiCap; signal?: AbortSignal }): Promise<TranslateAppResult> {
  const [{ translateCatalog, answerSchema }, modules, po] = await Promise.all([
    import("@potyro/generator/app-translate"),
    ownModules(opts.store),
    readCatalogText(opts.store, opts.language),
  ]);
  const out = await translateCatalog({
    source: opts.source,
    modules,
    language: opts.language,
    po,
    batch: RELAY_BATCH,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ask: async ({ system, user, keys }) => (await opts.ai.complete({ system, parts: [{ text: user }], json: answerSchema(keys), maxTokens: 4000 })).text,
  });
  await fileSpace(opts.store).write(catalogPath(opts.language), new Blob([out.po], { type: PO_MIME }), { mime: PO_MIME, origin: "shipped" });
  return { asked: out.asked, translated: out.translated, left: out.left.length };
}

/** How many of the app's words `language`'s catalog lacks, new or changed; 0 when there is no catalog. */
export async function translationGaps(store: Store, source: string, language: string): Promise<number> {
  const po = await readCatalogText(store, language).catch(() => null);
  if (po === null) return 0;
  const [{ catalogGaps }, modules] = await Promise.all([import("@potyro/generator/app-translate"), ownModules(store)]);
  return catalogGaps(source, modules, language, po);
}
