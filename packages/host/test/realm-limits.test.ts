// What the host keeps for a sealed app in the browser realm, bounded (#90, docs/22 §7.1): the size of
// what an op carries, how much waits at once, how many questions and bars are open, what one call
// hands back, a download — and an app the watchdog keeps stopping is not started again by itself.
//
// The realm's own memory is the engine's and nothing here bounds it; e2e/realm-memory-probe measures
// what each engine does about it.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { actionFailure, createHost, HostFault, type MakeCtxBase, type UiBridge } from "../src/index.js";
import { HeldBudget, REALM_LIMITS, RealmLimitError, checkOpSize, isWordsOp, readBody, sizeOf } from "../src/realm/limits.js";
import { REST_AFTER_STOPS } from "../src/realm/realm-host.js";
import { liveThreads, realm, type RunnerOptions } from "./runners.js";

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

const MB = 1024 * 1024;

const app = (body: string, extra = "") => `globalThis.__potyroApp = {
  id: "r", name: "R", version: "1.0.0", schemaVersion: 1, ${extra}
  entities: { n: { fields: { t: { type: "text" } }, computed: { ${body} } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }]
};`;

async function setup(code: string, opts: RunnerOptions = {}, extra: Partial<MakeCtxBase> = {}) {
  const store = new MemoryStore();
  await store.open("r");
  const kills: string[] = [];
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost({ loadIsolated: await realm.loader(store, { ...opts, onKill: (r) => kills.push(r) }) });
  const loaded = await host.load({ kind: "bundle", code, provenance: "untrusted" });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, ...extra });
  const row = { id: "x", createdAt: "", updatedAt: "", t: "hi" } as never;
  return { store, loaded, ctx, kills, row };
}

/** The app takes the runtime's port, to send what `ctx` never would. */
const STEAL = `var MP = MessagePort.prototype.postMessage, port;
  MessagePort.prototype.postMessage = function(){ port = this; MessagePort.prototype.postMessage = MP; return MP.apply(this, arguments); };
  await ctx.storage.get("anything");`;

