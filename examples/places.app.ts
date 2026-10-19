// places.app.ts
// Your map of places: the ones you love, the ones you have been to and the ones friends told you
// about, in lists you can share ("Date night", "Sunday"). Save a spot where you stand, log a visit —
// what you ordered, who you were with — and rank it against the places of its own kind ("better or
// worse than Ramen Kaido?"), never a café against a bar. Your visits become a timeline to look back on.
//
// Made for "where shall we go?": the map opens with the places in view as cards along the bottom —
// photo, open or closed, what to order — and All places is every one by kind, with Near me.
//
// Stresses: geo field + map view with a strip of cards, an optional app-wide scope (the list you are
// looking at), JS filters for "open now" and "within 2 km", an interactive ranking that asks questions through
// `ctx.ui.sheet`, actions with input (a visit), a migration (visited → status) — arbitrary logic, no DSL.
//
// Written in English; its translations are catalogs, examples/files/places/locales/<lang>.po (docs/30),
// every language but English a model's draft (#297). A function sees an enum's stored value, never its
// label, so the places that put a category or a status into words say it through `kindName` /
// `statusName`, beside the fields' own `labels`.
import { defineApp, type Ctx, type MigrationStep, type Resolved } from "potyro";

type HourRow = { day: string; from: string; to: string };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};
const isOpenNow = (hours: HourRow[], at: Date) => {
  const day = DAYS[at.getDay()];
  const mins = at.getHours() * 60 + at.getMinutes();
  return hours.some((r) => r.day === day && hm(r.from) <= mins && mins <= hm(r.to));
};
const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const KINDS = ["restaurant", "bar", "cafe", "pizza", "bakery", "museum", "park", "viewpoint", "shop", "stay", "other"];
const KIND_GLYPH: Record<string, string> = { restaurant: "🍽️", bar: "🍸", cafe: "☕", pizza: "🍕", bakery: "🥐", museum: "🖼️", park: "🌳", viewpoint: "👀", shop: "🛍️", stay: "🏨", other: "📍" };
const KIND_COLOR: Record<string, string> = { restaurant: "#C0574D", bar: "#8E5BB5", cafe: "#A0703C", pizza: "#D9822B", bakery: "#E4A93C", museum: "#5B6EE1", park: "#3C9A5F", viewpoint: "#2E9AA6", shop: "#D45D8F", stay: "#5FB0E4", other: "#7A8794" };

/** A category in the person's language: the same words as `kind`'s labels below. */
const kindName = (kind: unknown, ctx: Ctx): string => {
  switch (kind) {
    case "restaurant":
      return ctx.t("restaurant");
    case "bar":
      return ctx.t("bar");
    case "cafe":
      return ctx.t("cafe");
    case "pizza":
      return ctx.t("pizza");
    case "bakery":
      return ctx.t("bakery");
    case "museum":
      return ctx.t("museum");
    case "park":
      return ctx.t("park");
    case "viewpoint":
      return ctx.t("viewpoint");
    case "shop":
      return ctx.t("shop");
    case "stay":
      return ctx.t("place to stay");
    case "other":
      return ctx.t("other");
    default:
      return ctx.t("unknown");
  }
};

/** The plural, for "#2 of your cafés". */
const kindPlural = (kind: unknown, ctx: Ctx): string => {
  switch (kind) {
    case "restaurant":
      return ctx.t("restaurants");
    case "bar":
      return ctx.t("bars");
    case "cafe":
      return ctx.t("cafés");
    case "pizza":
      return ctx.t("pizzerias");
    case "bakery":
      return ctx.t("bakeries");
    case "park":
      return ctx.t("parks");
    default:
      return ctx.t("places like it");
  }
};

/** A status in words: the same as `status`'s labels. */
const statusName = (s: unknown, ctx: Ctx): string => {
  if (s === "favourite") return ctx.t("favourite");
  if (s === "been") return ctx.t("been");
  return ctx.t("want to go");
};

const visited = (p: Resolved): boolean => p.status === "been" || p.status === "favourite";

/** The line under a place's name: its kind, and whether it is open — or that nobody knows. */
function placeLine(p: Resolved, ctx: Ctx): string {
  const hours = (p.openingHours as HourRow[] | undefined) ?? [];
  const open = !hours.length
    ? ctx.t("hours unknown")
    : p.openNow
      ? ctx.t("open now")
      : ctx.t("closed");
  return `${KIND_GLYPH[String(p.kind)] ?? "📍"} ${kindName(p.kind, ctx)} · ${open}`;
}

