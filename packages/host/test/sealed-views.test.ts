// Sealed custom views (#267, docs/22 §11): the watchdog, the crash-loop guard, and the claim the
// design rests on — a view's ops go through the SAME op table as the app's logic, on the same kind of
// mediated ctx, so host-side the two cannot be told apart. The frame itself (sandbox, CSP, pixels,
// freezes) is the browser's and is asserted in e2e (sealed-views-*-sandbox.spec.ts).

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type UiBridge } from "../src/index.js";
import { createRealmLoader, releaseSharedProcess, ViewGuard, ViewWatchdog, MARK_PREFIX, OFF_KEY, type GuardStorage, type RealmLoadedApp } from "../src/realm/index.js";
import type { Channel } from "../src/realm/channel.js";
import { SocketBridge } from "../src/socket-bridge.js";
import { liveThreads, realmWorkerSource, threadSpawner } from "./runners.js";

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

function clock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("the view watchdog", () => {
  it("does not judge a view while it mounts, only the whole mount", () => {
    const c = clock();
    const dog = new ViewWatchdog(c.now, { mountMs: 5000, checkMs: 100 });
    dog.ping();
    c.tick(4000); // a slow phone evaluating the bundle: the check itself ran late, the ping unanswered
    expect(dog.check(true)).toEqual({ stop: false });
    c.tick(1100);
    const v = dog.check(true);
    expect(v.stop && v.kind).toBe("mount");
  });

  it("stops a mounted view whose pings go unanswered past the silence (its frame runs apart and is stuck)", () => {
    const c = clock();
    const dog = new ViewWatchdog(c.now, { silenceMs: 2000, checkMs: 100 });
    dog.mounted();
    const n = dog.ping();
    let stoppedAt = -1;
    for (let i = 1; i <= 30 && stoppedAt < 0; i++) {
      c.tick(100);
      const v = dog.check(true);
      if (v.stop) {
        expect(v.kind).toBe("silent");
        stoppedAt = i * 100;
      }
    }
    expect(stoppedAt).toBe(2100);
    // Answered in time instead, nothing happens.
    const ok = new ViewWatchdog(c.now, { silenceMs: 2000, checkMs: 100 });
    ok.mounted();
    ok.ping();
    c.tick(100);
    ok.pong(n);
    for (let i = 0; i < 30; i++) {
      c.tick(100);
      expect(ok.check(true).stop).toBe(false);
    }
  });

  it("stops a mounted view when the page's own check runs seconds late (the view shared the thread and blocked it)", () => {
    const c = clock();
    const dog = new ViewWatchdog(c.now, { blockedMs: 2000, checkMs: 100 });
    dog.mounted();
    c.tick(100);
    expect(dog.check(true).stop).toBe(false);
    c.tick(3100); // the check that should have run 100 ms later ran 3 s later
    const v = dog.check(true);
    expect(v.stop && v.kind).toBe("blocked");
    expect(v.stop && v.reason).toMatch(/blocked for 3000 ms/);
  });

  it("forgives a hidden page: its timers are throttled, nothing it measures then counts", () => {
    const c = clock();
    const dog = new ViewWatchdog(c.now, { silenceMs: 2000, blockedMs: 2000, checkMs: 100 });
    dog.mounted();
    dog.ping();
    c.tick(60_000);
    expect(dog.check(false)).toEqual({ stop: false });
    c.tick(100);
    expect(dog.check(true)).toEqual({ stop: false });
  });

  it("is healthy only while it answers", () => {
    const c = clock();
    const dog = new ViewWatchdog(c.now);
    dog.mounted();
    const n = dog.ping();
    c.tick(100);
    dog.pong(n);
    expect(dog.healthy()).toBe(true);
    dog.ping();
    c.tick(1500);
    expect(dog.healthy()).toBe(false);
  });
});

