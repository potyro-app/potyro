// Ticker: a watchlist of live prices — crypto as it trades on Coinbase, currencies at the ECB's
// reference rate — with the change since yesterday, a sparkline of the last hour, a chart per symbol
// and alerts that ring once when a price crosses a line you set.
//
// Crypto comes over Coinbase Exchange's public WebSocket (wss://ws-feed.exchange.coinbase.com,
// docs/28), many ticks a second, written at most every 3 seconds per symbol (feed.ts). Currencies:
// no public keyless WebSocket exists for them, so the ECB's rates are fetched from Frankfurter every
// 30 minutes — they change once a working day — and the app says so where it shows one.
//
// Every screen is a built-in view, so a friend who opens it from a share link (sealed) gets all of
// it; the demo plays a made-up market through the same path, nothing sent anywhere.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type Resolved, msg } from "potyro";
import { addSymbol, clearDemo, isDemoRunning, liveState, playDemo, removeSymbol, setAlert, stopWatching, wasStartedHere, watchLive } from "./feed.js";
import { COINBASE_REST_HOST, COINBASE_WS_HOST, FX_HOST, toDate } from "./prices.js";
import { agoText, changeText, ECB_NOTE, priceText, STATE_HINTS, STATE_WORDS, type FeedState } from "./words.js";

const ACTIONS = {
  watch: { label: msg("Watch live"), icon: "▶", run: watchLive },
  stop: { label: msg("Stop"), icon: "■", run: stopWatching },
  add: { label: msg("Add"), icon: "＋", run: addSymbol },
  demo: {
    label: msg("Demo"),
    icon: "✨",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("point", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: ctx.t("Demo"),
        items: [
          { id: "play", icon: "✨", label: ctx.t("Play the demo again"), detail: ctx.t("A made-up market, played here. Nothing is sent.") },
          { id: "clear", icon: "🧹", destructive: true, label: ctx.t("Clear the demo") },
        ],
      });
      if (pick === "play") await playDemo(ctx);
      if (pick === "clear") await clearDemo(ctx);
    },
  },
};

const GLYPH: Record<FeedState, string> = { off: "○", connecting: "◌", live: "●", retrying: "↻", paused: "❚❚", offline: "⚠", unreachable: "⚠", denied: "⚠", blocked: "⚠", demo: "✨", "demo-done": "✨" };
const TONE: Partial<Record<FeedState, AggregateRow["tone"]>> = { live: "positive", demo: "positive", offline: "negative", unreachable: "negative", denied: "negative", blocked: "negative" };

function effectiveState(feed: Resolved | undefined): FeedState {
  if (!wasStartedHere()) return "off";
  const recorded = (feed?.state as FeedState | undefined) ?? "off";
  if (recorded === "demo" && !isDemoRunning()) return "demo-done";
  if (recorded !== "demo" && recorded !== "demo-done") return liveState();
  return recorded;
}

function statusRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const state = effectiveState(rows[0]);
  const hint = ctx.t(STATE_HINTS[state]) + (state === "live" ? ctx.t(ECB_NOTE) : "");
  return [{ id: "state", label: `${GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`, detail: hint.trim(), tone: TONE[state] ?? "neutral" }];
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

/**
 * "▼ 0.83% in 24 h" — a currency's change is since the day before, with the ECB's day; a crypto price
 * says how old it is only once it is more than a minute old (a stream that stopped), not while it ticks.
 */
function symbolLine(r: Resolved, ctx: Ctx): string {
  const updated = toDate(r.updated);
  if (typeof r.price !== "number") return ctx.t("No price yet");
  const change = changeText(r.change as number | null, ctx);
  const since = r.kind === "fx" ? ctx.t("since the day before") : ctx.t("in 24 h");
  const stale = updated && Date.now() - updated.getTime() > 60_000;
  const when = updated ? (r.kind === "fx" ? `ECB ${ctx.format.date(updated, { day: "numeric", month: "short" })}` : stale ? agoText(updated, new Date(), ctx) : "") : "";
  return [change ? `${change} ${since}` : "", when].filter(Boolean).join(" · ");
}

const TREND = {
  up: msg("Up"),
  down: msg("Down"),
  flat: msg("Flat"),
};

