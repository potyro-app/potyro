// The live side of the app: the connection to EMSC, the quakes it brings becoming records, the last
// day filled in when it starts, the near-me alert, the store kept small, the status line — and the
// demo, which plays real earlier events through the very same path with nothing sent anywhere.
//
// State lives at module level (docs/28 §1): the connection outlives the action that opened it. A
// sealed copy runs this in its box; its views are all built-in, so they render there too.

import type { Ctx, Resolved } from "potyro";
import { DEMO_BACKLOG, DEMO_LIVE, demoMessage } from "./demo.js";
import { createLive, type LiveState } from "./live.js";
import { EMSC_SOCKET, eventUrl, readCollection, readMessage, recentUrl, shouldAlert, distanceKm, strength, toDate, toPrune, KEEP_DAYS, type Quake } from "./quakes.js";
import { alertTitle, agoText, depthText, magText } from "./words.js";

export type FeedState = LiveState | "demo" | "demo-done";

export interface AlertSettings {
  on: boolean;
  /** Alert for this magnitude and up. */
  above: number;
  withinKm: number;
  home: { lat: number; lng: number } | null;
}

export const DEFAULT_ALERTS: AlertSettings = { on: false, above: 4.5, withinKm: 300, home: null };
export const ALERTS_KEY = "alerts";

/** Filled in at start when nothing newer than this is on the device. */
const BACKFILL_HOURS = 24;
const BACKFILL_MIN_MAG = 3;
/** Prune after this many new records. */
const PRUNE_EVERY = 40;

// ------------------------------------------------------------------ module state

/** uid → record id, so an "update" patches the quake it is about rather than adding a second one. */
const known = new Map<string, string>();
let loaded = false;
let feedId: string | null = null;
let seen = 0;
let sinceStart = 0;
let alerts: AlertSettings = DEFAULT_ALERTS;
let demoTimer: unknown = null;
let demoRunning = false;
/** Whether this copy of the module started anything: a fresh one says "not live", whatever the record says. */
let startedHere = false;

/** One message at a time: an "update" right behind its "create" must find the record the create made. */
let chain: Promise<void> = Promise.resolve();
const inTurn = (fn: () => Promise<void>): Promise<void> => (chain = chain.then(fn, fn));

const live = createLive({
  url: EMSC_SOCKET,
  onText: (text, ctx) => void inTurn(() => take(text, ctx, false)),
  onState: (state, ctx) => void setState(ctx, state),
});

export const liveState = (): LiveState => live.state;
export const isDemoRunning = (): boolean => demoRunning;
export const wasStartedHere = (): boolean => startedHere;

// ------------------------------------------------------------------ records

async function load(ctx: Ctx): Promise<void> {
  if (loaded) return;
  const rows = await ctx.query("quake");
  for (const r of rows) if (typeof r.uid === "string") known.set(r.uid, String(r.id));
  const feeds = await ctx.query("feed");
  feedId = feeds[0] ? String(feeds[0].id) : null;
  alerts = { ...DEFAULT_ALERTS, ...((await ctx.storage.get<AlertSettings>(ALERTS_KEY)) ?? {}) };
  loaded = true;
}

/** The status record every page's status line reads; one per app. */
async function setState(ctx: Ctx, state: FeedState, extra: Record<string, unknown> = {}): Promise<void> {
  const data = { state, since: new Date(), count: sinceStart, ...extra };
  try {
    if (feedId) await ctx.patch("feed", feedId, data);
    else feedId = String((await ctx.create("feed", data)).id);
  } catch {
    // The app was closed under it: nothing to say to anyone.
  }
}

const quakeData = (q: Quake, demo: boolean) => ({
  uid: q.uid,
  place: q.place,
  mag: q.mag,
  strength: strength(q.mag),
  magType: q.magType,
  depth: q.depth,
  time: q.time,
  updated: q.updated,
  where: { lat: q.lat, lng: q.lng },
  authority: q.authority,
  link: eventUrl(q.uid.replace(/^demo-/, "")),
  demo,
});

/** Save one quake (new, or a revision of one already here). Returns whether it is new. */
async function save(ctx: Ctx, q: Quake, demo: boolean): Promise<boolean> {
  const id = known.get(q.uid);
  if (id) {
    await ctx.patch("quake", id, quakeData(q, demo));
    return false;
  }
  const r = await ctx.create("quake", quakeData(q, demo));
  known.set(q.uid, String(r.id));
  seen++;
  return true;
}

