// The countdowns the shell keeps for apps (`ctx.ui.timer`, docs/04 §Timers): they outlive the app and
// a reload, ring once at the end, and hand the device a notification for the lock screen.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerHub, type KeptTimer, type TimerNotifier } from "../src/timer-hub.js";
import { ScreenAwake } from "../src/keep-awake.js";
import { secondsLeft } from "@potyro/host";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function notifier() {
  const scheduled = new Map<string, { at: string; title: string; body?: string }>();
  const n: TimerNotifier = {
    schedule: async (x) => void scheduled.set(x.id, x),
    cancel: async (id) => void scheduled.delete(id),
  };
  return { n, scheduled };
}

describe("TimerHub", () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  const make = (deps: Partial<ConstructorParameters<typeof TimerHub>[0]> = {}) => new TimerHub({ now: () => now, storage: memoryStorage(), ...deps });

  it("keeps an app's timers apart from another app's, soonest first", async () => {
    const hub = make();
    const a = hub.bridgeFor("recipes", "Recipes");
    const b = hub.bridgeFor("workout", "Workout");
    await a.start({ label: "Sauce", seconds: 600 });
    await a.start({ label: "Eggs", seconds: 420 });
    await b.start({ label: "Rest", seconds: 90 });
    expect((await a.list()).map((t) => t.label)).toEqual(["Eggs", "Sauce"]);
    expect((await b.list()).map((t) => t.label)).toEqual(["Rest"]);
    expect(hub.all().map((k) => k.label)).toEqual(["Rest", "Eggs", "Sauce"]);
  });

  it("the same id restarts the timer rather than adding a second", async () => {
    const hub = make();
    const a = hub.bridgeFor("workout", "Workout");
    await a.start({ label: "Rest", seconds: 90, id: "rest" });
    now += 30_000;
    const again = await a.start({ label: "Rest", seconds: 90, id: "rest" });
    expect(again.left).toBe(90);
    expect(await a.list()).toHaveLength(1);
  });

  it("pauses with what is left, resumes from there, and stops", async () => {
    const hub = make();
    const a = hub.bridgeFor("w", "W");
    await a.start({ label: "Rest", seconds: 90, id: "rest" });
    now += 30_000;
    await a.control("rest", "pause");
    now += 600_000; // paused: time passing does nothing
    expect((await a.list())[0]).toMatchObject({ paused: true, endsAt: null, left: 60 });
    await a.control("rest", "resume");
    expect((await a.list())[0]).toMatchObject({ paused: false, left: 60 });
    await a.control("rest", "cancel");
    expect(await a.list()).toEqual([]);
  });

  it("rings once at the end, stays on the chip until Done, and is no longer the app's", async () => {
    const rang: KeptTimer[] = [];
    const hub = make({ ring: (k) => void rang.push(k) });
    const a = hub.bridgeFor("w", "W");
    await a.start({ label: "Rest", seconds: 5, id: "rest" });
    now += 5_000;
    vi.advanceTimersByTime(5_100);
    expect(rang.map((k) => k.label)).toEqual(["Rest"]);
    expect(hub.all()[0]).toMatchObject({ ringing: true });
    expect(await a.list()).toEqual([]);
    hub.check();
    expect(rang).toHaveLength(1); // once
    hub.control("w", "rest", "dismiss");
    expect(hub.all()).toEqual([]);
  });

  it("survives a reload, and one that ended while Potyro was shut rings when it is back — unless long ago", () => {
    const storage = memoryStorage();
    const first = make({ storage });
    first.start("w", "W", { label: "Rest", seconds: 60, id: "rest" });
    first.start("r", "R", { label: "Bread", seconds: 60 * 60, id: "bread" });
    now += 61_000;
    const rang: string[] = [];
    const second = make({ storage, ring: (k) => void rang.push(k.label) });
    expect(rang).toEqual(["Rest"]);
    expect(second.running("r").map((k) => k.label)).toEqual(["Bread"]);
    now += 3 * 60 * 60_000;
    const third = make({ storage, ring: (k) => void rang.push(k.label) });
    expect(rang).toEqual(["Rest"]); // Bread ended hours ago: the notification said so
    expect(third.all().filter((k) => !k.ringing)).toEqual([]);
  });

  it("hands the device a notification for its end, and takes it back on pause and stop", async () => {
    const { n, scheduled } = notifier();
    const hub = make({ notifier: () => n });
    const a = hub.bridgeFor("w", "Workout");
    await a.start({ label: "Rest", seconds: 90, id: "rest" });
    expect([...scheduled.entries()]).toEqual([["timer:w:rest", { id: "timer:w:rest", at: new Date(now + 90_000).toISOString(), title: "Rest", body: "Time’s up · Workout" }]]);
    await a.control("rest", "pause");
    await Promise.resolve();
    expect(scheduled.size).toBe(0);
    await a.control("rest", "resume");
    await Promise.resolve();
    expect(scheduled.size).toBe(1);
    await a.control("rest", "cancel");
    await Promise.resolve();
    expect(scheduled.size).toBe(0);
  });

  // `ctx.ui.drawsTimer`: a page that draws a countdown itself says so, and its chip stays out of the
  // way while it does — the timer still counts and rings, and the chip is back when the page goes.
  it("leaves out the chip of a timer a page draws itself, until it lets go or the app is left", async () => {
    const rang: string[] = [];
    const hub = make({ ring: (k) => void rang.push(k.label) });
    const w = hub.bridgeFor("w", "Workout");
    const r = hub.bridgeFor("r", "Recipes");
    await w.start({ label: "Rest", seconds: 90, id: "rest" });
    await r.start({ label: "Eggs", seconds: 420, id: "rest" });
    const heard = vi.fn();
    hub.subscribe(heard);
    const labels = (app: string | null) => hub.chips(app).map((k) => k.label);
    expect(labels("w")).toEqual(["Rest", "Eggs"]);

    const letGo = w.draw!("rest");
    expect(heard).toHaveBeenCalled();
    // Only that app's timer of that id: another app's "rest" keeps its chip.
    expect(labels("w")).toEqual(["Eggs"]);
    // Twice is two holds: the chip comes back with the last.
    const again = w.draw!("rest");
    letGo();
    letGo(); // once is once
    expect(labels("w")).toEqual(["Eggs"]);
    again();
    expect(labels("w")).toEqual(["Rest", "Eggs"]);

    // Forgotten, and the app is left: the chip is back.
    w.draw!("rest");
    expect(labels("w")).toEqual(["Eggs"]);
    hub.releaseDraws("w");
    expect(labels(null)).toEqual(["Rest", "Eggs"]);

    // Drawn by the page, it still rings, and a rung timer's chip shows: someone has to say Done.
    w.draw!("rest");
    now += 90_000;
    vi.advanceTimersByTime(90_100);
    expect(rang).toEqual(["Rest"]);
    expect(labels("w")).toEqual(["Rest", "Eggs"]);
  });

  it("the open app's chips go first", async () => {
    const hub = make();
    await hub.bridgeFor("a", "A").start({ label: "Soon", seconds: 10 });
    await hub.bridgeFor("b", "B").start({ label: "Later", seconds: 600 });
    expect(hub.chips(null).map((k) => k.label)).toEqual(["Soon", "Later"]);
    expect(hub.chips("b").map((k) => k.label)).toEqual(["Later", "Soon"]);
  });

  // One rounding everywhere: what a timer handle says is left, and what the chip shows, change at the
  // same moment — and the chip draws again exactly then, not up to a second late.
  it("counts whole seconds up, and wakes the chip the moment the second changes", async () => {
    const hub = make();
    const w = hub.bridgeFor("w", "W");
    await w.start({ label: "Rest", seconds: 90, id: "rest" });
    expect(secondsLeft(90_000)).toBe(90);
    expect(secondsLeft(89_001)).toBe(90);
    expect(secondsLeft(89_000)).toBe(89);
    expect(secondsLeft(-5)).toBe(0);
    now += 400;
    expect((await w.list())[0]!.left).toBe(90);
    expect(hub.nextChangeIn()).toBe(600);
    now += 600;
    expect((await w.list())[0]!.left).toBe(89);
    expect(hub.nextChangeIn()).toBe(1000);
    await w.control("rest", "pause");
    expect(hub.nextChangeIn()).toBeNull(); // nothing counts: no need to draw again
  });
});

