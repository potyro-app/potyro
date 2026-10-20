// Word Watch: pick a few words, and every public Bluesky post that mentions one of them arrives as it
// is written — who wrote it, what it says, a tap away from the post itself on bsky.app — with how
// often each word comes up, minute by minute.
//
// The stream is Bluesky's public Jetstream (wss://jetstream2.us-east.bsky.network/subscribe, docs/28),
// every new post on the network; the app looks for your words on this device and keeps only the posts
// that have them (feed.ts, watch.ts). Handles come from Bluesky's public AppView. Text only: no images,
// no links followed, and posts their authors marked adult are left out.
//
// Every screen is a built-in view, so a friend who opens it from a share link (sealed) gets all of
// it; the demo plays invented posts through the same matcher with nothing sent anywhere.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type Resolved, msg } from "potyro";
import { addWord, clearDemo, isDemoRunning, liveState, playDemo, removeWord, stopWatching, toggleWord, wasStartedHere, watchLive, wordMinutes } from "./feed.js";
import { JETSTREAM_HOST, PROFILE_HOST, sparkline, toDate } from "./watch.js";
import { agoText, lastHourText, perMinuteText, STATE_HINTS, STATE_WORDS, type FeedState } from "./words.js";

const ACTIONS = {
  watch: { label: msg("Watch live"), icon: "▶", run: watchLive },
  stop: { label: msg("Stop"), icon: "■", run: stopWatching },
  demo: {
    label: msg("Demo"),
    icon: "✨",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("post", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: ctx.t("Demo"),
        items: [
          { id: "play", icon: "✨", label: ctx.t("Play the demo again"), detail: ctx.t("Invented posts, played here. Nothing is sent.") },
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

/** The status line: what the stream is doing, how many matched, the last match. */
function statusRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const feed = rows[0];
  const state = effectiveState(feed);
  const n = Number(feed?.count ?? 0);
  const out: AggregateRow[] = [
    {
      id: "state",
      label: `${GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`,
      detail: ctx.t(STATE_HINTS[state]),
      value:
        (state === "live" || state === "demo") && n > 0
          ? ctx.t("{n, plural, one {# match} other {# matches}}", { n })
          : undefined,
      tone: TONE[state] ?? "neutral",
    },
  ];
  return out;
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

/** Each word: how often right now, a sparkline of the last 15 minutes, the last hour. */
function perWordRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const now = new Date();
  const words = [...new Set(rows.map((r) => String(r.wordId)))];
  return words
    .map((id) => {
      const word = String(rows.find((r) => r.wordId === id)?.word ?? "");
      const last15 = wordMinutes(rows, id, now, 15);
      const hour = wordMinutes(rows, id, now, 60).reduce((a, b) => a + b, 0);
      // The minute that is still going is not a fair "a minute": the last whole one is.
      const rate = last15.at(-2) ?? 0;
      return { id, word, hour, row: { id, label: `“${word}”`, value: perMinuteText(rate, ctx), detail: `${sparkline(last15)}  ${lastHourText(hour, ctx)}` } satisfies AggregateRow };
    })
    .sort((a, b) => b.hour - a.hour)
    .map((x) => x.row);
}

const EMPTY_POSTS = msg("Posts that mention your words land here as they are written. Add words under Words, then “Watch live” — or try “Demo”.");

const byAt = (a: Resolved, b: Resolved) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0);

export default defineApp({
  id: "word-watch",
  name: "Word Watch",
  icon: "🦋",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#1d6fe0" },
  nav: "tabs",
  permissions: { network: { hosts: [JETSTREAM_HOST, PROFILE_HOST] } },
  // A demo link opens with the replay already playing (docs/04 §Demo): the same as the Demo button.
  demo: playDemo,
  quickActions: [],
  entities: {
    word: {
      label: "Word",
      icon: "🔤",
      displayField: "word",
      fields: {
        word: { type: "text", required: true, label: "Word or phrase", placeholder: "coffee" },
        on: { type: "boolean", default: true, label: "Watching" },
        total: { type: "number", integer: true, default: 0, label: "Mentions so far" },
        lastAt: { type: "datetime", precision: "minute", label: "Last seen" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
      actions: {
        toggle: {
          label: "Pause or watch again",
          description: "Pause watching this word, or watch it again.",
          run: toggleWord,
        },
        remove: {
          label: "Stop watching",
          description: "Remove the word and its counts.",
          run: removeWord,
        },
      },
    },
    post: {
      // Only the feed writes these: no Add, Edit or Delete for people (docs/03 editableBy).
      editableBy: "app",
      label: "Post",
      icon: "💬",
      displayField: "text",
      fields: {
        text: { type: "text", multiline: true, required: true, label: "Post" },
        handle: { type: "text", label: "By" },
        words: { type: "tags", label: "Mentions" },
        at: { type: "datetime", precision: "minute", label: "Seen" },
        link: { type: "url", label: "On Bluesky" },
        did: { type: "text", hidden: true, label: "Author's id" },
        demo: { type: "boolean", hidden: true, label: "Demo" },
      },
      computed: {
        ago: {
          value: (r, ctx) => {
            const t = toDate(r.at);
            return t ? agoText(t, ctx.now(), ctx) : "";
          },
          label: "When",
        },
      },
    },
    minute: {
      editableBy: "app",
      label: "Minute",
      displayField: "word",
      fields: {
        word: { type: "text", label: "Word" },
        wordId: { type: "text", hidden: true, label: "Word id" },
        at: { type: "datetime", precision: "minute", label: "Minute" },
        count: { type: "number", integer: true, label: { text: "Mentions", context: "minute count" } },
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
        count: { type: "number", integer: true, label: "Matches" },
        lastText: { type: "text", label: "Latest" },
        lastWord: { type: "text", label: "Latest word" },
      },
    },
  },
  pages: [
    {
      id: "live",
      title: "Live",
      icon: "📡",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "post",
              sort: byAt,
              display: {
                primary: (r) => `@${String(r.handle ?? "")}`,
                secondary: (r, ctx) => {
                  const t = toDate(r.at);
                  return `${t ? agoText(t, ctx.now(), ctx) : ""} — ${String(r.text ?? "")}`;
                },
                badges: ["words"],
              },
              emptyText: EMPTY_POSTS,
              onOpen: { page: "post", param: { postId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "trend",
      title: "Per minute",
      icon: "📊",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "minute",
              title: "Right now",
              rows: perWordRows,
              emptyText: "No mentions counted yet.",
            },
          },
          {
            view: {
              type: "chart",
              entity: "minute",
              title: "Mentions per minute",
              subtitle: "All your words, last 30 minutes",
              series: (rows, ctx) => {
                const now = new Date();
                const ids = [...new Set(rows.map((r) => String(r.wordId)))];
                const sums = Array.from({ length: 30 }, (_, i) => ids.reduce((a, id) => a + (wordMinutes(rows, id, now, 30)[i] ?? 0), 0));
                return sums.map((value, i) => {
                  const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - (29 - i) * 60_000);
                  return { label: i % 5 === 4 ? ctx.format.date(at, { hour: "2-digit", minute: "2-digit" }) : "", value, text: ctx.t("{n} at {time}", { n: value, time: ctx.format.date(at, { hour: "2-digit", minute: "2-digit" }) }) };
                });
              },
              emptyText: "The bars fill in minute by minute once you watch live.",
            },
          },
        ],
      },
    },
    {
      id: "words",
      title: "Words",
      icon: "🔤",
      actions: [{ label: "Add a word", icon: "＋", run: addWord }],
      view: {
        type: "list",
        entity: "word",
        sort: (a, b) => Number(b.on !== false) - Number(a.on !== false) || Number(b.total ?? 0) - Number(a.total ?? 0),
        display: {
          primary: (r) => `“${String(r.word ?? "")}”`,
          secondary: (r, ctx) => {
            const t = toDate(r.lastAt);
            const n = Number(r.total ?? 0);
            const seen = ctx.t("{n, plural, one {# mention} other {# mentions}}", { n });
            const paused = r.on === false ? ctx.t("paused") : "";
            return [seen, t ? ctx.t("seen {ago}", { ago: agoText(t, ctx.now(), ctx) }) : "", paused].filter(Boolean).join(" · ");
          },
        },
        emptyText: "Tap “Add a word” — “coffee”, “#rain”, a team, a town. Posts that mention any of them are kept; everything else streams past.",
        onOpen: { page: "word", param: { wordId: "id" } },
      },
    },
    {
      id: "post",
      title: "Post",
      hidden: true,
      view: {
        type: "detail",
        entity: "post",
        param: "postId",
        sections: [{ fields: ["text", "handle", "words", "ago"] }, { fields: ["link"] }],
      },
    },
    {
      id: "word",
      title: "Word",
      hidden: true,
      view: { type: "detail", entity: "word", param: "wordId", actions: ["toggle", "remove"], sections: [{ fields: ["word", "on", "total", "lastAt"] }] },
    },
  ],
});
