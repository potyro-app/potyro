// plants.app.ts
// Stresses: datetime logic, season-dependent computed interval (real branching), reminders
// as functions returning Date|null, a quick action, calendar view.
import { defineApp } from "karta";

// plain helpers — full code, your own module in a real project
const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const relativeTime = (d: Date) => {
  const days = Math.round((d.getTime() - Date.now()) / DAY);
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
};
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
  version: "1.0.0",
  schemaVersion: 1,
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
        needsDirectSun: { type: "boolean", default: false },
        active: { type: "boolean", default: true },
        lastWatered: { type: "datetime", width: "half" },
        wateringIntervalDays: { type: "number", unit: "days", min: 1, default: 7, integer: true, width: "half", help: "The reminder comes this many days after a watering" },
        seasonalCare: {
          type: "list",
          of: {
            season: { type: "enum", options: ["spring", "summer", "autumn", "winter"] },
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
              rows: (plants) => {
                const week = Date.now() + 7 * DAY;
                return [
                  { label: "Due now", value: plants.filter((p) => p.overdue).length, tone: plants.some((p) => p.overdue) ? "negative" : undefined },
                  { label: "This week", value: plants.filter((p) => p.active && p.nextWatering.getTime() <= week).length },
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
              display: { primary: "name", secondary: (p) => `due ${relativeTime(p.nextWatering)}` },
              rowActions: ["water"],
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
          secondary: (p) => (p.overdue ? "overdue!" : `next: ${relativeTime(p.nextWatering)}`),
          media: "photo",
          badges: ["needsDirectSun"],
        },
        rowActions: ["water"],
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
        display: { primary: "name", secondary: (p) => `due ${relativeTime(p.nextWatering)}`, media: "photo" },
        rowActions: ["water"],
        emptyText: "Nothing to water. 🌱",
      },
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
      title: (p) => `Water ${p.name}`,
      body: (p) => `Last watered ${p.lastWatered ? relativeTime(p.lastWatered) : "never"}`,
    },
  ],
});
