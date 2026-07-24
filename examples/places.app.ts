// places.app.ts
// Stresses: geo field + map view, two categorizations, nested opening-hours rows, and
// JS filters for "open now" and "within N km" — arbitrary logic, no DSL.
import { defineApp } from "karta";

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
  version: "1.0.0",
  schemaVersion: 1,
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
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: (p) => p.name,
        color: (p) => (p.kind === "bar" ? "#E4A93C" : p.kind === "pizza" ? "#C0574D" : "#5FB0E4"),
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
        // ctx.params.me is filled from ctx.caps.geo by the view chrome
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
      view: {
        type: "list",
        entity: "place",
        sort: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
        display: {
          primary: "name",
          secondary: (p) => `${p.kind} · ${p.rating ?? "–"}★`,
          media: "photo",
          badges: ["vibes"],
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