export default defineApp({
  id: "ticker",
  name: "Ticker",
  icon: "📈",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#0f766e" },
  nav: "tabs",
  permissions: { network: { hosts: [COINBASE_WS_HOST, COINBASE_REST_HOST, FX_HOST] }, notifications: true, haptics: true },
  quickActions: [],
  entities: {
    symbol: {
      // The feed and the app's own actions (Add, Set an alert, Remove) write these; a form never does (docs/03 editableBy).
      editableBy: "app",
      label: "Symbol",
      icon: "📈",
      displayField: "code",
      fields: {
        code: { type: "text", required: true, label: { text: "Symbol", context: "symbol code" } },
        name: { type: "text", label: "Name" },
        kind: {
          type: "enum",
          options: ["crypto", "fx"],
          labels: { crypto: "Crypto · Coinbase", fx: "Currency · ECB" },
          label: "Kind",
        },
        price: { type: "number", label: "Price" },
        base: { type: "number", hidden: true, label: "Compared with" },
        change: { type: "number", label: "Change (%)" },
        trend: { type: "enum", options: ["up", "down", "flat"], colors: { up: "green", down: "red", flat: "grey" }, labels: TREND, label: "Today" },
        spark: { type: "text", label: "Last hour" },
        updated: { type: "datetime", precision: "minute", label: "Updated" },
        above: { type: "number", min: 0, label: "Alert above" },
        below: { type: "number", min: 0, label: "Alert below" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
      computed: {
        shown: {
          value: (r, ctx) => (typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : "–"),
          label: "Now",
        },
        line: { value: (r, ctx) => symbolLine(r, ctx), label: "Change" },
      },
      actions: {
        alert: { label: "Set an alert", description: "Set a price above or below which to be told, once.", run: setAlert },
        remove: { label: "Remove", description: "Take the symbol off the watchlist.", run: removeSymbol },
      },
    },
    point: {
      editableBy: "app",
      label: "Price point",
      displayField: "code",
      fields: {
        code: { type: "text", label: { text: "Symbol", context: "symbol code" } },
        at: { type: "datetime", precision: "minute", label: "At" },
        price: { type: "number", label: "Price" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
    },
    alert: {
      editableBy: "app",
      label: "Alert",
      icon: "🔔",
      displayField: "code",
      fields: {
        code: { type: "text", label: { text: "Symbol", context: "symbol code" } },
        name: { type: "text", label: "Name" },
        direction: { type: "enum", options: ["above", "below"], colors: { above: "green", below: "red" }, labels: { above: "Went above", below: "Dropped below" }, label: "What happened" },
        level: { type: "number", label: "Line" },
        price: { type: "number", label: "Price then" },
        at: { type: "datetime", precision: "minute", label: "When" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
    },
    feed: {
      editableBy: "app",
      label: "Feed",
      displayField: "state",
      fields: {
        state: { type: "text", label: "State" },
        since: { type: "datetime", precision: "minute", label: "Since" },
        fxOk: { type: "boolean", label: "Currencies fetched" },
      },
    },
  },
  pages: [
    {
      id: "watchlist",
      title: "Watchlist",
      icon: "📈",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.add, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "symbol",
              sort: (a, b) => (a.kind === b.kind ? String(a.code).localeCompare(String(b.code)) : a.kind === "crypto" ? -1 : 1),
              display: {
                primary: (r, ctx) => `${String(r.code)}   ${typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : "–"}`,
                secondary: (r, ctx) => [String(r.spark ?? ""), symbolLine(r, ctx)].filter(Boolean).join("  "),
                badges: ["trend"],
              },
              group: "kind",
              emptyText: "Nothing on the watchlist. “Watch live” starts with Bitcoin, Ether and the euro in dollars; “Add” picks others.",
              onOpen: { page: "symbol", param: { symbolId: "id", code: "code" } },
            },
          },
        ],
      },
    },
    {
      id: "alerts",
      title: "Alerts",
      icon: "🔔",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "symbol",
              title: "Waiting",
              rows: (rows, ctx) =>
                rows
                  .filter((r) => typeof r.above === "number" || typeof r.below === "number")
                  .map((r) => ({
                    id: String(r.id),
                    label: String(r.code),
                    value: typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : undefined,
                    detail: [
                      typeof r.above === "number" ? ctx.t("above {p}", { p: priceText(r.above, String(r.code), ctx) }) : "",
                      typeof r.below === "number" ? ctx.t("below {p}", { p: priceText(r.below, String(r.code), ctx) }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  })),
              emptyText: "No alerts waiting. Open a symbol on the watchlist and tap “Set an alert”.",
            },
          },
          {
            title: "Rang",
            view: {
              type: "list",
              entity: "alert",
              sort: (a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0),
              display: {
                primary: (r, ctx) => `${String(r.code)} · ${priceText(Number(r.level), String(r.code), ctx)}`,
                secondary: (r, ctx) => {
                  const t = toDate(r.at);
                  return [t ? ctx.format.date(t, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "", ctx.t("at {p}", { p: priceText(Number(r.price), String(r.code), ctx) })].filter(Boolean).join(" · ");
                },
                badges: ["direction"],
              },
              emptyText: "Alerts that rang show here.",
            },
          },
        ],
      },
    },
    {
      id: "symbol",
      title: "Symbol",
      hidden: true,
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "detail",
              entity: "symbol",
              param: "symbolId",
              actions: ["alert", "remove"],
              sections: [{ fields: ["shown", "line", "name", "kind"] }, { title: "Alerts", fields: ["above", "below"] }],
            },
          },
          {
            view: {
              type: "chart",
              entity: "point",
              filter: (r, ctx) => r.code === ctx.params.code,
              title: "Above the low",
              subtitle: "How far each minute's price stood above the lowest shown — a working day a bar for a currency",
              series: (rows, ctx) => {
                const sorted = [...rows].sort((a, b) => (toDate(a.at)?.getTime() ?? 0) - (toDate(b.at)?.getTime() ?? 0)).slice(-40);
                // Bars from the series' own low — a 0.3 % move is visible, not forty equal bars — and
                // the chart says so: its axis is the distance above that low, in the price's currency.
                const floor = Math.min(...sorted.map((r) => Number(r.price)));
                return sorted.map((r, i) => {
                  const at = toDate(r.at);
                  const code = String(r.code);
                  return {
                    label: i % 8 === 0 && at ? ctx.format.date(at, code.includes("/") ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" }) : "",
                    value: Number(r.price) - floor,
                    text: priceText(Number(r.price), code, ctx),
                  };
                });
              },
              emptyText: "No prices yet: “Watch live” or “Demo”.",
            },
          },
        ],
      },
    },
  ],
});
