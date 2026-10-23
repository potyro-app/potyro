// Earthquakes, live: every earthquake EMSC reports, on a map the moment it is reported, with the
// strongest of the last day, the ones near you, and an alert when a strong one is close.
//
// The feed is EMSC's public WebSocket (wss://www.seismicportal.eu/standing_order/websocket, docs/28);
// the last day is filled in from EMSC's catalogue when it starts. Data: EMSC, CC BY 4.0.
//
// Every screen is a built-in view, on purpose: a friend who opens this from a share link runs it
// sealed — its connections only to the host it declares, after one question — and a sealed app's
// custom views do not render. The status line at the top of the map and the list is an aggregate
// view over one `feed` record the app keeps up to date.
//
// The demo plays real earlier earthquakes through the same path on this device: no network, no
// question, so a share-link demo and the tests work without EMSC.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type FilterChip, type Resolved, msg } from "potyro";
import { alertSettings, clearDemo, editAlerts, isDemoRunning, liveState, playDemo, quakeLine, stopWatching, wasStartedHere, watchLive, type FeedState } from "./feed.js";
import { distanceKm, EMSC_HOST, strength, STRENGTH_COLOURS, STRENGTHS, toDate } from "./quakes.js";
import { agoText, awayText, magText, STATE_HINTS, STATE_WORDS, STRENGTH_WORDS } from "./words.js";

const DAY_MS = 86_400_000;

const FILTERS: FilterChip[] = [
  { label: msg("From magnitude"), param: "min", type: "number", placeholder: msg("Magnitude from…") },
  { label: msg("Last 24 h"), param: "day", type: "boolean" },
];

/** The chips: at least this strong, and (when ticked) in the last day. */
function chipFilter(r: Resolved, ctx: Ctx): boolean {
  const { min, day } = ctx.params as { min?: number; day?: boolean };
  if (typeof min === "number" && Number(r.mag) < min) return false;
  if (day && ctx.now().getTime() - (toDate(r.time)?.getTime() ?? 0) > DAY_MS) return false;
  return true;
}

const byTime = (a: Resolved, b: Resolved) => (toDate(b.time)?.getTime() ?? 0) - (toDate(a.time)?.getTime() ?? 0);

const ACTIONS = {
  watch: { label: msg("Watch live"), icon: "play", run: watchLive },
  stop: { label: msg("Stop"), icon: "square", run: stopWatching },
  demo: {
    label: msg("Demo"),
    icon: "sparkles",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("quake", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: ctx.t("Demo"),
        items: [
          { id: "play", icon: "sparkles", label: ctx.t("Play the demo again"), detail: ctx.t("Real earthquakes from earlier, replayed here. Nothing is sent.") },
          { id: "clear", icon: "brush-cleaning", destructive: true, label: ctx.t("Clear the demo") },
        ],
      });
      if (pick === "play") await playDemo(ctx);
      if (pick === "clear") await clearDemo(ctx);
    },
  },
};

const STATE_GLYPH: Record<FeedState, string> = {
  off: "○",
  connecting: "◌",
  live: "●",
  retrying: "↻",
  paused: "❚❚",
  offline: "⚠",
  unreachable: "⚠",
  denied: "⚠",
  blocked: "⚠",
  demo: "✨",
  "demo-done": "✨",
};
const TONE: Partial<Record<FeedState, AggregateRow["tone"]>> = { live: "positive", demo: "positive", offline: "negative", unreachable: "negative", denied: "negative", blocked: "negative" };

/** What the feed is doing, read from its record — but a fresh copy of the app has started nothing. */
function effectiveState(feed: Resolved | undefined): FeedState {
  if (!wasStartedHere()) return "off";
  const recorded = (feed?.state as FeedState | undefined) ?? "off";
  if (recorded === "demo" && !isDemoRunning()) return "demo-done";
  if (recorded !== "demo" && recorded !== "demo-done") return liveState();
  return recorded;
}