function memory(): GuardStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("the crash-loop guard", () => {
  it("writes the marker before the view mounts, refreshes it while it answers, removes it when it goes cleanly", () => {
    const s = memory();
    const c = clock();
    const g = new ViewGuard({ storage: s, now: c.now, loadId: "me" });
    const mark = g.mounting("app", "play");
    const key = [...s.map.keys()].find((k) => k.startsWith(MARK_PREFIX))!;
    expect(JSON.parse(s.map.get(key)!)).toEqual({ app: "app", page: "play", at: 1000 });
    c.tick(1500);
    mark.alive();
    expect(JSON.parse(s.map.get(key)!).at).toBe(2500);
    mark.pause();
    expect(s.map.has(key)).toBe(false);
    mark.resume();
    expect(s.map.has(key)).toBe(true);
    mark.done();
    expect([...s.map.keys()].filter((k) => k.startsWith(MARK_PREFIX))).toEqual([]);
    expect(g.isOff("app")).toBe(false);
  });

  it("a marker left by a tab that froze or died turns that app's views off on the next start, until retried", () => {
    const s = memory();
    const c = clock(100_000);
    s.setItem(`${MARK_PREFIX}deadtab:1`, JSON.stringify({ app: "breakout", page: "play", at: 90_000 }));
    s.setItem(`${MARK_PREFIX}livetab:1`, JSON.stringify({ app: "piano", page: "today", at: 99_500 }));
    const g = new ViewGuard({ storage: s, now: c.now, loadId: "next" });
    expect(g.isOff("breakout")).toBe(true);
    expect(g.isOff("piano")).toBe(false); // another tab, alive
    expect(s.map.has(`${MARK_PREFIX}deadtab:1`)).toBe(false);
    expect(JSON.parse(s.getItem(OFF_KEY)!).breakout.page).toBe("play");
    // A new start of Potyro reads the same storage: still off.
    expect(new ViewGuard({ storage: s, now: c.now, loadId: "again" }).isOff("breakout")).toBe(true);
    g.retry("breakout");
    expect(g.isOff("breakout")).toBe(false);
    expect(s.getItem(OFF_KEY)).toBeNull();
  });

  it("never holds its own load's markers against it: those are its watchdog's", () => {
    const s = memory();
    const c = clock();
    const g = new ViewGuard({ storage: s, now: c.now, loadId: "me" });
    g.mounting("app", "play");
    c.tick(60_000); // this tab's thread was busy, or its timers throttled
    expect(g.isOff("app")).toBe(false);
  });

  it("a watchdog stop turns the app's views off as well", () => {
    const g = new ViewGuard({ storage: memory(), loadId: "me" });
    g.turnOff("app", "play", "its screen stopped answering");
    expect(g.isOff("app")).toBe(true);
  });

  it("works from memory where storage throws", () => {
    const broken: GuardStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      get length(): number {
        throw new Error("blocked");
      },
    };
    const g = new ViewGuard({ storage: broken, loadId: "me" });
    g.turnOff("app", "play", "why");
    expect(g.isOff("app")).toBe(true);
    g.retry("app");
    expect(g.isOff("app")).toBe(false);
  });
});

const CUSTOM_APP = `globalThis.__potyroApp = {
  id: "s", name: "S", version: "1.0.0", schemaVersion: 1,
  entities: { n: { fields: { t: { type: "text" }, k: { type: "number" } } } },
  pages: [
    { id: "play", title: "Play", view: { type: "custom", entity: "n", render: function () { return null; } } },
    { id: "all", title: "All", view: { type: "list", entity: "n" }, actions: [{ label: "Add", run: function (ctx) { return ctx.create("n", { t: "from logic", createdBy: "someone-else" }); } }] }
  ]
};`;