/**
 * Rank a place among the places of its own kind you have been to, by asking: "Better or worse than X?"
 * — a binary search, so ten cafés take three or four questions, never ten. Ranks are 1, 2, 3… within
 * the kind, rewritten after every placement.
 */
async function rankPlace(p: Resolved, ctx: Ctx): Promise<void> {
  const others = (await ctx.query("place"))
    .filter((o) => o.id !== p.id && o.kind === p.kind && visited(o) && typeof o.rankInKind === "number")
    .sort((a, b) => a.rankInKind - b.rankInKind);
  let lo = 0;
  let hi = others.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const other = others[mid]!;
    const answer = await ctx.ui.sheet({
      title: ctx.t("{name}: better or worse than {other}?", { name: String(p.name), other: String(other.name) }),
      items: [
        { id: "better", icon: "👍", label: ctx.t("Better") },
        { id: "worse", icon: "👎", label: ctx.t("Worse") },
      ],
    });
    if (!answer) return; // closed: nothing changes
    if (answer === "better") hi = mid;
    else lo = mid + 1;
  }
  const order = [...others.slice(0, lo), p, ...others.slice(lo)];
  for (let i = 0; i < order.length; i++) {
    if (order[i]!.rankInKind !== i + 1 || order[i]!.id === p.id) await ctx.patch("place", order[i]!.id, { rankInKind: i + 1 });
  }
  ctx.ui.toast(ctx.t("#{n} of your {kinds}", { n: lo + 1, kinds: kindPlural(p.kind, ctx) }));
}

/** "Save this spot": where you stand, a name and a kind, in one sheet. */
async function saveHere(ctx: Ctx): Promise<void> {
  let here: { lat: number; lng: number } | undefined;
  try {
    here = await ctx.caps.geo?.current();
  } catch {
    here = undefined;
  }
  if (!here) {
    ctx.ui.toast(ctx.t("Can't tell where you are. Use “Add here” on the map instead."));
    return;
  }
  const form = await ctx.ui.form<{ name: string; kind: string; status: string; notes: string }>({
    title: ctx.t("Save this spot"),
    fields: {
      name: { type: "text", required: true, label: ctx.t("Name") },
      kind: { type: "enum", options: KINDS, default: "cafe", labels: Object.fromEntries(KINDS.map((k) => [k, kindName(k, ctx)])), label: ctx.t("Kind") },
      status: {
        type: "enum",
        options: ["want to go", "been", "favourite"],
        default: "been",
        labels: Object.fromEntries(["want to go", "been", "favourite"].map((s) => [s, statusName(s, ctx)])),
        label: ctx.t("Status"),
      },
      notes: { type: "text", multiline: true, label: ctx.t("Notes") },
    },
    initial: { kind: "cafe", status: "been" },
    submit: ctx.t("Save"),
  });
  if (!form) return;
  const place = await ctx.create("place", { ...form, location: { lat: here.lat, lng: here.lng } });
  ctx.navigate("detail", { placeId: place.id });
}


// `visited` (a yes/no) became `status` in 2.0.0: visited → been, not yet → want to go. One migration
// from every earlier version, so a device that last opened any of them lands in the same place.
const TO_STATUS: MigrationStep[] = [
  { op: "addField", entity: "place", field: "status", default: "been" },
  { transform: (r) => ("visited" in r ? { ...r, status: (r as { visited?: unknown }).visited === false ? "want to go" : "been" } : r) },
  { op: "dropField", entity: "place", field: "visited" },
];

