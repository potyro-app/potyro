import { describe, expect, it } from "vitest";
import { createCounts } from "../src/counts.ts";
import { memoryLedger, persistentLedger, type LedgerState } from "../src/ledger.ts";
import { createAiRelay } from "../src/relay.ts";
import { AI_FORMAT } from "../src/request.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const post = (event: unknown, ip = "1.2.3.4") => ({ method: "POST", body: JSON.stringify({ event }), ip });

describe("the counts route", () => {
  it("counts each event, and reports months of numbers and nothing else", () => {
    const counts = createCounts({ now: () => NOW });
    for (const e of ["exhausted", "own-key", "want-plan", "visit"]) expect(counts.handle(post(e))).toEqual({ status: 200, body: { ok: true } });
    counts.handle(post("visit", "5.6.7.8"));
    expect(counts.handle({ method: "GET", body: "", ip: "9.9.9.9" })).toEqual({
      status: 200,
      body: { ok: true, months: { "2026-10": { exhausted: 1, "own-key": 1, "want-plan": 1, visit: 2 } } },
    });
  });

  it("counts an event once a day per address, and answers a repeat the same way without counting it", () => {
    let now = NOW;
    const ledger = memoryLedger();
    const counts = createCounts({ now: () => now, ledger });
    expect(counts.handle(post("want-plan"))).toEqual({ status: 200, body: { ok: true } });
    expect(counts.handle(post("want-plan"))).toEqual({ status: 200, body: { ok: true } });
    expect(ledger.events()["2026-10"]).toEqual({ "want-plan": 1 });
    now += 25 * 60 * 60 * 1000;
    counts.handle(post("want-plan"));
    expect(ledger.events()["2026-10"]).toEqual({ "want-plan": 2 });
  });

  it("limits how often one address may post in a day", () => {
    const counts = createCounts({ now: () => NOW, perAddressDay: 3 });
    for (let i = 0; i < 3; i++) counts.handle(post("visit"));
    expect(counts.handle(post("visit"))).toEqual({ status: 429, body: { ok: false, error: "busy" } });
    expect(counts.handle(post("visit", "5.6.7.8")).status).toBe(200);
  });

  it("refuses what is not one known event, and anything carried with it", () => {
    const counts = createCounts({ now: () => NOW });
    expect(counts.handle(post("bought")).status).toBe(400);
    expect(counts.handle({ method: "POST", body: "{nope", ip: "1" }).status).toBe(400);
    expect(counts.handle({ method: "POST", body: JSON.stringify({ event: "visit", device: "device-0001" }), ip: "1" }).status).toBe(400);
    expect(counts.handle({ method: "DELETE", body: "", ip: "1" }).status).toBe(405);
  });

  it("counts a device's first crossing of its /complete allowance as exhausted, once a month", async () => {
    const ledger = memoryLedger();
    const relay = createAiRelay({ upstream: async () => ({ ok: true, text: "x", cost: 0 }), now: () => NOW, ledger, limits: { perDeviceMonth: 2 } });
    const payload = { format: AI_FORMAT, device: "device-0001", system: "s", parts: [{ type: "text", text: "t" }], maxTokens: 10 };
    const req = { method: "POST", path: "/complete", body: JSON.stringify(payload), ip: "1.2.3.4" };
    await relay.handle(req);
    expect(ledger.events()["2026-10"]).toBeUndefined();
    await relay.handle(req);
    expect(ledger.events()["2026-10"]).toEqual({ exhausted: 1 });
    expect((await relay.handle(req)).status).toBe(429);
    expect(ledger.events()["2026-10"]).toEqual({ exhausted: 1 });
  });
});

describe("the ledger file", () => {
  it("still loads the shape written before the chat route, with nothing else in it", () => {
    const old = { month: "2026-10", spent: 1.25, devices: { "device-0001": 7 } };
    const ledger = persistentLedger(old as LedgerState, () => {});
    expect(ledger.spent("2026-10")).toBe(1.25);
    expect(ledger.count("2026-10", "device-0001")).toBe(7);
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBe(0);
    expect(ledger.events()).toEqual({});
  });

  it("keeps chat spend, exhausted devices and counts across a restart, and the counts across a new month", () => {
    let saved: LedgerState | null = null;
    const one = persistentLedger(null, (s) => (saved = structuredClone(s)));
    one.debit("2026-10", "device-0001", 0.25);
    one.markExhausted("2026-10", "device-0001");
    one.addEvent("2026-10", "visit");
    const two = persistentLedger(saved, () => {});
    expect(two.deviceSpent("2026-10", "device-0001")).toBe(0.25);
    expect(two.spent("2026-10")).toBe(0.25);
    expect(two.markExhausted("2026-10", "device-0001")).toBe(false);
    expect(two.spent("2026-11")).toBe(0);
    expect(two.deviceSpent("2026-11", "device-0001")).toBe(0);
    expect(two.events()).toEqual({ "2026-10": { exhausted: 1, visit: 1 } });
  });

  it("refuses a file whose new parts are damaged", () => {
    expect(() => persistentLedger({ month: "2026-10", spent: 0, devices: {}, events: [] } as never, () => {})).toThrow(/not a ledger/);
    expect(() => persistentLedger({ month: "2026-10", spent: 0, devices: {}, deviceUsd: 3 } as never, () => {})).toThrow(/not a ledger/);
  });
});
