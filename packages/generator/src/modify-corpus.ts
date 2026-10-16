// Modify requests to measure a model on, each against a real example app.
//
// The generate harness answers "can this model write a Potyro app?". This corpus answers the
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

import type { ConversationEntry } from "./agent/conversation.js";

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
  /**
   * A case class the loop's next changes are measured on (docs/19 F9); absent for the original 17.
   *   `conversation`  the request depends on what was said about EARLIER versions (`earlier`, #279)
   *   `platform`      the heart of the request is something Potyro itself lacks (#263): the right
   *                   answer does the doable part and names the rest
   *   `wrong-gate`    the app's own check refuses every candidate for a reason outside the change,
   *                   as #276's did (`gateRefuses`): it measures what the loop does at a dead end
   */
  class?: "conversation" | "platform" | "wrong-gate";
  /**
   * What the person and the Studio said about EARLIER versions of the app, oldest first, as the
   * Studio's conversation keeps it (`studio-chat`): an `ask` is the person, the rest the Studio. The
   * loop gets it as a recap and through `read_conversation` (#279); `--conversation none` measures
   * what is lost without it. Every change in it was undone or never made, so the app as it is in
   * examples/ is still the app the conversation ends on.
   */
  earlier?: ConversationEntry[];
  /** Words from the earlier message the case turns on: how far back it is decides which recap sizes can see it. */
  decidedBy?: string;
  /** The error the app's check throws for every candidate, the original included (`wrong-gate`, loop mode only). */
  gateRefuses?: string;
}

const hasField = (entity: string, field: string) => (d: DefinitionShape): boolean =>
  Boolean(d.entities[entity]?.fields && field in (d.entities[entity]!.fields as Record<string, unknown>));

// Against the LOADED original, never a hardcoded count: the first draft said "plants had 4 pages"
// from a grep that counted a quick action's `id:` as a page. The app has 3, the model added one,
// and the case scored "did not land" for a change that landed. Structure that can be read must
// never be assumed.
const addedPage = (after: DefinitionShape, before: DefinitionShape): boolean => after.pages.length > before.pages.length;

type FieldShape = { type?: string; max?: unknown; options?: unknown };
const fieldsOf = (d: DefinitionShape, entity: string): Array<[string, FieldShape]> => Object.entries(d.entities[entity]?.fields ?? {}) as Array<[string, FieldShape]>;

/** The entity gained a field whose name matches `name` (and, when given, whose type is `type`). */
const gainedField = (entity: string, name: RegExp, type?: string) => (d: DefinitionShape, before: DefinitionShape): boolean =>
  fieldsOf(d, entity).some(([k, f]) => name.test(k) && !(k in (before.entities[entity]?.fields ?? {})) && (!type || f.type === type));

