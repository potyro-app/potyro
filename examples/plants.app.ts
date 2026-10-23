// plants.app.ts
// Made for the walk round the flat with a watering can: Today is who wants water, room by room, each
// with a 💧 to tap, and what comes up next. Or tell it "the soil is still wet", and after two of
// those the plant's rhythm stretches by a day, with a rule you can read. Every watering, feed, mist
// and repot goes in a care log you can backdate. A new plant can come from a photo: AI suggests the
// name and the rhythm, you check them.
//
// Stresses: datetime logic, season-dependent computed interval (real branching), reminders as
// functions returning Date|null, actions with input (log care on any day), `ctx.caps.ai` with a
// confirm form, grouped lists and a timeline. And words built inside functions (#302): "in 3 days" from
// `ctx.format.relative`, a plural from `ctx.t`, both right in any language and in the sealed box.
//
// Written in English; its translations are catalogs, examples/files/plants/locales/<lang>.po (docs/30),
// every language but English a model's draft (#297). A plant's name, photo and labels are records and
// stay as written.
import { defineApp, type AiImage, type Ctx, type Resolved } from "potyro";

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
  seasonalCare?: { season: string; intervalDays: number }[];
  snoozedUntil?: Date | null;
};
const effectiveIntervalDays = (p: Plant) => {
  const s = seasonOf(new Date());
  const override = (p.seasonalCare ?? []).find((r) => r.season === s);
  return override?.intervalDays ?? p.wateringIntervalDays;
};
// Never watered counts as long overdue: a new plant is due the moment it exists. "Soil still wet"
// pushes it to the snooze date, never earlier than its rhythm says.
const nextWatering = (p: Plant) => {
  const due = addDays(p.lastWatered ? new Date(p.lastWatered) : new Date(0), effectiveIntervalDays(p));
  const snoozed = p.snoozedUntil ? new Date(p.snoozedUntil) : null;
  return snoozed && snoozed > due ? snoozed : due;
};
const FEED_EVERY = 28;
/** Feeding is for the growing months: every four weeks in spring and summer, never in the rest. */
const nextFeed = (p: Resolved, now: Date): Date | null => {
  const s = seasonOf(now);
  if (p.active === false || (s !== "spring" && s !== "summer")) return null;
  return addDays(p.lastFertilized ? new Date(p.lastFertilized) : new Date(0), FEED_EVERY);
};

/** "in 2 days", "today", "3 days ago" — in the person's language. */
const when = (d: Date, ctx: Ctx): string => ctx.format.relative(d, { unit: "day" });

/** A kind of care in words: the same as `kind`'s labels. */
const careName = (k: unknown, ctx: Ctx): string => {
  switch (k) {
    case "water":
      return ctx.t("Watered");
    case "fertilize":
      return ctx.t("Fed");
    case "mist":
      return ctx.t("Misted");
    case "repot":
      return ctx.t("Repotted");
    case "prune":
      return ctx.t("Pruned");
    default:
      return ctx.t("Note");
  }
};

/** Write one care event, and what it means for the plant's own dates. */
async function logCare(ctx: Ctx, plant: Resolved, kind: string, at: Date, note = ""): Promise<void> {
  await ctx.create("care", { plant: plant.id, kind, at, note });
  if (kind === "water" && (!plant.lastWatered || at >= new Date(plant.lastWatered))) {
    await ctx.patch("plant", plant.id, { lastWatered: at, snoozedUntil: null, snoozes: 0 });
  }
  if (kind === "fertilize" && (!plant.lastFertilized || at >= new Date(plant.lastFertilized))) {
    await ctx.patch("plant", plant.id, { lastFertilized: at });
  }
}

// ---- Add a plant from a photo: AI suggests, the person confirms. Nothing it says is saved unchecked. ----

const GUESS = {
  commonName: "text",
  species: "text?",
  waterEveryDays: "number",
  directSun: "boolean",
  tip: "text?",
} as const;

