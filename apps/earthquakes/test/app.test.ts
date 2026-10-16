// The app's shape and its words, and the live feed end to end against a scripted ctx: the last day
// filled in, quakes arriving and being revised, the status record, the alert, the demo, stopping.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps } from "potyro";
import app from "../earthquakes.app.js";
import { ALERTS_KEY, clearDemo, DEMO_STEP_MS, editAlerts, idle, playDemo, resetForTests, stopWatching, watchLive } from "../feed.js";
import { DEMO_BACKLOG, DEMO_LIVE } from "../demo.js";
import { EMSC_SOCKET } from "../quakes.js";
import { fakeCtx, settle } from "./fake.js";
import { LANGUAGES } from "./say.js";

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "vitest.config.ts");
const source = sources.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const catalogue = JSON.parse(readFileSync(new URL("../fixtures/fdsn-recent.json", import.meta.url), "utf8")) as { features: Array<{ properties: Record<string, unknown> }> };
const samples = JSON.parse(readFileSync(new URL("../fixtures/emsc-socket.json", import.meta.url), "utf8")) as string[];

/** A real message from the feed, its time moved to `minutesAgo`. */
function message(i: number, minutesAgo: number, patch: Record<string, unknown> = {}): string {
  const m = JSON.parse(samples[i]!) as { data: { properties: Record<string, unknown> } };
  Object.assign(m.data.properties, { time: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...patch });
  return JSON.stringify(m);
}

/** The catalogue's answer, its times moved so the newest is `minutesAgo`. */
function recent(minutesAgo: number) {
  const body = structuredClone(catalogue);
  const newest = Date.parse(String(body.features[0]!.properties.time));
  for (const f of body.features) f.properties.time = new Date(Date.parse(String(f.properties.time)) - newest + Date.now() - minutesAgo * 60_000).toISOString();
  return body;
}

beforeEach(() => resetForTests());
afterEach(() => {
  resetForTests();
  vi.useRealTimers();
});

describe("Earthquakes — the app", () => {
  it("is a valid app that reaches EMSC only through ctx, and only EMSC", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ network: { hosts: ["www.seismicportal.eu"] }, geo: true, notifications: true, haptics: true });
    expect(source).toContain("ctx.caps.network");
    expect(source).not.toMatch(/\bfetch\(["'`]|new WebSocket|navigator\.|document\.|window\./);
  });

  it("uses only built-in views, so a friend who runs it sealed gets all of it", () => {
    for (const p of app.pages) {
      const views = p.layout ? p.layout.items.map((i) => i.view) : [p.view];
      for (const v of views) expect(v.type, p.id).not.toBe("custom");
    }
    // Nothing to add by hand: every record comes from the feed.
    expect(app.quickActions).toEqual([]);
  });

  it("is written in English and carries all six languages, in its declared words and in its code", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(LANGUAGES);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
    const maps = [...source.matchAll(/\{\s*en: /g)].map((m) => {
      let depth = 0;
      let i = m.index!;
      for (; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) break;
      }
      return source.slice(m.index!, i + 1);
    });
    expect(maps.length).toBeGreaterThan(80);
    for (const map of maps) for (const l of ['"pt-BR":', " de:", " es:", " pl:", " it:"]) expect(map, map.slice(0, 80)).toContain(l);
  });
});

