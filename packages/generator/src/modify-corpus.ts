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
  pages: Array<{ id: string; view: { type: string; sort?: unknown; filters?: unknown[]; camera?: unknown } }>;
  scope?: { entity: string };
  reminders?: unknown[];
}

export interface ModifyCase {
  id: string;
  /** Which app the instruction is applied to: an example under examples/, or an eval fixture under
   *  packages/generator/fixtures/ - `city-guide` is a REAL model-generated app a person was using
   *  when a modify rewrote it, added verbatim; `trip-planner` is the real app whose modify request
   *  was refused whole and opened #130–#135. The curated examples never triggered a rewrite. */
  app: "recipes" | "plants" | "places" | "workout" | "city-guide" | "trip-planner";
  instruction: string;
  /** Did the requested change land? Structural and coarse on purpose - see the header. Absent for
   *  a keep-only case whose change is behaviour structure cannot see; such a case measures only
   *  whether the app survived, and is left out of the landed rate rather than counted as a pass. */
  landed?: (after: DefinitionShape, before: DefinitionShape) => boolean;
  /** What `landed` checks, in words, for the report. */
  expects: string;
  /**
   * The parts of the request that CANNOT be done on this host, as patterns (case-insensitive
   * regex sources) each of which must be named in the reply's `Not done:` lines (#135). A case with
   * this set is partially feasible: `landed` checks the doable part, and a refusal of the whole
   * request scores `refusedWhenFeasible` — the failure the ladder (#132) exists to end. A case
   * with `landed` and no `notDone` is fully feasible, and refusing it scores the same way.
   */
  notDone?: string[];
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

  // --- feasibility (#135): multi-part requests, some with a part the host cannot do -------------
  // The failure these measure is a refusal of the WHOLE request because one part of it cannot be
  // done. A model that does the doable part and names the rest under `Not done:` scores; one that
  // refuses scores `refusedWhenFeasible`, whatever its reason. The first is the request that opened
  // the track, verbatim, and is now fully feasible (ctx.scope, #134): refusing it is the control.
  {
    id: "trip-scope",
    app: "trip-planner",
    instruction:
      "when I open the map I need to create or select a trip. when a trip is selected the map opens automatically in the trip city and all lists show elements for the trip. we need to have a way to see that I am currently in the trip X.",
    landed: (d) => d.scope?.entity === "trip" && d.pages.some((p) => p.view.type === "map" && typeof p.view.camera === "function"),
    expects: "declares scope over trip and the map's camera is a function of ctx",
  },
  {
    id: "recipes-chart",
    app: "recipes",
    instruction: "Show me a chart of how many recipes I cooked each month.",
    // The doable part: a derived table per month (an aggregate view). The chart itself is #109.
    landed: (d, before) => d.pages.length > before.pages.length && d.pages.some((p) => p.view.type === "aggregate" || p.view.type === "custom"),
    expects: "a new page folds cookings per month (aggregate, or a custom view)",
    notDone: ["chart|graph"],
  },
  {
    id: "workout-photo-crop",
    app: "workout",
    instruction: "Let me attach a photo to each session and crop it before saving.",
    landed: (d) => Object.values(d.entities.session?.fields ?? {}).some((f) => (f as { type?: string }).type === "media"),
    expects: "session gains a media field",
    notDone: ["crop"],
  },
  {
    id: "places-visit-sms",
    app: "places",
    instruction: "Let me plan a date to visit a place, remind me the day before, and text my partner the address.",
    landed: (d, before) =>
      Object.values(d.entities.place?.fields ?? {}).some((f) => (f as { type?: string }).type === "datetime") &&
      (d.reminders?.length ?? 0) > (before.reminders?.length ?? 0),
    expects: "place gains a datetime field and a reminder is declared",
    notDone: ["text|sms|message"],
  },
  {
    id: "places-distance-sort",
    app: "places",
    instruction: "Sort the list of all places by distance from me.",
    // Fully feasible (a geo chip + a sort reading ctx.params): a control that must not be refused.
    landed: (d, before) => {
      const list = (s: DefinitionShape) => s.pages.find((p) => p.id === "all")?.view;
      const a = list(d);
      const b = list(before);
      return Boolean(a) && (String(a!.sort) !== String(b?.sort) || (a!.filters?.length ?? 0) > (b?.filters?.length ?? 0));
    },
    expects: "the All places list changes its sort or gains a chip",
  },
];