describe("sizeOf: about how much a value that crossed a port holds", () => {
  it("counts what is big exactly: strings, buffers, Blobs", () => {
    expect(sizeOf("x".repeat(1000))).toBeGreaterThanOrEqual(2000);
    expect(sizeOf(new Uint8Array(4096))).toBeGreaterThanOrEqual(4096);
    expect(sizeOf(new ArrayBuffer(4096))).toBeGreaterThanOrEqual(4096);
    expect(sizeOf(new Blob([new Uint8Array(4096)]))).toBeGreaterThanOrEqual(4096);
    // A small view of a big buffer: the whole buffer crossed.
    expect(sizeOf(new Uint8Array(new ArrayBuffer(8192), 0, 4))).toBeGreaterThanOrEqual(8192);
  });

  it("walks plain data, Maps and Sets, and counts a shared or circular part once", () => {
    const big = "y".repeat(5000);
    const once = sizeOf({ a: big });
    expect(sizeOf({ a: [big], m: new Map([["k", big]]), s: new Set([big]) })).toBeGreaterThanOrEqual(3 * 10_000);
    const buf = new Uint8Array(10_000);
    expect(sizeOf([buf, buf, buf])).toBeLessThan(2 * 10_000);
    const loop: Record<string, unknown> = { a: big };
    loop.self = loop;
    expect(sizeOf(loop)).toBeLessThan(once + 200);
  });

  it("stops at its limit: a value built to be slow to measure is refused, not walked", () => {
    const started = performance.now();
    expect(sizeOf(new Array(1e9), MB)).toBeGreaterThan(MB);
    expect(sizeOf(Array.from({ length: 100 }, () => new Array(1e8)), MB)).toBeGreaterThan(MB);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("holds words to a small limit and bytes to the op's", () => {
    for (const op of ["ui.toast", "ui.confirm", "ui.form", "log", "navigate", "guests.add", "caps.notifications.schedule", "view.navigate"]) expect(isWordsOp(op)).toBe(true);
    for (const op of ["media.put", "files.write", "create", "storage.set", "ui.share", "caps.network.fetch", "caps.network.socket.send"]) expect(isWordsOp(op)).toBe(false);
    expect(() => checkOpSize("ui.toast", REALM_LIMITS.wordsBytes + 1)).toThrow(RealmLimitError);
    expect(() => checkOpSize("media.put", REALM_LIMITS.wordsBytes + 1)).not.toThrow();
    expect(() => checkOpSize("media.put", REALM_LIMITS.opBytes + 1)).toThrow(/at most 64 MB/);
  });
});

describe("HeldBudget: one app's account", () => {
  it("refuses bytes past what may wait at once, and takes them again once some are given back", () => {
    const budget = new HeldBudget({ heldBytes: 100, opsInFlight: 2, burstBytes: 1000 });
    const a = budget.take(60, "a");
    expect(() => budget.take(60, "b")).toThrow(RealmLimitError);
    expect(budget.heldBytes).toBe(60);
    a();
    a(); // twice is once
    expect(budget.heldBytes).toBe(0);
    budget.take(100, "c");
  });

  it("refuses ops past how many may be unanswered at once", () => {
    const budget = new HeldBudget({ heldBytes: 100, opsInFlight: 2, burstBytes: 1000 });
    const first = budget.begin();
    budget.begin();
    expect(() => budget.begin()).toThrow(/too many requests/);
    first();
    budget.begin();
    expect(budget.inFlight).toBe(2);
  });

  it("calls it a flood when more arrives in one window than a realm may send, and not across windows", () => {
    let t = 0;
    const budget = new HeldBudget({ heldBytes: 100, opsInFlight: 2, burstBytes: 1000 }, () => t, 50);
    expect(budget.arrived(600)).toBe(false);
    expect(budget.arrived(600)).toBe(true);
    t = 60;
    expect(budget.arrived(600)).toBe(false);
  });
});

describe("readBody: a download read for a sealed app", () => {
  it("is cut off at the limit — the rest is never read", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(MB);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk.slice());
      },
      cancel() {
        cancelled = true;
      },
    });
    const budget = new HeldBudget();
    await expect(readBody(new Response(endless), budget)).rejects.toThrow(/more than a shared app may read at once/);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(REALM_LIMITS.opBytes / MB + 8);
    expect(budget.heldBytes).toBe(0);
  }, 20000);

  it("refuses by the declared length before reading anything", async () => {
    const res = new Response("small", { headers: { "content-length": String(REALM_LIMITS.opBytes + 1) } });
    await expect(readBody(res, new HeldBudget())).rejects.toBeInstanceOf(RealmLimitError);
  });

  it("holds what it read to the app's account until it is handed over", async () => {
    const budget = new HeldBudget();
    const read = await readBody(new Response(new Uint8Array(3 * MB)), budget);
    expect(read.body.byteLength).toBe(3 * MB);
    expect(budget.heldBytes).toBe(3 * MB);
    read.release();
    expect(budget.heldBytes).toBe(0);
  });

  it("counts against what else the app has waiting", async () => {
    const budget = new HeldBudget({ heldBytes: 2 * MB, opsInFlight: 10, burstBytes: 100 * MB });
    await expect(readBody(new Response(new Uint8Array(3 * MB)), budget)).rejects.toThrow(/too much is waiting/);
    expect(budget.heldBytes).toBe(0);
  });
});