async function setup(withViews = true, probe?: () => Promise<boolean>, extraUi: Partial<UiBridge> = {}) {
  const store = new MemoryStore();
  await store.open("s");
  const kills: string[] = [];
  const guard = new ViewGuard({ storage: memory(), loadId: "t" });
  const workerSource = await realmWorkerSource();
  const loadIsolated = createRealmLoader({
    spawn: probe ? async (a) => ({ ...(await threadSpawner(a)), probe }) : threadSpawner,
    workerSource,
    onKill: (r) => kills.push(r),
    ...(withViews ? { views: { appKey: "s", code: async () => CUSTOM_APP, runtimeSource: async () => "", guard } } : {}),
  });
  const host = createHost({ loadIsolated });
  const loaded = (await host.load({ kind: "bundle", code: CUSTOM_APP, provenance: "untrusted" })) as RealmLoadedApp;
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null, ...extraUi };
  const makeCtx = () => host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, me: { id: "me-1", name: "Me" } });
  return { store, loaded, makeCtx, kills, guard };
}

/** A view's port as `answer` sees it, the way SealedViewController builds one, with a recorder for replies. */
function viewChannel(ctxFor: () => ReturnType<Awaited<ReturnType<typeof setup>>["makeCtx"]>, viewCtxId = 77) {
  const posted: Array<Record<string, unknown>> = [];
  const ch: Channel = {
    post: (m) => posted.push(m as Record<string, unknown>),
    alive: () => true,
    ctx: (id) => (id === viewCtxId ? ctxFor() : undefined),
    sockets: new SocketBridge(() => true, () => {}),
    pinnedBy: new Map(),
    progress: "v:",
    viewOp: async (op) => `view op ${op}`,
    adapt: async (_op, v) => v,
  };
  return { ch, posted, viewCtxId };
}

type Answer = (m: { id: number; ctxId: number; op: string; args: unknown[] }, ch: Channel) => Promise<void>;
const answerOf = (loaded: RealmLoadedApp): Answer => (loaded as unknown as { answer: Answer }).answer.bind(loaded);