export default defineApp({
  id: "places",
  name: "Places",
  icon: "📍",
  version: "2.0.0",
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5FB0E4" },
  permissions: { camera: true, geo: true },
  category: "everyday",
  nav: "tabs",
  // The list you are looking at — "Date night", "Sunday" — or all of them. Choosing one narrows the
  // map and the lists; a new place is filed in it.
  scope: { entity: "collection", label: "List" },
  quickActions: [
    { id: "add-place", label: "Add: Place", icon: "📍", entity: "place", mode: "form" },
  ],
  // The launcher tile (docs/04 §Tile): the places still to visit.
  tile: async (ctx) => {
    const places = await ctx.query("place");
    const toVisit = places.filter((p) => p.status === "want to go");
    const last = (await ctx.query("visit")).sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())[0];
    return {
      count: toVisit.length,
      title: ctx.t(
        "{n, plural, =0 {Everywhere visited} one {# to visit} other {# to visit}}",
        { n: toVisit.length },
      ),
      lines: toVisit.slice(0, 3).map((p) => String(p.name)),
      ...(last?.place?.photo ? { image: (Array.isArray(last.place.photo) ? last.place.photo[0] : last.place.photo) as never } : {}),
    };
  },

  entities: {
    // A list of places you keep together and can share: "Date night", "Lisbon weekend".
    collection: {
      label: "List",
      icon: "🗂️",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name", placeholder: "Date night" },
        emoji: { type: "text", label: "Emoji", placeholder: "🌙" },
        note: { type: "text", label: "Note" },
      },
    },

    place: {
      label: "Place",
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        location: {
          type: "geo",
          required: true,
          label: "Location",
        },
        photo: { type: "media", accept: "image", multiple: true, label: "Photo" },
        status: {
          type: "enum",
          options: ["want to go", "been", "favourite"],
          default: "been",
          colors: { "want to go": "yellow", been: "teal", favourite: "pink" },
          labels: {
            "want to go": "want to go",
            been: "been",
            favourite: "favourite",
          },
          label: "Status",
        },
        kind: {
          type: "enum",
          label: "Kind",
          options: KINDS,
          labels: {
            restaurant: "restaurant",
            bar: "bar",
            cafe: "cafe",
            pizza: "pizza",
            bakery: "bakery",
            museum: "museum",
            park: "park",
            viewpoint: "viewpoint",
            shop: "shop",
            stay: "place to stay",
            other: "other",
          },
        },
        notes: { type: "text", multiline: true, label: "Notes" },
        mustOrder: { type: "text", label: "Order this", placeholder: "The cardamom bun" },
        lists: { type: "relation", to: "collection", many: true, label: "Lists" },
        vibes: {
          type: "tags",
          label: "Vibes",
          options: ["cheap", "fancy", "outdoor", "quiet", "late-night", "dog-friendly"],
          labels: {
            cheap: "cheap",
            fancy: "fancy",
            outdoor: "outdoor",
            quiet: "quiet",
            "late-night": "late-night",
            "dog-friendly": "dog-friendly",
          },
        },
        rating: {
          type: "number",
          min: 0,
          max: 5,
          step: 0.5,
          label: "Rating",
        },
        rankInKind: { type: "number", integer: true, hidden: true, label: "Rank among its kind" },
        openingHours: {
          type: "list",
          label: "Opening hours",
          of: {
            day: {
              type: "enum",
              label: "Day",
              options: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              labels: {
                mon: "mon",
                tue: "tue",
                wed: "wed",
                thu: "thu",
                fri: "fri",
                sat: "sat",
                sun: "sun",
              },
            },
            from: { type: "text", placeholder: "09:00", label: "Opens" },
            to: { type: "text", placeholder: "18:00", label: "Closes" },
          },
        },
      },
      computed: {
        // A place nobody has put hours on yet has none: not open, rather than a failure. Pages say
        // "hours unknown" for those instead of a false "closed".
        openNow: (p, ctx) => isOpenNow((p.openingHours as HourRow[] | undefined) ?? [], ctx.now()),
        hasHours: (p) => ((p.openingHours as HourRow[] | undefined) ?? []).length > 0,
        // The cover's chip "#2 of your cafés", beside its status and kind.
        rankText: {
          label: "🏅",
          value: (p, ctx) => (typeof p.rankInKind === "number" && visited(p) ? ctx.t("#{n} of your {kinds}", { n: p.rankInKind, kinds: kindPlural(p.kind, ctx) }) : ""),
        },
        // Directions are the map app's job: a link to the spot, not routing of our own.
        directions: {
          label: "Open in a map",
          value: (p) => (p.location ? `https://www.openstreetmap.org/?mlat=${p.location.lat}&mlon=${p.location.lng}#map=17/${p.location.lat}/${p.location.lng}` : ""),
        },
      },
      actions: {
        logVisit: {
          label: "Log a visit",
          icon: "📸",
          description: "Record a visit to this place: when, what you had, who you were with.",
          input: {
            at: { type: "datetime", required: true, label: "When" },
            dish: { type: "text", label: "What you had" },
            with: { type: "text", label: "Who with" },
            note: { type: "text", multiline: true, label: "Note" },
          },
          run: async (p, ctx, input) => {
            const { at, dish, with: who, note } = (input ?? {}) as { at?: Date | string; dish?: string; with?: string; note?: string };
            await ctx.create("visit", { place: p.id, at: at ? new Date(at) : ctx.now(), dish: dish ?? "", with: who ?? "", note: note ?? "" });
            if (p.status === "want to go") await ctx.patch("place", p.id, { status: "been" });
            // A first visit to a kind you have others of: where does it stand?
            if (typeof p.rankInKind !== "number") await rankPlace({ ...p, status: "been" } as Resolved, ctx);
          },
        },
        rank: {
          label: "Rank it",
          icon: "🏅",
          description: "Place it among the places of its own kind you have been to, by comparing it with them one at a time.",
          run: async (p, ctx) => {
            await rankPlace(p, ctx);
          },
        },
        favourite: {
          label: "Favourite",
          icon: "♥",
          run: async (p, ctx) => {
            await ctx.patch("place", p.id, { status: p.status === "favourite" ? "been" : "favourite" });
          },
        },
      },
    },

    // One time you were there: the memory a place keeps.
    visit: {
      label: "Visit",
      icon: "📸",
      displayField: "title",
      fields: {
        place: { type: "relation", to: "place", required: true, label: "Place" },
        at: { type: "datetime", required: true, label: "When" },
        photo: { type: "media", accept: "image", label: "Photo" },
        dish: { type: "text", label: "What you had" },
        with: { type: "text", label: "Who with" },
        note: { type: "text", multiline: true, label: "Note" },
      },
      computed: {
        title: (v) => String(v.place?.name ?? "—"),
        // On the place's own page the place goes without saying: what you had, and who with.
        what: (v, ctx) => String(v.dish || ctx.t("A visit")),
        company: (v, ctx) => [v.with ? ctx.t("with {who}", { who: String(v.with) }) : "", v.note ?? ""].filter(Boolean).join(" · "),
        // The visit's own photo, else the place's.
        picture: (v) => v.photo ?? (Array.isArray(v.place?.photo) ? v.place.photo[0] : v.place?.photo) ?? null,
      },
    },
  },

  pages: [
    {
      id: "map",
      title: "Map",
      icon: "🗺️",
      // A button the APP puts on the page, running an ordinary function (#216). "Show me all of
      // them" is the other half of the built-in "where am I" — and it is app code, not a host
      // feature, which is the point: `ctx.views` reaches the map that is on screen.
      actions: [
        {
          label: "Show all",
          icon: "⤢",
          run: (ctx) => void ctx.views.map("map").fit(),
        },
        { label: "Save this spot", icon: "📍", run: saveHere },
      ],
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        // "Where shall we go?" answered on the map itself: the places in view as cards along the
        // bottom, nearest the middle first, each with its photo, whether it is open and what to order.
        strip: true,
        title: (p) => p.name,
        // A pin's colour is its kind, so a glance at the map says "coffee here, a bar there".
        color: (p) => KIND_COLOR[String(p.kind)] ?? "#5FB0E4",
        // What a pin says when you tap it. The photo comes first: it, not the name, is what tells
        // you whether this is the place you meant. "Details" opens the record's own page over the
        // map, so reading one never costs you the view you navigated to.
        display: {
          // The pin itself is the kind's emoji: ☕ here, 🍸 there.
          icon: (p) => KIND_GLYPH[String(p.kind)] ?? "📍",
          primary: "name",
          secondary: (p, ctx) =>
            [placeLine(p, ctx), typeof p.rating === "number" ? `${ctx.format.number(p.rating)}★` : "", p.mustOrder ? `“${p.mustOrder}”` : ""].filter(Boolean).join(" · "),
          media: "photo",
          badges: ["status", "vibes"],
        },
        // filter chips in the view chrome write into ctx.params
        filters: [
          { label: "Category", param: "kind", from: "kind" },
          { label: "Status", param: "status", from: "status" },
          { label: "Vibe", param: "vibe", from: "vibes", multi: true },
          {
            label: "Open now",
            param: "openOnly",
            type: "boolean",
          },
        ],
        filter: (p, ctx) => {
          const { kind, status, vibe, openOnly } = ctx.params as { kind?: string; status?: string; vibe?: string[]; openOnly?: boolean };
          const list = ctx.scope.collection;
          if (list && !((p.lists as Array<{ id: string }> | undefined) ?? []).some((l) => l?.id === list.id)) return false;
          if (kind && p.kind !== kind) return false;
          if (status && p.status !== status) return false;
          if (vibe?.length && !vibe.some((v) => ((p.vibes as string[] | undefined) ?? []).includes(v))) return false;
          if (openOnly && !p.openNow) return false;
          return true;
        },
      },
    },
    {
      id: "list",
      title: "All places",
      icon: "📍",
      description: "Favourites first, by kind. Rank a place against the others of its kind.",
      // Figures over the page's filtered rows. Both forms: `op` for a plain aggregate (declarative,
      // so the structural editor can edit it), a `value` function for the one that needs a rule.
      summary: [
        { label: "Places", op: "count" },
        {
          label: "Visited",
          value: (rows) => rows.filter((p) => visited(p)).length,
        },
      ],
      // A split (#105): on a wide screen a row fills the place on the right; on a phone it opens the
      // place's own page, as any list does.
      layout: {
        type: "split",
        items: [
          {
            view: {
              type: "list",
              entity: "place",
              filters: [
                { label: "Category", param: "kind", from: "kind" },
                { label: "Status", param: "status", from: "status" },
                // "Near me" asks the device where it is (ctx.caps.geo) and keeps what is within 2 km.
                { label: "Near me", param: "me", type: "geo" },
              ],
              filter: (p, ctx) => {
                const { kind, status, me } = ctx.params as { kind?: string; status?: string; me?: { lat: number; lng: number } };
                const list = ctx.scope.collection;
                if (list && !((p.lists as Array<{ id: string }> | undefined) ?? []).some((l) => l?.id === list.id)) return false;
                if (me && !(p.location && distanceKm(p.location, me) <= 2)) return false;
                return (!kind || p.kind === kind) && (!status || p.status === status);
              },
              // Favourites, then by your own ranking, then by rating.
              sort: (a, b) =>
                Number(b.status === "favourite") - Number(a.status === "favourite") ||
                (a.rankInKind ?? 99) - (b.rankInKind ?? 99) ||
                (b.rating ?? 0) - (a.rating ?? 0),
              // Every category at once, in the enum's order, each folding away (#108). The chips still
              // narrow it to one.
              group: "kind",
              collapsible: true,
              display: {
                primary: "name",
                // The heading already says the category, so the row does not repeat it. "4,5★" in Polish.
                secondary: (p, ctx) =>
                  [
                    typeof p.rankInKind === "number" && visited(p) ? `#${p.rankInKind}` : "",
                    typeof p.rating === "number" ? `${ctx.format.number(p.rating)}★` : "",
                    statusName(p.status, ctx),
                    p.mustOrder ? `“${p.mustOrder}”` : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                media: "photo",
                badges: ["vibes"],
              },
              // No button on every row: making a favourite is done on the place's page, now and then.
              onOpen: { page: "detail", param: { placeId: "id" } },
            },
          },
          {
            view: { type: "detail", entity: "place", param: "placeId", cover: "background", facts: ["status", "kind", "rankText"], primaryAction: "logVisit", actions: ["rank", "favourite"] },
          },
        ],
      },
    },
    {
      // Where you have been: every visit on a rail, by month, with its photo.
      id: "memories",
      title: "Memories",
      icon: "📸",
      description: "Every visit you logged, what you had and who you were with.",
      view: {
        type: "timeline",
        entity: "visit",
        date: "at",
        groupBy: "month",
        display: {
          primary: "title",
          secondary: (v, ctx) =>
            [v.dish, v.with ? ctx.t("with {who}", { who: String(v.with) }) : "", v.note].filter(Boolean).join(" · "),
          media: "picture",
        },
        emptyText: "No visits yet. On a place's page, “Log a visit”.",
      },
    },
    {
      id: "detail",
      title: "Place",
      hidden: true,
      view: {
        type: "detail",
        entity: "place",
        param: "placeId",
        // What to order and the notes on the first screen, over the photo; Log a visit at the bottom.
        cover: "background",
        facts: ["status", "kind", "rankText"],
        primaryAction: "logVisit",
        sections: [
          { title: "Overview", fields: ["mustOrder", "notes", "vibes", "rating", "lists"] },
          {
            // Every time you were there, on the place's own page: what you had, who with.
            title: "Visits",
            related: { entity: "visit", via: "place", view: "timeline", date: "at", display: { primary: "what", secondary: "company" }, limit: 10 },
          },
          { title: "Hours", fields: ["openingHours"], collapsible: true },
          { title: "Location", fields: ["location", "directions"] },
        ],
        actions: ["rank", "favourite"],
      },
    },
  ],

  migrations: ["1.0.0", "1.1.0", "1.2.0", "1.2.1", "1.3.0"].map((from) => ({ from, to: "2.0.0", steps: TO_STATUS })),

  reminders: [],
});