describe("in the realm: an op over a bound is an ordinary error, and the app carries on", () => {
  it("refuses words longer than a dialog's, as a RangeError the app can catch", async () => {
    const toasts: string[] = [];
    const { loaded, ctx, row, kills } = await setup(
      app(`big: async function(r, ctx){ try { await ctx.ui.confirm("x".repeat(${REALM_LIMITS.wordsBytes})); return "ALLOWED"; } catch (e) { return e.name + " | " + e.code + " | " + e.message; } },
           small: async function(r, ctx){ return String(await ctx.ui.confirm("Sure?")); }`),
      {},
      { ui: { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null } },
    );
    expect(await loaded.callComputed("n", "big", row, ctx)).toBe("RangeError | too-much | ctx.ui.confirm: this is more than a shared app may send at once (at most 4 MB)");
    expect(await loaded.callComputed("n", "small", row, ctx)).toBe("true");
    expect(kills).toEqual([]);
    loaded.dispose();
  });

  it("let go by the app, the refusal is a bug's trace to the person — never these words", async () => {
    const code = `globalThis.__potyroApp = { id: "r", name: "R", version: "1.0.0", schemaVersion: 1,
      entities: { n: { fields: { t: { type: "text" } }, actions: { big: async function(r, ctx){ await ctx.ui.confirm("x".repeat(${REALM_LIMITS.wordsBytes})); } } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const { loaded, ctx, row } = await setup(code);
    const failure = actionFailure(await loaded.callAction("n", "big", row, ctx).catch((e: unknown) => e));
    expect(failure.kind).toBe("broke");
    loaded.dispose();
  });

  it("keeps only so many questions to the person open at once", async () => {
    let open = 0;
    let most = 0;
    const confirm = async (): Promise<boolean> => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 150));
      open -= 1;
      return true;
    };
    const { loaded, ctx, row, kills } = await setup(
      app(`many: async function(r, ctx){ var all = await Promise.allSettled(Array.from({ length: ${REALM_LIMITS.questions + 9} }, function(){ return ctx.ui.confirm("Sure?"); }));
        return all.filter(function(a){ return a.status === "rejected"; }).length + " " + all.filter(function(a){ return a.status === "rejected"; })[0].reason.message; }`),
      {},
      { ui: { toast: () => {}, confirm, prompt: async () => null, pick: async () => null } },
    );
    expect(await loaded.callComputed("n", "many", row, ctx)).toBe(`9 too many questions are open at once (at most ${REALM_LIMITS.questions}): wait for an answer`);
    expect(most).toBe(REALM_LIMITS.questions);
    expect(kills).toEqual([]);
    loaded.dispose();
  });

  it("shows only so many progress bars at once", async () => {
    let bars = 0;
    const progress = () => (bars++, { update: () => {}, done: () => {} });
    const { loaded, ctx, row } = await setup(
      app(`bars: async function(r, ctx){ for (var i = 0; i < 40; i++) ctx.ui.progress("Working " + i); await ctx.storage.get("flush"); return "asked"; }`),
      {},
      { ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null, progress } },
    );
    expect(await loaded.callComputed("n", "bars", row, ctx)).toBe("asked");
    expect(bars).toBe(REALM_LIMITS.progressBars);
    loaded.dispose();
  });

  it("refuses what one call hands back past its bound; the next call is answered", async () => {
    const { loaded, ctx, row, kills } = await setup(app(`huge: function(){ return "x".repeat(${REALM_LIMITS.resultBytes}); }, plain: function(){ return 1; }`));
    const thrown = await loaded.callComputed("n", "huge", row, ctx).catch((e: unknown) => e);
    expect(String(thrown)).toMatch(/handed back more than a shared app's may \(at most 8 MB\)/);
    expect(actionFailure(thrown).kind).toBe("broke");
    expect(await loaded.callComputed("n", "plain", row, ctx)).toBe(1);
    expect(kills).toEqual([]);
    loaded.dispose();
  }, 15000);

  it("refuses a download larger than an app may read, and reads the next one", async () => {
    const code = `globalThis.__potyroApp = { id: "net", name: "Net", version: "1.0.0", schemaVersion: 1,
      permissions: { network: { hosts: ["api.example.org"] } },
      entities: { n: { fields: { t: { type: "text" } }, computed: {
        get: async function(r, ctx){ try { var res = await ctx.caps.network.fetch("https://api.example.org/" + r.t); return (await res.arrayBuffer()).byteLength; } catch (e) { return e.name + ": " + e.message; } }
      } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const caps = new FakeCapabilities();
    caps.network = {
      fetch: async (input: string) =>
        input.endsWith("/big") ? new Response("…", { headers: { "content-length": String(REALM_LIMITS.opBytes + 1) } }) : new Response(new Uint8Array(1000)),
    };
    const { loaded, ctx } = await setup(code, {}, { caps });
    const row = (t: string) => ({ id: "x", createdAt: "", updatedAt: "", t }) as never;
    expect(await loaded.callComputed("n", "get", row("big"), ctx)).toBe("RangeError: fetch: the answer is more than a shared app may read at once (at most 64 MB)");
    expect(await loaded.callComputed("n", "get", row("small"), ctx)).toBe(1000);
    loaded.dispose();
  });

  it("stops a realm that throws more bytes at the host in one go than any app sends", async () => {
    // Buffers handed over, not copied: 60 MB each costs the app nothing to send, five times over.
    const { loaded, ctx, row, kills } = await setup(
      app(`flood: async function(r, ctx){ ${STEAL}
        setTimeout(function(){ for (var i = 0; i < 6; i++) { var b = new ArrayBuffer(60 * 1048576); MP.call(port, { t: "op", id: 0, ctxId: 1, op: "log", args: [b] }, [b]); } }, 50);
        return "armed"; }`),
    );
    expect(await loaded.callComputed("n", "flood", row, ctx)).toBe("armed");
    await expect.poll(() => kills.length, { timeout: 5000 }).toBe(1);
    expect(kills[0]).toMatch(/more than 256 MB in 50 ms/);
    loaded.dispose();
  }, 15000);
});

describe("an app the watchdog keeps stopping rests until the person starts it again", () => {
  const SPINS = app(`spin: function(){ for(;;){} }, ok: function(){ return "fine"; }`);

  it("is started afresh after a stop, but not after several in a row", async () => {
    const { loaded, ctx, row, kills } = await setup(SPINS, { timeoutMs: 150 });
    const rest = loaded.rest!;
    let heard = 0;
    rest.subscribe(() => heard++);
    for (let i = 1; i <= REST_AFTER_STOPS; i++) {
      expect(rest.resting()).toBe(false);
      // Each call starts a fresh realm, as before — until the last one.
      await expect(loaded.callComputed("n", "spin", row, ctx)).rejects.toBeInstanceOf(HostFault);
      expect(kills).toHaveLength(i);
    }
    expect(rest.resting()).toBe(true);
    expect(heard).toBe(1);

    // At rest: refused at once as "stopped", and no realm is started for it.
    const before = liveThreads.size;
    const started = performance.now();
    const refused = await loaded.callComputed("n", "ok", row, ctx).catch((e: unknown) => e);
    expect(performance.now() - started).toBeLessThan(100);
    expect(actionFailure(refused)).toMatchObject({ kind: "stopped", why: "stopped" });
    expect(liveThreads.size).toBeLessThanOrEqual(before);
    expect(kills).toHaveLength(REST_AFTER_STOPS);

    // The person starts it again: it runs, and its count starts over.
    rest.wake();
    expect(rest.resting()).toBe(false);
    expect(heard).toBe(2);
    expect(await loaded.callComputed("n", "ok", row, ctx)).toBe("fine");
    await expect(loaded.callComputed("n", "spin", row, ctx)).rejects.toBeInstanceOf(HostFault);
    expect(rest.resting()).toBe(false);
    loaded.dispose();
  }, 30000);

  it("an app that cannot be started again counts too: it is not tried for ever", async () => {
    // Its top level runs away every time it is evaluated after the first: what an app that fills
    // memory as it loads does to each fresh realm.
    const until = Date.now() + 1200;
    const code = `if (Date.now() > ${until}) { for(;;){} }
      globalThis.__potyroApp = { id: "r", name: "R", version: "1.0.0", schemaVersion: 1,
      entities: { n: { fields: { t: { type: "text" } }, computed: { spin: function(){ for(;;){} }, ok: function(){ return "fine"; } } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const { loaded, ctx, row, kills } = await setup(code, { timeoutMs: 150, loadTimeoutMs: 400 });
    expect(await loaded.callComputed("n", "ok", row, ctx)).toBe("fine");
    await new Promise((r) => setTimeout(r, Math.max(0, until - Date.now()) + 50));
    await expect(loaded.callComputed("n", "spin", row, ctx)).rejects.toBeInstanceOf(HostFault); // stopped once
    expect(kills).toHaveLength(1);
    // Twice more it is started, and does not come up; several calls waiting on one start are one stop.
    for (let i = 0; i < REST_AFTER_STOPS - 1; i++) {
      expect(loaded.rest!.resting()).toBe(false);
      const waiting = await Promise.allSettled([loaded.callComputed("n", "ok", row, ctx), loaded.callComputed("n", "ok", row, ctx), loaded.callComputed("n", "ok", row, ctx)]);
      expect(waiting.map((w) => w.status)).toEqual(["rejected", "rejected", "rejected"]);
      expect(String((waiting[0] as PromiseRejectedResult).reason)).toMatch(/did not load within 400 ms/);
    }
    expect(loaded.rest!.resting()).toBe(true);
    const started = performance.now();
    expect(actionFailure(await loaded.callComputed("n", "ok", row, ctx).catch((e: unknown) => e))).toMatchObject({ kind: "stopped", why: "stopped" });
    expect(performance.now() - started).toBeLessThan(100);
    loaded.dispose();
  }, 20000);

  it("one stop is an accident: the app answers again by itself", async () => {
    const { loaded, ctx, row } = await setup(SPINS, { timeoutMs: 150 });
    await expect(loaded.callComputed("n", "spin", row, ctx)).rejects.toBeInstanceOf(HostFault);
    expect(loaded.rest!.resting()).toBe(false);
    expect(await loaded.callComputed("n", "ok", row, ctx)).toBe("fine");
    loaded.dispose();
  }, 15000);
});