describe("a view's ops go through the logic's op table", () => {
  it("a create from a view is the same mediated call as one from the logic: stamped as me, gated, stored", async () => {
    const { store, loaded, makeCtx } = await setup();
    // From the logic, in the realm's worker.
    await loaded.callPageAction("all", 0, makeCtx());
    // From a view's port.
    const { ch, posted, viewCtxId } = viewChannel(makeCtx);
    await answerOf(loaded)({ id: 1, ctxId: viewCtxId, op: "create", args: ["n", { t: "from a view", createdBy: "someone-else" }] }, ch);
    expect(posted[0]).toMatchObject({ t: "reply", id: 1, ok: true });
    const rows = await store.all("n");
    expect(rows.map((r) => [r.t, r.createdBy]).sort()).toEqual([
      ["from a view", "me-1"],
      ["from logic", "me-1"],
    ]);
    // The values gate is the same too: a value that does not fit its field is refused.
    await answerOf(loaded)({ id: 2, ctxId: viewCtxId, op: "create", args: ["n", { k: "not a number" }] }, ch);
    expect(posted[1]).toMatchObject({ id: 2, ok: false });
    expect(String(posted[1]!.error)).toMatch(/number/i);
    loaded.dispose();
  });

  it("refuses what is not on the lists, a ctx it did not issue, and view ops on the logic's port", async () => {
    const { loaded, makeCtx } = await setup();
    const { ch, posted, viewCtxId } = viewChannel(makeCtx);
    const answer = answerOf(loaded);
    await answer({ id: 1, ctxId: viewCtxId, op: "relay.connect", args: [] }, ch);
    await answer({ id: 2, ctxId: viewCtxId, op: "space.invite", args: [] }, ch);
    await answer({ id: 3, ctxId: 424242, op: "query", args: ["n"] }, ch);
    await answer({ id: 4, ctxId: viewCtxId, op: "runtime.watchQuery", args: [1, "n"] }, ch);
    expect(posted.map((p) => p.error ?? p.value)).toEqual(["op not allowed: relay.connect", "op not allowed: space.invite", "no such ctx", "view op runtime.watchQuery"]);
    // The same view op on a port that has no view ops (the logic's): not allowed.
    const logic = { ...ch, viewOp: undefined };
    await answer({ id: 5, ctxId: viewCtxId, op: "runtime.watchQuery", args: [1, "n"] }, logic);
    expect(posted[4]).toMatchObject({ ok: false, error: "op not allowed: runtime.watchQuery" });
    loaded.dispose();
  });

  it("a sealed screen keeps the screen on and runs timers through the same ops; its holds go when it goes", async () => {
    let held = 0;
    const timers: Array<{ id: string; label: string; seconds: number; endsAt: string | null; left: number; paused: boolean }> = [];
    const { loaded, makeCtx } = await setup(true, undefined, {
      keepAwake: () => {
        held++;
        return { release: () => void held-- };
      },
      timers: {
        start: async (o) => {
          const t = { id: o.id ?? `t${timers.length + 1}`, label: o.label, seconds: o.seconds, endsAt: null, left: o.seconds, paused: false };
          timers.push(t);
          return t;
        },
        list: async () => timers,
        control: async () => {},
      },
    });
    const { ch, posted, viewCtxId } = viewChannel(makeCtx);
    const answer = answerOf(loaded);
    // The logic's hold "w1" and the view's "w1" are two holds, not one.
    await answer({ id: 0, ctxId: viewCtxId, op: "ui.keepAwake", args: ["w1", "hold"] }, ch);
    await loaded.callPageAction("all", 0, makeCtx());
    const logic = (loaded as unknown as { logic: Channel }).logic;
    await answer({ id: 0, ctxId: 1, op: "ui.keepAwake", args: ["w1", "hold"] }, { ...logic, ctx: () => makeCtx() });
    expect(held).toBe(2);
    await answer({ id: 1, ctxId: viewCtxId, op: "ui.timer", args: [{ label: "Rest", seconds: 90 }] }, ch);
    expect(posted[0]).toMatchObject({ id: 1, ok: true, value: { label: "Rest", seconds: 90 } });
    expect(timers).toHaveLength(1);
    // The view goes: its hold goes with it, the logic's stays.
    (loaded as unknown as { releaseHolds(p: string): void }).releaseHolds(ch.progress);
    expect(held).toBe(1);
    loaded.dispose();
    expect(held).toBe(0);
  });

  it("offers a sealed view for a custom page only, and only when the shell gave a way to bundle views", async () => {
    const withViews = await setup(true);
    expect(withViews.loaded.sealedView("play")).not.toBeNull();
    expect(withViews.loaded.sealedView("all")).toBeNull();
    const view = withViews.loaded.sealedView("play")!;
    expect(view.state()).toBe("ready");
    withViews.guard.turnOff("s", "play", "froze");
    expect(view.state()).toBe("off");
    view.retry();
    expect(view.state()).toBe("ready");
    withViews.loaded.dispose();
    const without = await setup(false);
    expect(without.loaded.sealedView("play")).toBeNull();
    without.loaded.dispose();
  });
});

describe("the Chromium shared-process escalation", () => {
  it("restarts every realm when one's frame does not answer after a view was stopped, and nothing when all do", async () => {
    const fine = await setup(true, async () => true);
    await fine.loaded.callPageAction("all", 0, fine.makeCtx());
    expect(await releaseSharedProcess("test")).toBe(false);
    expect(fine.kills).toEqual([]);

    const stuck = await setup(true, async () => false);
    await stuck.loaded.callPageAction("all", 0, stuck.makeCtx());
    expect(await releaseSharedProcess("a stopped screen")).toBe(true);
    expect(stuck.kills.some((k) => /process was still busy/.test(k))).toBe(true);
    expect(fine.kills.some((k) => /process was still busy/.test(k))).toBe(true);
    // A killed realm comes back on its next call.
    await stuck.loaded.callPageAction("all", 0, stuck.makeCtx());
    expect((await stuck.store.all("n")).length).toBe(2);
    fine.loaded.dispose();
    stuck.loaded.dispose();
  });
});
