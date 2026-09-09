// Modify requests to measure a model on, each against a real example app.
//
// The generate harness answers "can this model write a Karta app?". This corpus answers the
// question that actually bit in use: "asked to CHANGE an app, does it edit it or replace it?" A
// fast model given a whole file and an instruction drifts from "edit this" to "write an app with
// this feature", and the person's entities and pages go with it. Until this existed that was an
// anecdote; the eval turns it into a rate per model.
//
// Every case scores two independent things. KEPT: the result still has every entity and page the
// app had (structural, exact, the thing that went wrong in practice). LANDED: the requested change
// is present, judged by a small structural predicate - a field exists, a page was added. LANDED is
// deliberately coarse; the point is to catch a model that keeps the app but ignores the request,
// not to grade the quality of the change. A case can keep and not land, land and not keep (the
// rewrite that happens to include the feature), or both.

/** The slice of a loaded definition the predicates look at. Structural, so the eval needs no
 *  schema import and a scripted backend can satisfy it in tests. */
export interface DefinitionShape {
  entities: Record<string, { fields?: Record<string, unknown> }>;
  pages: Array<{ id: string; view: { type: string } }>;
}

export interface ModifyCase {
  id: string;
  /** Which app the instruction is applied to: an example under examples/, or an eval fixture under
   *  packages/generator/fixtures/ - `city-guide` is a REAL model-generated app a person was using
   *  when a modify rewrote it, added verbatim. The curated examples never triggered a rewrite. */
  app: "recipes" | "plants" | "places" | "workout" | "city-guide";
  instruction: string;
  /** Did the requested change land? Structural and coarse on purpose - see the header. Absent for
   *  a keep-only case whose change is behaviour structure cannot see; such a case measures only
   *  whether the app survived, and is left out of the landed rate rather than counted as a pass. */
  landed?: (after: DefinitionShape, before: DefinitionShape) => boolean;
  /** What `landed` checks, in words, for the report. */
  expects: string;
}

const hasField = (entity: string, field: string) => (d: DefinitionShape): boolean =>
  Boolean(d.entities[entity]?.fields && field in (d.entities[entity]!.fields as Record<string, unknown>));

// Against the LOADED original, never a hardcoded count: the first draft said "plants had 4 pages"
// from a grep that counted a quick action's `id:` as a page. The app has 3, the model added one,
// and the case scored "did not land" for a change that landed. Structure that can be read must
// never be assumed.
const addedPage = (after: DefinitionShape, before: DefinitionShape): boolean => after.pages.length > before.pages.length;

const hasPageOfType = (type: string) => (d: DefinitionShape): boolean => d.pages.some((p) => p.view.type === type);

export const MODIFY_CASES: readonly ModifyCase[] = [
  // --- small, single-field additions: the easiest possible edit -------------------------------
  {
    id: "recipes-rating",
    app: "recipes",
    instruction: "Add a 5-star rating field to each recipe.",
    landed: hasField("recipe", "rating"),
    expects: "recipe has a `rating` field",
  },
  {
    id: "plants-room",
    app: "plants",
    instruction: "Add a field for which room of the house each plant lives in.",
    // `plant` has name/photo/wiki/needsDirectSun/active/lastWatered/wateringIntervalDays/seasonalCare -
    // nothing room-like. (A first draft asked for a watering interval, which the app already had, so
    // the predicate was true before any change. The runner now refuses such a case outright.)
    landed: (d) => Object.keys(d.entities.plant?.fields ?? {}).some((f) => /room|location|where/i.test(f)),
    expects: "plant gains a room-like field",
  },
  {
    id: "workout-session-notes",
    app: "workout",
    instruction: "Let me write a short free-text note on each session, like how I felt.",
    // `session` has day/date/durationSec/entries - no notes. (The draft asked for a duration, which
    // `durationSec` already is.)
    landed: (d) => Object.keys(d.entities.session?.fields ?? {}).some((f) => /note|comment|feel/i.test(f)),
    expects: "session gains a notes-like field",
  },
  {
    id: "places-website",
    app: "places",
    instruction: "Add a website link to each place.",
    // `place` has name/location/photo/notes/kind/vibes/visited/rating/openingHours - no URL. (The
    // draft asked for notes, which it already had.)
    landed: (d) => Object.keys(d.entities.place?.fields ?? {}).some((f) => /url|website|link|homepage/i.test(f)),
    expects: "place gains a URL-like field",
  },

  // --- adding a page: a bigger edit that still must leave the rest alone ----------------------
  {
    id: "recipes-favourites-page",
    app: "recipes",
    instruction: "Add a page that lists only the recipes I have marked as a favourite.",
    landed: addedPage,
    expects: "a page was added",
  },
  {
    id: "plants-today-page",
    app: "plants",
    instruction: "Add a page showing just the plants that need watering today.",
    landed: addedPage,
    expects: "a page was added",
  },
  {
    id: "workout-map-page",
    app: "workout",
    instruction: "Add a map page showing where each session happened.",
    landed: hasPageOfType("map"),
    expects: "a map page exists",
  },

  // --- the one that actually rewrote a person's app, verbatim -------------------------------
  {
    id: "places-pick-on-map",
    app: "places",
    instruction:
      "I want that when I am with the map open and click in New Place, it asks me to click a place in the map, and then the form to add details of the place will open with place coordinates from the place I clicked.",
    // Whether this LANDS is not something structure can say - it is behaviour inside the map view,
    // so there is deliberately no predicate and the case is left out of the landed rate. It earns
    // its place by measuring the thing that actually happened: the whole app being replaced. A model
    // that keeps the app and reports NOT-IN-APP is a fine outcome here.
    expects: "keep-only: behaviour inside the map view is not structurally checkable",
  },

  // --- a change whose natural over-reach is to rewrite everything ----------------------------
  {
    id: "recipes-rename-entity-field",
    app: "recipes",
    instruction: "Rename the recipe's `servings` field to `portions` everywhere it is used.",
    // A rename touches the entity AND every page that displays the field - the edit most likely to
    // tempt a model into regenerating the whole file. (The draft renamed `title`, which the app
    // never had; it was `name` all along.)
    landed: (d) => hasField("recipe", "portions")(d) && !hasField("recipe", "servings")(d),
    expects: "recipe has `portions` and no longer `servings`",
  },
  {
    id: "workout-two-things",
    app: "workout",
    instruction: "Add a notes field to exercises, and a page listing exercises I have not done in the last 30 days.",
    landed: (d, o) => Object.keys(d.entities.exercise?.fields ?? {}).some((f) => /note/i.test(f)) && addedPage(d, o),
    expects: "exercise gains a notes-like field AND a page was added",
  },

  // --- the real app that was rewritten, with the real request --------------------------------
  {
    id: "city-guide-pick-on-map",
    app: "city-guide",
    instruction:
      "I want that when I am with the map open and click in New Place, it asks me to click a place in the map, and then the form to add details of the place will open with place coordinates from the place I clicked.",
    // Keep-only for the same reason as places-pick-on-map. This is the exact app and exact words
    // that came back as a different app; on the curated examples the same request never did.
    expects: "keep-only: the request that rewrote this app in use",
  },
  {
    id: "city-guide-opening-hours",
    app: "city-guide",
    instruction: "Add opening hours to each place, as free text.",
    landed: (d) => Object.keys(d.entities.place?.fields ?? {}).some((f) => /hour|open/i.test(f)),
    expects: "place gains an opening-hours-like field",
  },
];