/** The status line: the feed, the latest quake, and the alert. */
async function statusRows(rows: Resolved[], ctx: Ctx): Promise<AggregateRow[]> {
  const feed = rows[0];
  const state = effectiveState(feed);
  const n = Number(feed?.count ?? 0);
  const out: AggregateRow[] = [
    {
      id: "state",
      label: `${STATE_GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`,
      detail: ctx.t(STATE_HINTS[state]),
      value: (state === "live" || state === "demo") && n > 0 ? ctx.t("{n} new", { n }) : undefined,
      tone: TONE[state] ?? "neutral",
    },
  ];
  const lastAt = toDate(feed?.lastAt);
  if (feed?.lastPlace && lastAt && state !== "off") {
    out.push({
      id: "latest",
      label: ctx.t("Latest: {place}", { place: String(feed.lastPlace) }),
      detail: agoText(lastAt, new Date(), ctx),
      value: magText(Number(feed.lastMag), ctx),
    });
  }
  const alerts = await alertSettings(ctx);
  out.push({
    id: "alerts",
    label: ctx.t("Alerts near you"),
    detail: ctx.t("Change them under Near me."),
    value: alerts.on && alerts.home ? `${magText(alerts.above, ctx)}+ · ${ctx.format.number(alerts.withinKm)} km` : ctx.t("Off"),
  });
  return out;
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

const QUAKE_DISPLAY = {
  // The magnitude first: it is what a glance down the list is for.
  primary: (r: Resolved, ctx: Ctx) => `${magText(Number(r.mag), ctx)} · ${String(r.place)}`,
  secondary: (r: Resolved, ctx: Ctx) => quakeLine(r, ctx),
  badges: ["strength"],
};

const EMPTY = msg("No earthquakes here yet. Tap “Watch live” to follow EMSC's feed — the last day is filled in first — or “Demo” to see how it looks without connecting.");

export default defineApp({
  id: "earthquakes",
  name: "Earthquakes",
  icon: "globe",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#c2410c" },
  nav: "tabs",
  // The feed and the catalogue are one host. Location and notifications only for the near-me alert.
  permissions: { network: { hosts: [EMSC_HOST] }, geo: true, notifications: true, haptics: true },
  // A demo link opens with the replay already playing (docs/04 §Demo): the same as the Demo button.
  demo: playDemo,
  quickActions: [],
  entities: {
    quake: {
      // Only the feed writes these: no Add, Edit or Delete for people (docs/03 editableBy).
      editableBy: "app",
      label: "Earthquake",
      icon: "globe",
      displayField: "place",
      fields: {
        place: { type: "text", required: true, label: "Where" },
        mag: { type: "number", required: true, step: 0.1, label: "Magnitude" },
        // Stored rather than computed so that it can wear its colour on a badge and group a list.
        strength: {
          type: "enum",
          options: [...STRENGTHS],
          colors: { major: "purple", strong: "red", moderate: "orange", light: "yellow", minor: "grey" },
          labels: STRENGTH_WORDS,
          label: "Strength",
        },
        magType: { type: "text", label: "Magnitude scale" },
        depth: { type: "number", unit: "km", label: "Depth" },
        time: { type: "datetime", precision: "minute", required: true, label: "When" },
        updated: { type: "datetime", precision: "minute", hidden: true, label: "Revised" },
        where: { type: "geo", label: "On the map" },
        authority: { type: "text", label: "Located by" },
        link: { type: "url", label: "On EMSC" },
        uid: { type: "text", hidden: true, label: "EMSC id" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
      computed: {
        ago: {
          value: (r, ctx) => {
            const t = toDate(r.time);
            return t ? agoText(t, ctx.now(), ctx) : "";
          },
          label: "How long ago",
        },
      },
    },
    feed: {
      editableBy: "app",
      label: "Feed",
      displayField: "state",
      fields: {
        state: { type: "text", label: "State" },
        since: { type: "datetime", precision: "minute", label: "Since" },
        count: { type: "number", integer: true, label: "New" },
        lastPlace: { type: "text", label: "Latest" },
        lastMag: { type: "number", label: "Latest magnitude" },
        lastAt: { type: "datetime", precision: "minute", label: "Latest at" },
      },
    },
  },
  pages: [
    {
      id: "live",
      title: "Map",
      icon: "map",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "map",
              entity: "quake",
              geo: "where",
              title: (r, ctx) => `${magText(Number(r.mag), ctx)} · ${String(r.place)}`,
              color: (r) => STRENGTH_COLOURS[strength(Number(r.mag))],
              display: QUAKE_DISPLAY,
              filters: FILTERS,
              filter: chipFilter,
              // The whole Pacific ring of fire and the Mediterranean in one view; the person pans from there.
              camera: { center: [160, 22], zoom: 1.1 },
              locate: false,
              onOpen: { page: "quake", param: { quakeId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "latest",
      title: { text: "Latest", context: "title" },
      icon: "timer",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "quake",
              filters: FILTERS,
              filter: chipFilter,
              sort: byTime,
              display: QUAKE_DISPLAY,
              emptyText: EMPTY,
              onOpen: { page: "quake", param: { quakeId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "strongest",
      title: "Strongest",
      icon: "trending-up",
      summary: [
        { label: "In the last 24 h", op: "count" },
        {
          label: { text: "Strongest", context: "label" },
          value: (rows, ctx) => (rows.length ? magText(Math.max(...rows.map((r) => Number(r.mag))), ctx) : null),
        },
        {
          label: "Magnitude 5 and up",
          value: (rows) => rows.filter((r) => Number(r.mag) >= 5).length,
        },
      ],
      view: {
        type: "list",
        entity: "quake",
        filter: (r, ctx) => ctx.now().getTime() - (toDate(r.time)?.getTime() ?? 0) <= DAY_MS,
        sort: (a, b) => Number(b.mag) - Number(a.mag) || byTime(a, b),
        display: QUAKE_DISPLAY,
        group: "strength",
        emptyText: "Nothing in the last 24 hours yet. “Watch live” on the map fills the last day in.",
        onOpen: { page: "quake", param: { quakeId: "id" } },
      },
    },
    {
      id: "near",
      title: "Near me",
      icon: "map-pin",
      actions: [{ label: "Alerts…", icon: "bell", run: editAlerts }],
      view: {
        type: "list",
        entity: "quake",
        filters: [
          { label: "Where I am", param: "me", type: "geo" },
          { label: "Within km", param: "km", type: "number", placeholder: "Within km (1000)" },
        ],
        filter: (r, ctx) => {
          const me = ctx.params.me as { lat: number; lng: number } | undefined;
          const where = r.where as { lat: number; lng: number } | undefined;
          if (!me || !where) return false;
          const km = typeof ctx.params.km === "number" ? ctx.params.km : 1000;
          return distanceKm(where, me) <= km;
        },
        sort: byTime,
        display: {
          primary: "place",
          secondary: (r, ctx) => {
            const me = ctx.params.me as { lat: number; lng: number } | undefined;
            const where = r.where as { lat: number; lng: number } | undefined;
            return [quakeLine(r, ctx), me && where ? awayText(distanceKm(where, me), ctx) : ""].filter(Boolean).join(" · ");
          },
          badges: ["strength"],
        },
        emptyText: (ctx) =>
          ctx.params.me
            ? ctx.t("No earthquakes on this device that close. Widen “Within km”, or set an alert for the next one.")
            : ctx.t("Tap “Where I am” to see the earthquakes near you, nearest first in time. “Alerts…” tells you about a strong one close by while the app is open."),
        onOpen: { page: "quake", param: { quakeId: "id" } },
      },
    },
    {
      id: "quake",
      title: "Earthquake",
      hidden: true,
      view: {
        type: "detail",
        entity: "quake",
        param: "quakeId",
        sections: [
          { fields: ["strength", "mag", "ago", "time", "depth"] },
          { title: "Source", fields: ["authority", "magType", "link"] },
        ],
      },
    },
  ],
});