async function addPlant(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet({
    title: ctx.t("Add a plant"),
    items: [
      { id: "photo", icon: "camera", label: ctx.t("From a photo"), detail: ctx.t("AI suggests what it is and how often to water") },
      { id: "type", icon: "pencil", label: ctx.t("Type it in") },
    ],
  });
  if (!how) return;
  let guess: { commonName?: string; species?: string | null; waterEveryDays?: number; directSun?: boolean; tip?: string | null } = {};
  let photo: unknown;
  if (how === "photo") {
    const [file] = await ctx.files.import({ folder: "plants", accept: "image/*" });
    if (!file) return;
    const bytes = await ctx.files.bytes(file);
    if (bytes) photo = await ctx.media.put(new Blob([bytes as BlobPart], { type: file.mime }));
    if (ctx.caps.ai) {
      const bar = ctx.ui.progress(ctx.t("Looking at your plant…"));
      try {
        guess = await ctx.caps.ai.extract({
          image: file as AiImage,
          instructions: "A houseplant. Its common name, its species if you can tell, roughly how many days between waterings indoors, and whether it wants direct sun. One short care tip.",
          schema: GUESS,
        });
      } catch {
        // A guess that failed is no guess: the form opens empty and the person fills it in.
      } finally {
        bar.done();
      }
    }
  }
  const checked = await ctx.ui.form<{ name: string; species: string; room: string; wateringIntervalDays: number; needsDirectSun: boolean }>({
    title: guess.commonName
      ? ctx.t("AI's guess — check it")
      : ctx.t("New plant"),
    fields: {
      name: { type: "text", required: true, label: ctx.t("Name") },
      species: { type: "text", label: ctx.t("Species") },
      // Where it lives: Today lists who wants water room by room.
      room: { type: "text", label: ctx.t("Room"), placeholder: ctx.t("Living room") },
      wateringIntervalDays: { type: "number", min: 1, integer: true, label: ctx.t("Water every (days)") },
      needsDirectSun: { type: "boolean", label: ctx.t("Wants direct sun") },
    },
    initial: { name: guess.commonName ?? "", species: guess.species ?? "", room: "", wateringIntervalDays: Math.max(1, Math.round(guess.waterEveryDays ?? 7)), needsDirectSun: guess.directSun ?? false },
    submit: ctx.t("Add plant"),
  });
  if (!checked) return;
  const plant = await ctx.create("plant", {
    ...checked,
    active: true,
    labels: [],
    seasonalCare: [],
    ...(photo ? { photo } : {}),
    ...(guess.tip ? { tip: guess.tip } : {}),
  });
  ctx.navigate("plant", { plantId: plant.id });
}