describe("the live feed", () => {
  it("fills in the last day, then saves what arrives — a revision patches its quake, a weeks-old event is skipped", async () => {
    const f = fakeCtx({ fetch: () => recent(40) });
    await watchLive(f.ctx);
    await idle();
    await settle();
    expect(f.fetched).toHaveLength(1);
    expect(f.fetched[0]).toMatch(/^https:\/\/www\.seismicportal\.eu\/fdsnws\/event\/1\/query\?format=json/);
    expect(f.opened).toEqual([EMSC_SOCKET]);
    expect(f.rows("quake")).toHaveLength(46);
    expect(f.rows("feed")[0]).toMatchObject({ state: "live" });

    const s = f.sockets[0]!;
    s.push(message(0, 2)); // South Sandwich Islands, 2 minutes ago
    s.push(message(0, 2, { mag: 4.8, lastupdate: new Date().toISOString() })); // its revision
    s.push(message(1, 60 * 24 * 20)); // catalogued only now, 20 days old
    s.push("not json");
    await settle(60);
    const rows = f.rows("quake");
    expect(rows).toHaveLength(47);
    const ssi = rows.find((r) => r.place === "South Sandwich Islands Region")!;
    expect(ssi).toMatchObject({ mag: 4.8, strength: "light", where: { lat: -58.4079, lng: -26.306 }, demo: false });
    expect(ssi.link).toBe("https://www.seismicportal.eu/eventdetails.html?unid=20260923_0000372");
    expect(f.rows("feed")[0]).toMatchObject({ state: "live", count: 1, lastPlace: "South Sandwich Islands Region" });
  });

  it("does not fill in again when it has something from the last half hour", async () => {
    const f = fakeCtx({ fetch: () => recent(40) });
    await f.ctx.create("quake", { uid: "x", place: "Somewhere", mag: 3, time: new Date(Date.now() - 5 * 60_000) });
    await watchLive(f.ctx);
    await idle();
    await settle();
    expect(f.fetched).toEqual([]);
    expect(f.opened).toHaveLength(1);
  });

  it("goes live even when the catalogue does not answer", async () => {
    const f = fakeCtx({ fetch: () => new Error("offline") });
    await watchLive(f.ctx);
    await idle();
    await settle();
    expect(f.rows("quake")).toHaveLength(0);
    expect(f.rows("feed")[0]).toMatchObject({ state: "live" });
  });

  it("says when EMSC cannot be reached, and when this copy may not reach it", async () => {
    const f = fakeCtx();
    f.answers.push("unreachable");
    await watchLive(f.ctx);
    await idle();
    await settle();
    expect(f.rows("feed")[0]).toMatchObject({ state: "unreachable" });
    await stopWatching(f.ctx);
    await idle();

    resetForTests();
    const g = fakeCtx();
    g.answers.push("not-allowed-host");
    await watchLive(g.ctx);
    await idle();
    await settle();
    expect(g.rows("feed")[0]).toMatchObject({ state: "blocked" });
  });

  it("alerts on a strong quake near home: a notification on a phone, words on screen on the web", async () => {
    const home = { lat: -58, lng: -26 };
    for (const notifications of [true, false]) {
      resetForTests();
      const f = fakeCtx({ notifications, geo: home });
      f.form = { on: true, above: 4.5, withinKm: 300 };
      await editAlerts(f.ctx);
      await idle();
      expect(f.storage.get(ALERTS_KEY)).toMatchObject({ on: true, above: 4.5, withinKm: 300, home });
      await watchLive(f.ctx);
      await idle();
      await settle();
      f.sockets[0]!.push(message(0, 1));
      await settle(60);
      const said = notifications ? f.notified.map((n) => n.title) : f.toasts.filter((t) => t.includes("earthquake"));
      expect(said, String(notifications)).toEqual([expect.stringMatching(/^M4\.5 earthquake \d+ km away/)]);
    }
  });

  it("will not turn alerts on without knowing where you are", async () => {
    const f = fakeCtx({ geo: null });
    f.form = { on: true, above: 5, withinKm: 200 };
    await editAlerts(f.ctx);
    await idle();
    expect(f.storage.get(ALERTS_KEY)).toBeUndefined();
    expect(f.toasts[0]).toMatch(/need to know where you are/);
  });

  it("stop closes the connection and says Not live", async () => {
    const f = fakeCtx();
    await watchLive(f.ctx);
    await idle();
    await settle();
    await stopWatching(f.ctx);
    await idle();
    expect(f.sockets[0]!.readyState).toBe("closed");
    expect(f.rows("feed")[0]).toMatchObject({ state: "off" });
  });

  it("speaks the person's language: Polish status words come from the same records", async () => {
    const f = fakeCtx({ language: "pl" });
    f.form = { on: false, above: 4.5, withinKm: 300 };
    await editAlerts(f.ctx);
    await idle();
    expect(f.toasts).toEqual(["Alerty wyłączone."]);
  });
});

describe("the demo", () => {
  it("fills the last day, then quakes arrive one by one through the same path — nothing is sent anywhere", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const f = fakeCtx();
    await playDemo(f.ctx);
    await idle();
    expect(f.rows("quake")).toHaveLength(DEMO_BACKLOG.length);
    expect(f.rows("feed")[0]).toMatchObject({ state: "demo" });
    await vi.advanceTimersByTimeAsync(DEMO_STEP_MS * 3);
    expect(f.rows("quake")).toHaveLength(DEMO_BACKLOG.length + 3);
    await vi.advanceTimersByTimeAsync(DEMO_STEP_MS * (DEMO_LIVE.length + 1));
    // The last one is a revision of the one before it: patched, not added.
    expect(f.rows("quake")).toHaveLength(DEMO_BACKLOG.length + DEMO_LIVE.length - 1);
    expect(f.rows("feed")[0]).toMatchObject({ state: "demo-done" });
    expect(f.rows("quake").every((r) => r.demo === true)).toBe(true);
    expect(f.opened).toEqual([]);
    expect(f.fetched).toEqual([]);

    await clearDemo(f.ctx);
    await idle();
    expect(f.rows("quake")).toHaveLength(0);
    expect(f.toasts.at(-1)).toBe(`${DEMO_BACKLOG.length + DEMO_LIVE.length - 1} sample quakes removed.`);
  });

  it("watching live stops the demo and takes its quakes away: what is listed from then on is real", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fakeCtx();
    await playDemo(f.ctx);
    await idle();
    expect(f.rows("quake")).toHaveLength(DEMO_BACKLOG.length);
    await watchLive(f.ctx);
    await idle();
    await vi.advanceTimersByTimeAsync(DEMO_STEP_MS * 3);
    expect(f.rows("quake")).toHaveLength(0);
    expect(f.opened).toEqual([EMSC_SOCKET]);
  });
});
