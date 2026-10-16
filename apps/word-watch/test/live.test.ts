// The connection keeper (live.ts): hello after every connect, back-off after a drop, picking up after
// the background, stopping when the person left or said no — with timers the test runs by hand.
import { describe, expect, it } from "vitest";
import { createLive, FIRST_WAIT_MS, HIDDEN_RETRY_MS, MAX_WAIT_MS, type LiveState } from "../live.js";
import { fakeCtx, settle } from "./fake.js";

function harness() {
  const f = fakeCtx();
  const pending: Array<{ fn: () => void; ms: number }> = [];
  const states: Array<[LiveState, number | undefined]> = [];
  const texts: string[] = [];
  const live = createLive(
    { url: "wss://feed.test/live", hello: () => ["sub"], onText: (t) => void texts.push(t), onState: (s, _c, ms) => void states.push([s, ms]) },
    {
      set: (fn, ms) => {
        const t = { fn, ms };
        pending.push(t);
        return t;
      },
      clear: (t) => {
        const i = pending.indexOf(t as never);
        if (i >= 0) pending.splice(i, 1);
      },
    },
  );
  /** Run the next timer; returns its delay. */
  const tick = async (): Promise<number> => {
    const t = pending.shift();
    if (!t) throw new Error("no timer waiting");
    t.fn();
    await settle();
    return t.ms;
  };
  return { f, live, pending, states, texts, tick };
}

describe("keeping a live connection", () => {
  it("opens, says hello, hands text on, and says it is live", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    await settle();
    expect(h.f.opened).toEqual(["wss://feed.test/live"]);
    expect(h.f.sockets[0]!.sent).toEqual(["sub"]);
    h.f.sockets[0]!.push("hello");
    expect(h.texts).toEqual(["hello"]);
    expect(h.live.state).toBe("live");
    expect(h.states.map((s) => s[0])).toEqual(["connecting", "live"]);
  });

  it("after a drop, tries again 1 s, 2 s, 4 s … apart, at most 30 s — and says hello again when back", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    await settle();
    h.f.answers.push("unreachable", "unreachable", "unreachable", "unreachable", "unreachable", "unreachable", "unreachable");
    h.f.sockets[0]!.end("network");
    await settle();
    expect(h.live.state).toBe("retrying");
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) waits.push(await h.tick());
    // Jitter is ±15 %: each wait is near its step.
    const steps = [1, 2, 4, 8, 16, 30, 30, 30].map((s) => s * 1000);
    waits.forEach((ms, i) => expect(Math.abs(ms - steps[i]!) / steps[i]!).toBeLessThanOrEqual(0.15));
    expect(Math.max(...waits)).toBeLessThanOrEqual(MAX_WAIT_MS * 1.15);
    expect(h.live.state).toBe("live");
    expect(h.f.sockets).toHaveLength(2);
    expect(h.f.sockets[1]!.sent).toEqual(["sub"]);
    // Live again: the next drop starts from the first wait.
    h.f.sockets[1]!.end("server", 1001);
    await settle();
    expect(Math.abs(h.pending[0]!.ms - FIRST_WAIT_MS) / FIRST_WAIT_MS).toBeLessThanOrEqual(0.15);
  });

  it("closed for the background: paused, retried every few seconds while still hidden, live again on return", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    await settle();
    h.f.answers.push("hidden", "hidden");
    h.f.sockets[0]!.end("hidden", 1001);
    await settle();
    expect(h.live.state).toBe("paused");
    expect(await h.tick()).toBe(HIDDEN_RETRY_MS);
    expect(await h.tick()).toBe(HIDDEN_RETRY_MS);
    expect(h.live.state).toBe("paused");
    // Back: the next try opens.
    expect(await h.tick()).toBe(HIDDEN_RETRY_MS);
    expect(h.live.state).toBe("live");
    // "connecting" is not said for every try while hidden.
    expect(h.states.map((s) => s[0]).filter((s) => s === "connecting")).toHaveLength(1);
  });

  it("stops for good when the person leaves the app, and when they said Not now", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    await settle();
    h.f.sockets[0]!.end("left", 1001);
    await settle();
    expect(h.pending).toHaveLength(0);
    expect(h.live.state).toBe("off");

    h.f.answers.push("denied");
    h.live.start(h.f.ctx);
    await settle();
    expect(h.live.state).toBe("denied");
    expect(h.pending).toHaveLength(0);

    h.f.answers.push("not-allowed-host");
    h.live.start(h.f.ctx);
    await settle();
    expect(h.live.state).toBe("blocked");
    expect(h.pending).toHaveLength(0);
  });

  it("offline: says so and keeps trying, more slowly each time", async () => {
    const h = harness();
    h.f.answers.push("offline", "offline");
    h.live.start(h.f.ctx);
    await settle();
    expect(h.live.state).toBe("offline");
    const a = await h.tick();
    const b = await h.tick();
    expect(b).toBeGreaterThan(a);
    expect(h.live.state).toBe("live");
  });

  it("stop closes it and cancels a waiting retry; a start during an open does not open two", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    h.live.start(h.f.ctx);
    await settle();
    expect(h.f.sockets).toHaveLength(1);
    h.live.stop();
    expect(h.f.sockets[0]!.readyState).toBe("closed");
    expect(h.live.state).toBe("off");
    h.f.answers.push("unreachable");
    h.live.start(h.f.ctx);
    await settle();
    expect(h.pending).toHaveLength(1);
    h.live.stop();
    expect(h.pending).toHaveLength(0);
  });

  it("stopped and started again while the first open is still on its way: one connection, the second", async () => {
    const h = harness();
    h.live.start(h.f.ctx);
    h.live.stop();
    h.live.start(h.f.ctx);
    await settle();
    expect(h.f.sockets.filter((s) => s.readyState === "open")).toHaveLength(1);
    expect(h.live.state).toBe("live");
  });

  it("without timers (the QuickJS fallback) a drop is not retried by itself: it says so and waits for the person", async () => {
    const f = fakeCtx();
    const states: LiveState[] = [];
    const live = createLive({ url: "wss://feed.test/", onText: () => {}, onState: (s) => void states.push(s) }, { set: null, clear: () => {} });
    live.start(f.ctx);
    await settle();
    f.sockets[0]!.end("network");
    await settle();
    expect(live.state).toBe("retrying");
    expect(f.opened).toHaveLength(1);
    // The person starts it again.
    live.start(f.ctx);
    await settle();
    expect(live.state).toBe("live");
    expect(f.opened).toHaveLength(2);
  });
});
