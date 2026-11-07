// @vitest-environment happy-dom
//
// Demand counts (#118): once a month per event per device, only to a relay that is there, never when
// the person turned counts off, and nothing in the request that could tell one device from another.

import { beforeEach, describe, expect, it } from "vitest";
import { countOnce, countedThisMonth, countsOn, setCountsOn, wantedPlan } from "../src/demand-counts.js";
import { deviceId } from "../src/device-id.js";

type Sent = { url: string; init: RequestInit };

function wire(): { sent: Sent[]; fetch: typeof fetch } {
  const sent: Sent[] = [];
  const fetchFake = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    sent.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return { sent, fetch: fetchFake };
}

const OCT = Date.UTC(2026, 9, 30);
const NOV = Date.UTC(2026, 10, 2);
const there = async (): Promise<boolean> => true;

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("counts", () => {
  it("go once a month per event, and again the next month", async () => {
    const { sent, fetch } = wire();
    expect(await countOnce("want-plan", { fetch, now: () => OCT, relayThere: there })).toBe("sent");
    expect(await countOnce("want-plan", { fetch, now: () => OCT, relayThere: there })).toBe("already");
    expect(await countOnce("own-key", { fetch, now: () => OCT, relayThere: there })).toBe("sent");
    expect(await countOnce("want-plan", { fetch, now: () => NOV, relayThere: there })).toBe("sent");
    expect(sent.map((s) => s.init.body)).toEqual(['{"event":"want-plan"}', '{"event":"own-key"}', '{"event":"want-plan"}']);
    expect(sent.every((s) => s.url.endsWith("/ai/count"))).toBe(true);
  });

  it("remember that this device asked for a plan, across months — so it can be told when one exists (#118)", async () => {
    const { fetch } = wire();
    expect(wantedPlan()).toBe(false);
    await countOnce("own-key", { fetch, now: () => OCT, relayThere: there });
    expect(wantedPlan()).toBe(false);
    await countOnce("want-plan", { fetch, now: () => OCT, relayThere: there });
    expect(wantedPlan()).toBe(true);
    expect(countedThisMonth("want-plan", NOV)).toBe(false); // the month's count moves on; the wish stays
    expect(wantedPlan()).toBe(true);
  });

  it("carry the event and nothing else: no device id, no cookies, no referrer, one plain header", async () => {
    const { sent, fetch } = wire();
    const device = deviceId();
    await countOnce("own-key", { fetch, now: () => OCT, relayThere: there });
    const { url, init } = sent[0]!;
    expect(JSON.parse(String(init.body))).toEqual({ event: "own-key" });
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(`${url} ${JSON.stringify(init)}`).not.toContain(device);
    // What this device keeps about it: the event and the month.
    expect(Object.keys({ ...localStorage }).filter((k) => k.startsWith("potyro:counted:"))).toEqual(["potyro:counted:own-key:2026-10"]);
  });

  it("are not sent when the person turned them off in You", async () => {
    const { sent, fetch } = wire();
    expect(countsOn()).toBe(true);
    setCountsOn(false);
    expect(await countOnce("want-plan", { fetch, now: () => OCT, relayThere: there })).toBe("off");
    expect(await countOnce("own-key", { fetch, now: () => OCT, relayThere: there })).toBe("off");
    expect(sent).toHaveLength(0);
    setCountsOn(true);
    expect(await countOnce("want-plan", { fetch, now: () => OCT, relayThere: there })).toBe("sent");
  });

  it("go nowhere on a site without the relay, and are tried again later", async () => {
    const { sent, fetch } = wire();
    expect(await countOnce("own-key", { fetch, now: () => OCT, relayThere: async () => false })).toBe("no-relay");
    expect(sent).toHaveLength(0);
    expect(await countOnce("own-key", { fetch, now: () => OCT, relayThere: there })).toBe("sent");
  });

  it("an unreachable relay is tried again the next time", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await countOnce("own-key", { fetch: failing, now: () => OCT, relayThere: there })).toBe("failed");
    const { sent, fetch } = wire();
    expect(await countOnce("own-key", { fetch, now: () => OCT, relayThere: there })).toBe("sent");
    expect(sent).toHaveLength(1);
  });
});