/** One message from the feed (or the demo): saved, counted, alerted on. */
async function take(text: string, ctx: Ctx, demo: boolean): Promise<void> {
  const msg = readMessage(text);
  if (!msg) return;
  // EMSC also sends events it has only now catalogued from weeks ago: older than what is kept, they
  // would be pruned again at once.
  if (Date.now() - msg.quake.time.getTime() > KEEP_DAYS * 86_400_000) return;
  await load(ctx);
  let fresh: boolean;
  try {
    fresh = await save(ctx, msg.quake, demo);
  } catch {
    return; // the app was closed under it
  }
  if (!fresh) return;
  sinceStart++;
  await setState(ctx, demo ? "demo" : live.state === "live" ? "live" : live.state, {
    lastPlace: msg.quake.place,
    lastMag: msg.quake.mag,
    lastAt: msg.quake.time,
  });
  await maybeAlert(ctx, msg.quake);
  if (seen >= PRUNE_EVERY) await prune(ctx);
}

async function maybeAlert(ctx: Ctx, q: Quake): Promise<void> {
  if (!alerts.on || !shouldAlert(q, alerts.home, { above: alerts.above, withinKm: alerts.withinKm, now: new Date() })) return;
  const title = alertTitle(q.mag, distanceKm(q, alerts.home!), ctx);
  const body = `${q.place} · ${depthText(q.depth, ctx)}`;
  const n = ctx.caps.notifications;
  try {
    // On a phone a real notification; the web has none to send, so it is said on screen.
    if (n) await n.schedule({ id: `quake-${q.uid}`, at: new Date(Date.now() + 1000), title, body });
    else ctx.ui.toast(`${title} — ${body}`);
    await ctx.caps.haptics?.vibrate([200, 100, 200]);
  } catch {
    ctx.ui.toast(`${title} — ${body}`);
  }
}

/** Keep the last 7 days and at most 1,500 quakes; the oldest go first. */
export async function prune(ctx: Ctx): Promise<number> {
  seen = 0;
  const rows = await ctx.query("quake");
  const gone = toPrune(
    rows.map((r) => ({ id: String(r.id), time: toDate(r.time), uid: r.uid })),
    new Date(),
  );
  const uids = new Map(rows.map((r) => [String(r.id), String(r.uid ?? "")]));
  for (const id of gone) {
    try {
      await ctx.delete("quake", id);
    } catch {
      // already gone
    }
    known.delete(uids.get(id) ?? "");
  }
  return gone.length;
}

/** The last day, when nothing that recent is here: one request to EMSC's catalogue. */
async function backfill(ctx: Ctx): Promise<void> {
  const now = Date.now();
  const rows = await ctx.query("quake", { filter: (r) => !r.demo });
  const newest = Math.max(0, ...rows.map((r) => toDate(r.time)?.getTime() ?? 0));
  if (now - newest < 30 * 60_000) return;
  const fetch = ctx.caps.network?.fetch;
  if (!fetch) return;
  let quakes: Quake[];
  try {
    const res = await fetch(recentUrl(new Date(now - BACKFILL_HOURS * 3_600_000), BACKFILL_MIN_MAG));
    if (!res.ok) return;
    quakes = readCollection(await res.json());
  } catch {
    return; // the live feed still works; the last day just is not filled in
  }
  for (const q of quakes.reverse()) {
    try {
      await save(ctx, q, false);
    } catch {
      return;
    }
  }
}

// ------------------------------------------------------------------ what the buttons do

/**
 * The work a button starts. A shared copy's box gives each call about a second (the realm's
 * watchdog), and filling in a day or a demo can take longer than that — so a button starts the work
 * and returns at once; the work goes on, one job after another, and says how it is going on the status
 * line.
 */
let busy: Promise<void> = Promise.resolve();
function inBackground(ctx: Ctx, work: () => Promise<void>): void {
  busy = busy.then(work).catch((e: unknown) => ctx.log("earthquakes: a job failed", e instanceof Error ? e.message : String(e)));
}
/** For tests: when the work started so far is done. */
export const idle = (): Promise<void> => busy;

export async function watchLive(ctx: Ctx): Promise<void> {
  stopDemo();
  startedHere = true;
  if (live.state === "live" || live.state === "connecting") {
    ctx.ui.toast(ctx.t("Already live."));
    return;
  }
  inBackground(ctx, async () => {
    await load(ctx);
    sinceStart = 0;
    await setState(ctx, "connecting");
    // Real quakes only from here: the demo's would read as real ones in the list.
    await dropDemo(ctx);
    await backfill(ctx);
    live.start(ctx);
  });
}

export async function stopWatching(ctx: Ctx): Promise<void> {
  startedHere = true;
  stopDemo();
  live.stop();
  await setState(ctx, "off");
}

function stopDemo(): void {
  if (demoTimer !== null && typeof clearTimeout === "function") clearTimeout(demoTimer as ReturnType<typeof setTimeout>);
  demoTimer = null;
  demoRunning = false;
}

/** How long between the demo's "live" quakes. */
export const DEMO_STEP_MS = 2500;

/**
 * The demo: a day of real earthquakes from earlier, moved to the last 24 hours, then a few more
 * arriving one by one as if live — through `take`, the same path the feed's messages take.
 */