const filtersOn = (d: DefinitionShape, page: string): number => d.pages.find((p) => p.id === page)?.view.filters?.length ?? 0;

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

  // --- docs/19 F9: the classes the loop's next changes are measured on --------------------------
  // conversation (#279): each depends on something said about an EARLIER version — a change the
  // person turned down, an answer they gave, a feature they had removed. Without it, a model does
  // the reasonable thing and gets it wrong.
  {
    id: "plants-no-more-pages",
    app: "plants",
    class: "conversation",
    earlier: [
      { kind: "ask", text: "Add a page with the plants that need direct sun." },
      { kind: "version", text: "Done: a new page, Sunny plants, lists the plants that need direct sun." },
      { kind: "ask", text: "No, I don't want more pages, the menu is long enough already. Undo that. Put things like that on the Plants list as a filter instead." },
      { kind: "version", text: "Undone: the Sunny plants page is gone and the app is as it was." },
    ],
    decidedBy: "I don't want more pages",
    instruction: "Let me see only the plants that need direct sun.",
    landed: (d, before) => d.pages.length === before.pages.length && filtersOn(d, "list") > filtersOn(before, "list"),
    expects: "no page added, and the Plants list gains a filter",
  },
  {
    id: "workout-rating-out-of-10",
    app: "workout",
    class: "conversation",
    earlier: [
      { kind: "ask", text: "Add a rating to each session." },
      { kind: "question", text: "Should the rating be stars out of 5, or a score out of 10?" },
      { kind: "ask", text: "Out of 10, I score everything out of 10. Actually leave it for now, I'll ask again later." },
      { kind: "answer", text: "Okay, I didn't change anything." },
    ],
    decidedBy: "Out of 10",
    instruction: "Ok, now add the rating to each session.",
    landed: (d) => fieldsOf(d, "session").some(([k, f]) => /rat|score/i.test(k) && f.type === "number" && f.max === 10),
    expects: "session gains a number rating with max 10",
  },
  {
    id: "recipes-put-spice-back",
    app: "recipes",
    class: "conversation",
    earlier: [
      { kind: "ask", text: "Add how spicy each recipe is: mild, medium or hot, in colours." },
      { kind: "version", text: "Done: recipes have a Spiciness choice (mild, medium, hot), shown as a coloured badge." },
      { kind: "ask", text: "Take the spiciness away again, I don't use it." },
      { kind: "version", text: "Done: the Spiciness choice is gone." },
    ],
    decidedBy: "mild, medium or hot",
    instruction: "I changed my mind, put the spiciness thing back like it was.",
    landed: (d) =>
      fieldsOf(d, "recipe").some(
        ([, f]) => f.type === "enum" && Array.isArray(f.options) && ["mild", "medium", "hot"].every((o) => (f.options as unknown[]).some((x) => String(x).toLowerCase() === o)),
      ),
    expects: "recipe gains an enum with mild, medium and hot",
  },

  // Further back (#279): what decides these was said five or seven requests ago, with requests in
  // between that changed nothing that lasted — refused, answered, or undone. They are what tells a
  // short recap from a long one, and a recap from the tool that pages older requests.
  {
    id: "plants-water-in-ml",
    app: "plants",
    class: "conversation",
    earlier: [
      { kind: "ask", text: "How much water do my plants get? I always measure it in millilitres, never cups or litres." },
      { kind: "answer", text: "Your app doesn't keep how much water a plant gets yet, so I didn't change anything. Tell me when you want it added." },
      { kind: "ask", text: "Text my sister when a plant needs water." },
      { kind: "refusal", text: "I didn't change the app: this isn't something it can change. Potyro apps can't send text messages." },
      { kind: "ask", text: "Make the whole app pink." },
      { kind: "version", text: "Done: the app's colour is pink." },
      { kind: "event", text: "went back to version 3" },
      { kind: "ask", text: "Can it tell me which plants are poisonous to cats?" },
      { kind: "question", text: "Should I add a yes/no “poisonous to cats” to each plant, or a note you write yourself?" },
      { kind: "ask", text: "Never mind, I'll look it up myself." },
      { kind: "answer", text: "Okay, I didn't change anything." },
    ],
    decidedBy: "millilitres",
    instruction: "Ok, now let me write down how much water each plant gets.",
    landed: (d, before) =>
      fieldsOf(d, "plant").some(
        ([k, f]) =>
          !(k in (before.entities.plant?.fields ?? {})) &&
          f.type === "number" &&
          /\bml\b|millilit/i.test(`${k} ${String((f as { unit?: unknown }).unit ?? "")} ${String((f as { label?: unknown }).label ?? "")}`),
      ),
    expects: "plant gains a number field in millilitres (its unit, label or name says ml)",
  },
  {
    id: "places-visited-starts-off",
    app: "places",
    class: "conversation",
    earlier: [
      { kind: "ask", text: "Places I add should start as not visited — I add places I want to go to, not places I've been." },
      { kind: "question", text: "Should visited places also move off the main list, onto a page of their own?" },
      { kind: "ask", text: "No, keep them all in one list. And don't do anything yet, I'm showing the app to a friend." },
      { kind: "answer", text: "Okay, I didn't change anything." },
      { kind: "ask", text: "Show the places on a satellite map." },
      { kind: "refusal", text: "I didn't change the app: this isn't something it can change. The map's look is Potyro's, not the app's." },
      { kind: "ask", text: "Add a page with only the bars." },
      { kind: "version", text: "Done: a new page, Bars, lists the bars." },
      { kind: "event", text: "went back to version 4" },
      { kind: "ask", text: "Can it book a table for me?" },
      { kind: "refusal", text: "I didn't change the app: this isn't something it can change. Potyro apps can't make bookings." },
      { kind: "ask", text: "What are vibes for?" },
      { kind: "answer", text: "Vibes are your own tags for a place — cheap, quiet, dog-friendly — and the list can filter by them." },
      { kind: "ask", text: "Make the rating out of 10." },
      { kind: "question", text: "Should the ratings you already gave be doubled, so a 4 becomes an 8?" },
      { kind: "ask", text: "Hmm, then leave it out of 5." },
      { kind: "answer", text: "Okay, I didn't change anything." },
    ],
    decidedBy: "start as not visited",
    instruction: "Ok, now do that thing with visited that I asked for.",
    // Places 2.0 keeps a status (want to go / been / favourite) where it had a visited switch: "not
    // visited" is "want to go".
    landed: (d, before) =>
      d.pages.length === before.pages.length && (d.entities.place?.fields?.status as { default?: unknown } | undefined)?.default === "want to go",
    expects: "a new place starts as want to go (not visited), and no page is added",
  },

  // platform (#263): what the person mostly wants needs a device feature Potyro does not offer (no
  // barcode reader, no Bluetooth). The right answer keeps what the app can do and says plainly what
  // Potyro itself would need — never a refusal of the whole request.
  {
    id: "plants-scan-barcode",
    app: "plants",
    class: "platform",
    instruction: "When I buy a new plant, let me scan the barcode on its pot to fill in its name, and keep the barcode number with the plant.",
    landed: gainedField("plant", /barcode|code|ean|upc|sku/i),
    expects: "plant gains a barcode-like field",
    notDone: ["scan|barcode|camera"],
  },
  {
    id: "workout-heart-rate-strap",
    app: "workout",
    class: "platform",
    instruction: "Connect to my Bluetooth heart rate strap during a session and save my average heart rate with the session.",
    landed: gainedField("session", /heart|hr|bpm|pulse/i, "number"),
    expects: "session gains a heart-rate number field",
    notDone: ["bluetooth|strap|connect|sensor"],
  },

  // wrong-gate (#276): the right change, and a check that refuses it whatever the model sends,
  // because the error comes from outside the change. Nothing can land; what is measured is how the
  // loop ends (repeat, ask, explain) and what the dead end cost.
  {
    id: "places-phone-wrong-gate",
    app: "places",
    class: "wrong-gate",
    instruction: "Add a phone number to each place so I can call to book a table.",
    landed: gainedField("place", /phone|tel/i),
    expects: "place gains a phone-like field (the gate refuses it anyway)",
    gateRefuses: "maplibre-gl 4.7.1 needs a full web page to work",
  },
];