export default defineApp({
  id: "plants",
  name: "Plants",
  icon: "sprout",
  version: "2.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#7FCF8E" },
  category: "everyday",
  nav: "tabs",
  // The launcher tile (docs/04 §Tile): how many plants want water now, which ones, and one's photo.
  tile: async (ctx) => {
    const now = ctx.now().getTime();
    const due = (await ctx.query("plant"))
      .filter((p) => p.active !== false && nextWatering(p as unknown as Plant).getTime() <= now)
      .sort((a, b) => nextWatering(a as unknown as Plant).getTime() - nextWatering(b as unknown as Plant).getTime());
    return {
      count: due.length,
      title: ctx.t(
        "{n, plural, =0 {All watered} one {# to water} other {# to water}}",
        { n: due.length },
      ),
      lines: due.slice(0, 3).map((p) => String(p.name)),
      ...(due.find((p) => p.photo) ? { image: due.find((p) => p.photo)!.photo as never } : {}),
    };
  },
  permissions: { camera: true, notifications: true, ai: true },
  // The "+" on Today and Plants runs addPlant (a photo AI reads, or typed); this is the whole form.
  quickActions: [
    { id: "add-plant", label: "Add: Plant", icon: "sprout", entity: "plant", mode: "form" },
  ],

  entities: {
    plant: {
      label: "Plant",
      icon: "sprout",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        photo: { type: "media", accept: "image", label: "Photo" },
        wiki: { type: "url", label: "Wiki" }, // the same in every language
        // No options on purpose: these are the owner's own words — "from Ana", "needs repotting" —
        // so the control is type-a-word-press-Enter, not a fixed set (#98).
        labels: {
          type: "tags",
          label: "Labels",
          help: "Your own words: where it lives, who gave it to you",
        },
        // Where it lives: Today goes room by room, the way you walk round with the watering can.
        room: {
          type: "text",
          label: "Room",
          placeholder: "Living room",
        },
        needsDirectSun: {
          type: "boolean",
          default: false,
          label: { text: "Wants direct sun", context: "plant needsDirectSun" },
        },
        active: { type: "boolean", default: true, label: "Active" },
        lastWatered: {
          type: "datetime",
          width: "half",
          label: "Last watered",
        },
        wateringIntervalDays: {
          type: "number",
          unit: "days",
          min: 1,
          default: 7,
          integer: true,
          width: "half",
          label: "Water every",
          help: "The reminder comes this many days after a watering",
        },
        seasonalCare: {
          type: "list",
          label: "Seasonal care",
          of: {
            season: {
              type: "enum",
              label: "Season",
              options: ["spring", "summer", "autumn", "winter"],
              colors: { spring: "green", summer: "yellow", autumn: "orange", winter: "blue" },
              // What each option reads as; records keep "spring", whatever the language.
              labels: {
                spring: "Spring",
                summer: "Summer",
                autumn: "Autumn",
                winter: "Winter",
              },
            },
            intervalDays: {
              type: "number",
              min: 1,
              integer: true,
              unit: "days",
              label: "Water every",
            },
            note: { type: "text", label: { text: "Note", context: "seasonalCare note" } },
          },
        },
        species: { type: "text", label: "Species", placeholder: "Monstera deliciosa" },
        tip: { type: "text", multiline: true, label: "Care tip" },
        lastFertilized: {
          type: "datetime",
          width: "half",
          label: "Last fed",
        },
        // "Soil still wet": not before this day, and how many times in a row it was said.
        snoozedUntil: { type: "datetime", hidden: true, label: "Not before" },
        snoozes: { type: "number", integer: true, default: 0, hidden: true, label: "Still wet, in a row" },
      },
      groups: [
        { fields: ["name", "species", "photo", "room", "labels", "needsDirectSun"] },
        { title: "Watering", fields: ["lastWatered", "wateringIntervalDays", "rhythm", "nextText", "seasonalCare"] },
        { title: "Care", fields: ["lastFertilized", "feedText", "tip", "wiki", "active"], collapsible: true },
      ],
      computed: {
        currentIntervalDays: (p) => effectiveIntervalDays(p as unknown as Plant),
        nextWatering: (p) => nextWatering(p as unknown as Plant),
        overdue: (p) => p.active && Date.now() > nextWatering(p as unknown as Plant).getTime(),
        // The cover's chips and the record page's words: no "OVERDUE!", just what to do and when.
        nextText: {
          label: "💧",
          value: (p, ctx) =>
            !p.active
              ? ""
              : Date.now() > nextWatering(p as unknown as Plant).getTime()
                ? ctx.t("Thirsty — water today")
                : ctx.t("Water {when}", { when: when(nextWatering(p as unknown as Plant), ctx) }),
        },
        rhythm: {
          label: "🗓",
          value: (p, ctx) =>
            ctx.t(
              "Every {n, plural, one {day} other {# days}}",
              { n: effectiveIntervalDays(p as unknown as Plant) },
            ),
        },
        sun: {
          label: "☀️",
          value: (p, ctx) =>
            p.needsDirectSun
              ? ctx.t("Direct sun")
              : ctx.t("Bright, no direct sun"),
        },
        feedText: {
          label: "Feeding",
          value: (p, ctx) => {
            const next = nextFeed(p, ctx.now());
            return next
              ? ctx.t("Feed {when} (every 4 weeks in spring and summer)", { when: when(next < ctx.now() ? ctx.now() : next, ctx) })
              : ctx.t("Resting: no feed until spring");
          },
        },
      },
      actions: {
        water: {
          label: "Water",
          icon: "droplet",
          description: "Record that this plant was watered now.",
          run: async (p, ctx) => {
            await logCare(ctx, p, "water", ctx.now());
          },
        },
        snooze: {
          label: "Soil still wet",
          icon: "hourglass",
          description: "The soil is still wet: ask again in two days. Twice in a row stretches the plant's rhythm by a day.",
          run: async (p, ctx) => {
            // The rule, readable: two "still wet" in a row and the plant drinks less often than you thought.
            const snoozes = Number(p.snoozes ?? 0) + 1;
            const stretch = snoozes >= 2;
            const interval = Number(p.wateringIntervalDays) + (stretch ? 1 : 0);
            await ctx.patch("plant", p.id, { snoozedUntil: addDays(ctx.now(), 2), snoozes: stretch ? 0 : snoozes, wateringIntervalDays: interval });
            ctx.ui.toast(
              stretch
                ? ctx.t("{name} stays wet longer: every {n} days from now", { name: String(p.name), n: interval })
                : ctx.t("Asking again in two days"),
            );
          },
        },
        logCare: {
          label: "Log care…",
          icon: "notebook-pen",
          description: "Record a watering, a feed, misting, repotting or a note, on any day — today or earlier.",
          input: {
            kind: {
              type: "enum",
              options: ["water", "fertilize", "mist", "repot", "prune", "note"],
              default: "water",
              label: "What",
              labels: {
                water: "water",
                fertilize: "feed",
                mist: "mist",
                repot: "repot",
                prune: "prune",
                note: "note",
              },
            },
            at: { type: "datetime", required: true, label: "When" },
            note: { type: "text", label: { text: "Note", context: "seasonalCare note" } },
          },
          run: async (p, ctx, input) => {
            const { kind, at, note } = (input ?? {}) as { kind?: string; at?: Date | string; note?: string };
            await logCare(ctx, p, kind ?? "water", at ? new Date(at) : ctx.now(), note ?? "");
          },
        },
      },
    },

    // Every watering, feed and repot, on the day it happened: the plant's history.
    care: {
      label: { text: "Care", context: "care" },
      icon: "droplet",
      displayField: "title",
      fields: {
        plant: { type: "relation", to: "plant", required: true, label: "Plant" },
        kind: {
          type: "enum",
          options: ["water", "fertilize", "mist", "repot", "prune", "note"],
          default: "water",
          colors: { water: "blue", fertilize: "green", mist: "teal", repot: "orange", prune: "yellow", note: "grey" },
          labels: {
            water: "water",
            fertilize: "feed",
            mist: "mist",
            repot: "repot",
            prune: "prune",
            note: "note",
          },
          label: "What",
        },
        at: { type: "datetime", required: true, label: "When" },
        note: { type: "text", label: { text: "Note", context: "seasonalCare note" } },
      },
      computed: {
        title: (c, ctx) => `${careName(c.kind, ctx)} · ${String(c.plant?.name ?? "—")}`,
        // On the plant's own page the plant goes without saying: what was done, and its glyph.
        what: (c, ctx) => careName(c.kind, ctx),
        glyph: (c) => ({ water: "💧", fertilize: "🌱", mist: "💨", repot: "🪴", prune: "✂️" } as Record<string, string>)[String(c.kind)] ?? "📝",
        picture: (c) => c.plant?.photo ?? null,
      },
    },
  },

  pages: [
    // Today, for the walk round the flat: who wants water, room by room, each with a 💧 — tapped, it
    // leaves the list. Under it on a phone (beside it on a wide screen), the days ahead. One line of
    // figures; no picture, no table of counts.
    {
      id: "today",
      title: "Today",
      icon: "sun",
      description: "Who wants water today, room by room, and who comes next.",
      actions: [{ label: "Add a plant", icon: "plus", run: addPlant }],
      add: 0,
      summary: [
        {
          label: "to water today",
          value: async (_rows, ctx) => (await ctx.query("plant")).filter((p) => p.overdue).length,
        },
        {
          label: "tomorrow",
          value: async (_rows, ctx) => {
            const end = ctx.today().getTime() + 2 * DAY;
            return (await ctx.query("plant")).filter((p) => p.active && !p.overdue && p.nextWatering.getTime() < end).length;
          },
        },
      ],
      layout: {
        type: "grid",
        items: [
          {
            title: "Water now",
            span: 2,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.overdue,
              // A plant with no room comes first, under no heading.
              group: "room",
              sort: (a, b) => String(a.room ?? "").localeCompare(String(b.room ?? "")) || a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: {
                primary: "name",
                // One short line beside the 💧: how long it has gone without.
                secondary: (p, ctx) =>
                  p.lastWatered
                    ? ctx.t("watered {when}", { when: when(new Date(p.lastWatered), ctx) })
                    : ctx.t("never watered here yet"),
                media: "photo",
              },
              rowActions: ["water"],
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: "Everyone's had a drink. 🌱",
            },
          },
          {
            title: "Coming up",
            span: 1,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.active && !p.overdue && p.nextWatering.getTime() <= Date.now() + 7 * DAY,
              sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: {
                primary: "name",
                secondary: (p, ctx) => [ctx.t("water {when}", { when: when(p.nextWatering, ctx) }), String(p.room ?? "")].filter(Boolean).join(" · "),
                media: "photo",
              },
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: "A quiet week ahead.",
            },
          },
        ],
      },
    },
    {
      // Every plant as a photo, by where it lives.
      id: "list",
      actions: [{ label: "Add a plant", icon: "plus", run: addPlant }],
      add: 0,
      title: "Plants",
      icon: "leaf",
      description: "Every plant in the house, by its photo.",
      view: {
        type: "list",
        entity: "plant",
        // Search matches the name, the room and the person's own labels ("from Ana").
        filters: [
          {
            label: "Search",
            param: "q",
            type: "text",
            placeholder: "Name or label",
          },
        ],
        filter: (p, ctx) => {
          const q = String(ctx.params.q ?? "").trim().toLowerCase();
          return !q || p.name.toLowerCase().includes(q) || String(p.room ?? "").toLowerCase().includes(q) || ((p.labels as string[] | undefined) ?? []).some((l) => l.toLowerCase().includes(q));
        },
        group: "room",
        sort: (a, b) => String(a.room ?? "").localeCompare(String(b.room ?? "")) || a.name.localeCompare(b.name),
        display: {
          primary: (p) => p.name,
          secondary: (p, ctx) =>
            p.overdue
              ? ctx.t("thirsty")
              : ctx.t("water {when}", { when: when(p.nextWatering, ctx) }),
          media: "photo",
          badges: ["labels"],
        },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
      },
    },
    {
      // What was done, and when: every plant's care on one rail, newest first.
      id: "care-log",
      title: "Care log",
      icon: "book-open",
      description: "Every watering, feed and repot. Log one on a plant's page, any day.",
      view: {
        type: "timeline",
        entity: "care",
        date: "at",
        groupBy: "week",
        color: "kind",
        display: { primary: "title", secondary: "note", media: "picture" },
        emptyText: "Nothing logged yet. Water a plant and it shows here.",
      },
    },
    {
      // A plant's own page: its photo, what it needs, and Water as the one big button.
      id: "plant",
      title: "Plant",
      hidden: true,
      view: {
        type: "detail",
        entity: "plant",
        param: "plantId",
        // What to do is on the first screen, over the plant's photo; Water is the bar at the bottom.
        cover: "background",
        facts: ["nextText", "rhythm", "sun"],
        primaryAction: "water",
        actions: ["snooze", "logCare"],
        // The chips already say when and how often; the log says when it was last done. So the page is
        // short, and "Soil still wet" is a thumb's reach above Water.
        sections: [
          {
            // The plant's recent history: every watering, feed and repot, newest first.
            title: "Care log",
            related: { entity: "care", via: "plant", view: "timeline", date: "at", display: { primary: "what", secondary: "note", icon: "glyph" }, limit: 5 },
          },
          {
            title: "About",
            fields: ["room", "species", "labels", "tip", "seasonalCare", "feedText", "wiki", "active"],
            collapsed: true,
          },
        ],
      },
    },
  ],

  reminders: [
    {
      id: "water-due",
      entity: "plant",
      when: (p) => (p.active ? p.nextWatering : null),
      // The plant's name is a record, so it is never translated: the app's words go around it.
      title: (p, ctx) =>
        ctx.t("Water {name}", { name: p.name }),
      body: (p, ctx) =>
        p.lastWatered
          ? ctx.t(
              "Last watered {when}",
              { when: ctx.format.relative(p.lastWatered, { unit: "day" }) },
            )
          : ctx.t("Never watered yet"),
    },
    {
      id: "feed-due",
      entity: "plant",
      when: (p, ctx) => nextFeed(p, ctx.now()),
      title: (p, ctx) => ctx.t("Feed {name}", { name: p.name }),
      body: (_p, ctx) => ctx.t("Every four weeks while it grows"),
    },
  ],
});