export async function playDemo(ctx: Ctx): Promise<void> {
  live.stop();
  stopDemo();
  startedHere = true;
  demoRunning = true;
  inBackground(ctx, () => demo(ctx));
}

async function demo(ctx: Ctx): Promise<void> {
  await load(ctx);
  sinceStart = 0;
  const now = Date.now();
  await setState(ctx, "demo");
  for (const ev of DEMO_BACKLOG) await inTurn(() => take(demoMessage(ev, now), ctx, true));
  const queue = [...DEMO_LIVE];
  const next = async (): Promise<void> => {
    const ev = queue.shift();
    if (!ev || !demoRunning) {
      if (demoRunning) await setState(ctx, "demo-done");
      demoRunning = false;
      demoTimer = null;
      return;
    }
    await inTurn(() => take(demoMessage({ ...ev, minutesAgo: 0 }, Date.now()), ctx, true));
    schedule();
  };
  const schedule = (): void => {
    if (typeof setTimeout !== "function") return void next();
    demoTimer = setTimeout(() => void next(), DEMO_STEP_MS);
  };
  schedule();
}

export async function clearDemo(ctx: Ctx): Promise<void> {
  stopDemo();
  inBackground(ctx, () => clearing(ctx));
}

/** Delete the demo's quakes; how many. */
async function dropDemo(ctx: Ctx): Promise<number> {
  const rows = await ctx.query("quake", { filter: (r) => r.demo === true });
  for (const r of rows) {
    await ctx.delete("quake", String(r.id));
    known.delete(String(r.uid ?? ""));
  }
  return rows.length;
}

async function clearing(ctx: Ctx): Promise<void> {
  await load(ctx);
  const rows = { length: await dropDemo(ctx) };
  await setState(ctx, live.state === "live" ? "live" : "off");
  ctx.ui.toast(
    ctx.t(
      "{n, plural, one {# sample quake removed.} other {# sample quakes removed.}}",
      { n: rows.length },
    ),
  );
}

/** Alerts near me: on or off, how strong, how far — and where "me" is, asked once from the device. */
export async function editAlerts(ctx: Ctx): Promise<void> {
  alerts = await alertSettings(ctx);
  const answer = await ctx.ui.form<{ on: boolean; above: number; withinKm: number }>({
    title: ctx.t("Alerts near you"),
    fields: {
      on: { type: "boolean", label: ctx.t("Tell me about strong earthquakes near me") },
      above: { type: "number", min: 2, max: 9, step: 0.5, required: true, label: ctx.t("From magnitude") },
      withinKm: { type: "number", integer: true, min: 10, max: 5000, step: 50, required: true, unit: "km", label: ctx.t("Within") },
    },
    initial: { on: alerts.on || !alerts.home, above: alerts.above, withinKm: alerts.withinKm },
    submit: ctx.t("Save"),
  });
  if (!answer) return;
  // Finding where the device is can take a few seconds: past what a button may hold a sealed box.
  inBackground(ctx, () => saveAlerts(ctx, answer));
}

async function saveAlerts(ctx: Ctx, answer: { on: boolean; above: number; withinKm: number }): Promise<void> {
  let home = alerts.home;
  if (answer.on) {
    try {
      const geo = ctx.caps.geo;
      if (!geo) throw new Error("no location here");
      home = await geo.current();
    } catch {
      if (!home) {
        ctx.ui.toast(ctx.t("Alerts need to know where you are; your location wasn't available."));
        return;
      }
    }
  }
  alerts = { on: Boolean(answer.on), above: Number(answer.above), withinKm: Number(answer.withinKm), home };
  await ctx.storage.set(ALERTS_KEY, alerts);
  // The status line shows the alert setting: touch the record it reads.
  await setState(ctx, demoRunning ? "demo" : live.state);
  ctx.ui.toast(
    alerts.on
      ? ctx.t("Alerts on: {mag} and up within {km} km, while the app is open.", { mag: magText(alerts.above, ctx), km: ctx.format.number(alerts.withinKm) })
      : ctx.t("Alerts off."),
  );
}

export async function alertSettings(ctx: Ctx): Promise<AlertSettings> {
  return { ...DEFAULT_ALERTS, ...((await ctx.storage.get<AlertSettings>(ALERTS_KEY)) ?? {}) };
}

/** "4 min ago · 8 km deep" — a quake's second line (the magnitude leads the first). */
export function quakeLine(r: Resolved, ctx: Ctx): string {
  const time = toDate(r.time);
  return [time ? agoText(time, ctx.now(), ctx) : "", depthText(Number(r.depth), ctx)].filter(Boolean).join(" · ");
}

/** For tests: forget everything this module holds. */
export function resetForTests(): void {
  live.stop();
  stopDemo();
  known.clear();
  loaded = false;
  feedId = null;
  seen = 0;
  sinceStart = 0;
  alerts = DEFAULT_ALERTS;
  startedHere = false;
  busy = Promise.resolve();
}
