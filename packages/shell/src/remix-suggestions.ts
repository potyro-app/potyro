// What a remix might change first (docs/24 §6): a few requests drawn from the app itself — its first
// kind of record, what that record already has, the pages it already shows — so the Studio's greeting
// on a remix offers things that make sense for THIS app, with no model call.
//
// Each is a request the person could have typed, in their language, sent as their own words. They
// quote the app's own word for its record ("Item") rather than agreeing with it: the shell cannot know
// that word's gender or plural (docs/21).
import { t } from "@lingui/core/macro";
import { pickLanguage, word, type AppDefinition, type Words } from "potyro";
import { languagePrefs } from "./locale.js";

/** At most this many: a greeting with a wall of chips is a menu, not a suggestion. */
export const MAX_SUGGESTIONS = 4;

type Shape = Pick<AppDefinition, "entities" | "pages"> & Partial<Pick<AppDefinition, "language" | "languages" | "theme">>;

/** The record kind the app is about: the one its first visible page shows, else its first. */
function mainEntity(def: Shape): string | undefined {
  for (const page of def.pages ?? []) {
    if ((page as { hidden?: boolean }).hidden) continue;
    const entity = (page.view as { entity?: string } | undefined)?.entity;
    if (entity && def.entities?.[entity]) return entity;
  }
  return Object.keys(def.entities ?? {})[0];
}

/** The requests to offer for this app, best first: up to three about its main record, and one about its look. */
export function remixSuggestions(def: Shape, languages: readonly string[] = languagePrefs()): string[] {
  const app = { language: def.language, languages: def.languages };
  const language = pickLanguage(languages, app);
  const say = (w: Words | undefined, fallback: string): string => (w == null ? fallback : word(w, language, app) || fallback);

  const key = mainEntity(def);
  const out: string[] = [];
  if (key) {
    const entity = def.entities[key]!;
    const label = say(entity.label, key);
    const types = new Set(Object.values(entity.fields ?? {}).map((f) => (f as { type?: string }).type));
    const views = new Set((def.pages ?? []).filter((p) => (p.view as { entity?: string } | undefined)?.entity === key).map((p) => (p.view as { type?: string }).type));
    if (!types.has("media")) out.push(t({ message: `Add a photo to each “${label}”`, comment: "A suggested change for a remix; label is the app's own word for its record" }));
    if (!types.has("datetime")) out.push(t({ message: `Add a date to each “${label}”`, comment: "A suggested change for a remix; label is the app's own word for its record" }));
    else if (!views.has("calendar")) out.push(t({ message: `Show “${label}” on a calendar`, comment: "A suggested change for a remix; label is the app's own word for its record" }));
    if (!types.has("richtext")) out.push(t({ message: `Add a note to each “${label}”`, comment: "A suggested change for a remix; label is the app's own word for its record" }));
    if (!types.has("member")) out.push(t({ message: `Let me say who each “${label}” is for`, comment: "A suggested change for a remix; label is the app's own word for its record" }));
  }
  // Always one about how it looks: every app has a look, and it is the first thing that makes a copy feel like yours.
  return [...out.slice(0, MAX_SUGGESTIONS - 1), t({ message: "Give it a different colour and icon", comment: "A suggested change for a remix" })];
}
