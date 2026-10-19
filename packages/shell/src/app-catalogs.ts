// An app's translations, read from its folder when it opens (docs/30): every `locales/<lang>.po`
// there, compiled for the runtime. They are files like any other the app has, so a package brings
// them (its `files/locales/`), a demo link carries them, and a person can fix a word in Files.

import type { Catalog } from "@potyro/i18n/app-catalogs";
import { fileSpace, type Store } from "@potyro/store";

/** The app's catalogs by language. One that cannot be read is left out, and says why in the console. */
export async function readCatalogs(store: Store): Promise<Record<string, Catalog>> {
  const space = fileSpace(store);
  const out: Record<string, Catalog> = {};
  let files;
  try {
    files = await space.list("locales");
  } catch {
    return out;
  }
  const po = files.filter((f) => f.path.endsWith(".po"));
  // Most apps carry none: the reader is fetched only for one that does.
  if (!po.length) return out;
  const { catalogLanguage, compileCatalog } = await import("@potyro/i18n/app-catalogs");
  for (const file of po) {
    const language = catalogLanguage(file.path);
    if (!language) continue;
    try {
      const blob = await space.read(file.path);
      if (blob) out[language] = compileCatalog(await blob.text());
    } catch (e) {
      // The app still opens, in its own language for this one: a broken file is not a broken app.
      console.warn(`[potyro] ${file.path} could not be read, so the app shows in its own language there:`, e);
    }
  }
  return out;
}
