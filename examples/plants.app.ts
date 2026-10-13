// plants.app.ts
// Stresses: datetime logic, season-dependent computed interval (real branching), reminders
// as functions returning Date|null, a quick action, calendar view. And words built inside functions
// (#302): "in 3 days" from `ctx.format.relative`, a plural from `ctx.t`, both right in any language
// and in the sealed box — a hand-written "in 3d" was English only.
import { defineApp } from "potyro";

// plain helpers — full code, your own module in a real project
const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const seasonOf = (d: Date): "spring" | "summer" | "autumn" | "winter" => {
  const m = d.getMonth(); // northern hemisphere
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
};

// arbitrary logic: seasonal override falls back to the base interval
type Plant = {
  lastWatered?: Date; wateringIntervalDays: number; active: boolean; name: string;
  seasonalCare: { season: string; intervalDays: number }[];
};
const effectiveIntervalDays = (p: Plant) => {
  const s = seasonOf(new Date());
  const override = p.seasonalCare.find((r) => r.season === s);
  return override?.intervalDays ?? p.wateringIntervalDays;
};
// Never watered counts as long overdue: a new plant is due the moment it exists.
const nextWatering = (p: Plant) => addDays(p.lastWatered ?? new Date(0), effectiveIntervalDays(p));

export default defineApp({
  id: "plants",
  name: "Plants",
  icon: "🌱",
  version: "1.1.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#7FCF8E" },
  permissions: { camera: true, notifications: true },

  entities: {
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        photo: { type: "media", accept: "image" },
        wiki: { type: "url" },
        // No options on purpose: these are the owner's own words — "from Ana", "needs repotting" —
        // so the control is type-a-word-press-Enter, not a fixed set (#98).
        labels: { type: "tags", help: "Your own words: where it lives, who gave it to you" },
        needsDirectSun: { type: "boolean", default: false },
        active: { type: "boolean", default: true },
        lastWatered: { type: "datetime", width: "half" },
        wateringIntervalDays: { type: "number", unit: "days", min: 1, default: 7, integer: true, width: "half", help: "The reminder comes this many days after a watering" },
        seasonalCare: {
          type: "list",
          of: {
            season: {
              type: "enum",
              options: ["spring", "summer", "autumn", "winter"],
              colors: { spring: "green", summer: "yellow", autumn: "orange", winter: "blue" },
              // What each option reads as; records keep "spring". In a translated app each is a map.
              labels: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
            },
            intervalDays: { type: "number", min: 1, integer: true },
            note: { type: "text" },
          },
        },
      },
      computed: {
        currentIntervalDays: (p) => effectiveIntervalDays(p as unknown as Plant),
        nextWatering: (p) => nextWatering(p as unknown as Plant),
        overdue: (p) => p.active && Date.now() > nextWatering(p as unknown as Plant).getTime(),
      },
      actions: {
        water: async (p, ctx) => {
          await ctx.patch("plant", p.id, { lastWatered: ctx.now() });
        },
      },
    },
  },

  pages: [
    // A home page made of three views (#105): the figures, the overdue plants, the month. Each is
    // an ordinary view, so this page renders for someone this app is shared with, in the sandbox.
    {
      id: "today",
      title: "Today",
      icon: "☀️",
      layout: {
        type: "grid",
        items: [
          {
            title: "Watering",
            span: 1,
            view: {
              type: "aggregate",
              entity: "plant",
              rows: (plants, ctx) => {
                const week = Date.now() + 7 * DAY;
                const thisWeek = plants.filter((p) => p.active && p.nextWatering.getTime() <= week).length;
                // The value stays a number — the view formats it; the words around it come from ctx.t.
                return [
                  { label: "Due now", value: plants.filter((p) => p.overdue).length, tone: plants.some((p) => p.overdue) ? "negative" : undefined },
                  {
                    label: "This week",
                    value: thisWeek,
                    detail: ctx.t({ en: "{n, plural, =0 {nothing to water} one {# plant to water} other {# plants to water}}" }, { n: thisWeek }),
                  },
                  { label: "Plants", value: plants.filter((p) => p.active).length },
                ];
              },
            },
          },
          {
            title: "Overdue",
            span: 2,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.overdue,
              sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: { primary: "name", secondary: (p, ctx) => ctx.t({ en: "due {when}" }, { when: ctx.format.relative(p.nextWatering, { unit: "day" }) }) },
              rowActions: ["water"],
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: "Nothing to water. 🌱",
            },
          },
          {
            title: "This month",
            span: 3,
            view: { type: "calendar", entity: "plant", date: "nextWatering", title: (p) => p.name, color: (p) => (p.needsDirectSun ? "#E4A93C" : "#7FCF8E") },
          },
        ],
      },
    },
    {
      id: "list",
      title: "Plants",
      view: {
        type: "list",
        entity: "plant",
        sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
        display: {
          primary: (p) => p.name,
          secondary: (p, ctx) => (p.overdue ? "overdue!" : ctx.t({ en: "next: {when}" }, { when: ctx.format.relative(p.nextWatering, { unit: "day" }) })),
          media: "photo",
          badges: ["needsDirectSun"],
        },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
      },
    },
    {
      id: "due",
      title: "Due",
      view: {
        type: "list",
        entity: "plant",
        filter: (p) => p.overdue,
        sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
        display: { primary: "name", secondary: (p, ctx) => ctx.t({ en: "due {when}" }, { when: ctx.format.relative(p.nextWatering, { unit: "day" }) }), media: "photo" },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
        emptyText: "Nothing to water. 🌱",
      },
    },
    {
      // A plant's own page: Water is its one filled action; Edit and Delete sit behind More actions.
      id: "plant",
      title: "Plant",
      hidden: true,
      view: { type: "detail", entity: "plant", param: "plantId", actions: ["water"] },
    },
    {
      id: "schedule",
      title: "Schedule",
      view: {
        type: "calendar",
        entity: "plant",
        date: "nextWatering",
        title: (p) => p.name,
        color: (p) => (p.needsDirectSun ? "#E4A93C" : "#7FCF8E"),
      },
    },
  ],

  reminders: [
    {
      id: "water-due",
      entity: "plant",
      when: (p) => (p.active ? p.nextWatering : null),
      // The plant's name is a record, so it is never translated: the app's words go around it.
      title: (p, ctx) => ctx.t({ en: "Water {name}" }, { name: p.name }),
      body: (p, ctx) => (p.lastWatered ? ctx.t({ en: "Last watered {when}" }, { when: ctx.format.relative(p.lastWatered, { unit: "day" }) }) : "Never watered yet"),
    },
  ],
});