describe("ScreenAwake", () => {
  function fakeDoc() {
    const listeners: Array<() => void> = [];
    const attrs = new Set<string>();
    const doc = {
      visibilityState: "visible" as "visible" | "hidden",
      addEventListener: (_: string, cb: () => void) => void listeners.push(cb),
      documentElement: { toggleAttribute: (a: string, on: boolean) => void (on ? attrs.add(a) : attrs.delete(a)) },
    };
    return { doc: doc as unknown as Document, raw: doc, listeners, attrs };
  }
  function fakeWakeLock() {
    const log: string[] = [];
    const lock = {
      request: async () => {
        log.push("request");
        const s = { released: false, release: async () => void ((s.released = true), log.push("release")) };
        return s;
      },
    };
    return { lock, log };
  }

  it("holds once for several holds, lets go with the last, and asks again after the page was hidden", async () => {
    const { lock, log } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: lock });
    const d = fakeDoc();
    const awake = new ScreenAwake(async () => false, d.doc);
    const one = awake.hold("recipes");
    const two = awake.hold("recipes");
    await awake.settled();
    expect(log).toEqual(["request"]);
    expect(d.attrs.has("data-k-awake")).toBe(true);
    one();
    await awake.settled();
    expect(log).toEqual(["request"]);
    // The browser drops the lock while hidden; back in front, it is asked for again.
    (await Promise.resolve(), (log.length = 0));
    const s = (awake as unknown as { sentinel: { released: boolean } }).sentinel;
    s.released = true;
    d.listeners.forEach((cb) => cb());
    await awake.settled();
    expect(log).toEqual(["request"]);
    two();
    await awake.settled();
    expect(log).toEqual(["request", "release"]);
    expect(d.attrs.has("data-k-awake")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("leaving the app lets go of every hold it forgot", async () => {
    const { lock, log } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: lock });
    const awake = new ScreenAwake(async () => false, fakeDoc().doc);
    awake.hold("a");
    awake.hold("a");
    await awake.settled();
    awake.releaseApp("a");
    await awake.settled();
    expect(awake.held).toBe(false);
    expect(log).toEqual(["request", "release"]);
    vi.unstubAllGlobals();
  });

  it("uses the native way when there is one, and not the web's", async () => {
    const { lock, log } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: lock });
    const native: boolean[] = [];
    const awake = new ScreenAwake(async (on) => (native.push(on), true), fakeDoc().doc);
    const release = awake.hold("a");
    await awake.settled();
    release();
    await awake.settled();
    expect(native).toEqual([true, false]);
    expect(log).toEqual([]);
    vi.unstubAllGlobals();
  });
});
