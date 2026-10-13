// places.app.ts
// Stresses: geo field + map view, two categorizations, nested opening-hours rows, and
// JS filters for "open now" and "within N km" — arbitrary logic, no DSL.
import { defineApp } from "potyro";

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

export default defineApp({
  id: "places",
  name: "Places",
  icon: "📍",
  version: "1.1.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#5FB0E4" },
  permissions: { camera: true, geo: true },

  entities: {
    place: {
      label: "Place",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        location: { type: "geo", required: true },
        photo: { type: "media", accept: "image", multiple: true },
        notes: { type: "text", multiline: true },
        kind: { type: "enum", options: ["restaurant", "bar", "cafe", "pizza", "bakery", "other"] },
        vibes: { type: "tags", options: ["cheap", "fancy", "outdoor", "quiet", "late-night", "dog-friendly"] },
        visited: { type: "boolean", default: true },
        rating: { type: "number", min: 0, max: 5, step: 0.5 },
        openingHours: {
          type: "list",
          of: {
            day: { type: "enum", options: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
            from: { type: "text", label: "From (HH:MM)" },
            to: { type: "text", label: "To (HH:MM)" },
          },
        },
      },
      computed: {
        openNow: (p, ctx) => isOpenNow(p.openingHours as HourRow[], ctx.now()),
      },
      actions: {
        markVisited: async (p, ctx) => { await ctx.patch("place", p.id, { visited: true }); },
      },
    },
  },

  pages: [
    {
      id: "map",
      title: "Map",
      // A button the APP puts on the page, running an ordinary function (#216). "Show me all of
      // them" is the other half of the built-in "where am I" — and it is app code, not a host
      // feature, which is the point: `ctx.views` reaches the map that is on screen.
      actions: [{ label: "Show all", icon: "⤢", run: (ctx) => void ctx.views.map("map").fit() }],
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: (p) => p.name,
        color: (p) => (p.kind === "bar" ? "#E4A93C" : p.kind === "pizza" ? "#C0574D" : "#5FB0E4"),
        // What a pin says when you tap it. The photo comes first: it, not the name, is what tells
        // you whether this is the place you meant. "Details" opens the record's own page over the
        // map, so reading one never costs you the view you navigated to.
        display: {
          primary: "name",
          secondary: (p) => `${p.kind} · ${p.openNow ? "open now" : "closed"}`,
          media: "photo",
          badges: ["vibes"],
        },
        // filter chips in the view chrome write into ctx.params
        filters: [
          { label: "Category", param: "kind", from: "kind" },
          { label: "Vibe", param: "vibe", from: "vibes", multi: true },
          { label: "Open now", param: "openOnly", type: "boolean" },
        ],
        filter: (p, ctx) => {
          const { kind, vibe, openOnly } = ctx.params as { kind?: string; vibe?: string[]; openOnly?: boolean };
          if (kind && p.kind !== kind) return false;
          if (vibe?.length && !vibe.some((v) => p.vibes.includes(v))) return false;
          if (openOnly && !p.openNow) return false;
          return true;
        },
      },
    },
    {
      id: "nearby",
      title: "Near me",
      view: {
        type: "list",
        entity: "place",
        // the "Near me" chip fills ctx.params.me from ctx.caps.geo (view chrome)
        filters: [{ label: "Near me", param: "me", type: "geo" }],
        filter: (p, ctx) => {
          const me = ctx.params.me as { lat: number; lng: number } | undefined;
          return !!me && distanceKm(p.location, me) <= 2;
        },
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (p) => `${p.kind} · ${p.openNow ? "open" : "closed"}`,
          media: "photo",
          badges: ["vibes"],
        },
      },
    },
    {
      id: "list",
      title: "All places",
      // Figures over the page's filtered rows. Both forms: `op` for a plain aggregate (declarative,
      // so the structural editor can edit it), a `value` function for the one that needs a rule.
      summary: [
        { label: "Places", op: "count" },
        { label: "Average rating", field: "rating", op: "avg" },
        { label: "Visited", value: (rows) => rows.filter((p) => p.visited).length },
      ],
      view: {
        type: "list",
        entity: "place",
        filters: [{ label: "Category", param: "kind", from: "kind" }],
        filter: (p, ctx) => {
          const kind = (ctx.params as { kind?: string }).kind;
          return !kind || p.kind === kind;
        },
        sort: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
        // Every category at once, in the enum's order, each folding away (#108). The chips still
        // narrow it to one.
        group: "kind",
        collapsible: true,
        display: {
          primary: "name",
          // The heading already says the category, so the row does not repeat it.
          secondary: (p) => `${p.rating ?? "–"}★`,
          media: "photo",
          badges: ["vibes"],
        },
        onOpen: { page: "detail", param: { placeId: "id" } },
      },
    },
    {
      // A screen folded out of the WHOLE set rather than out of each record (KA-24). Counting places
      // per category is not per-record arithmetic and is not one figure either, so before the
      // `aggregate` view it could only have been a custom view — and would then have rendered blank
      // for anyone this app was shared with, because custom views are trusted-only.
      //
      // The fold is ordinary TypeScript and runs through the host, so it behaves identically in the
      // isolate. That is the whole claim, and `places-sandbox.spec.ts` checks it untrusted.
      id: "by-kind",
      title: "By category",
      view: {
        type: "aggregate",
        entity: "place",
        title: "Places by category",
        emptyText: "No places yet.",
        rows: (places) => {
          const counts = new Map<string, { n: number; rated: number[] }>();
          for (const p of places) {
            const kind = String(p.kind ?? "unknown");
            const bucket = counts.get(kind) ?? { n: 0, rated: [] };
            bucket.n += 1;
            if (typeof p.rating === "number") bucket.rated.push(p.rating);
            counts.set(kind, bucket);
          }
          return [...counts.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([kind, { n, rated }]) => ({
              id: kind,
              label: kind,
              value: n,
              detail: rated.length
                ? `avg ${(rated.reduce((s, r) => s + r, 0) / rated.length).toFixed(1)}★`
                : undefined,
              group: "Categories",
            }));
        },
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
        sections: [
          { title: "Overview", fields: ["photo", "kind", "vibes", "rating"] },
          { title: "Notes", fields: ["notes"] },
          { title: "Hours", fields: ["openingHours"] },
          { title: "Location", fields: ["location"] },
        ],
        actions: ["markVisited"],
      },
    },
  ],

  reminders: [],
});
