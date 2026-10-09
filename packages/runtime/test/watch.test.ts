// A watcher must never end up showing an older answer than one it has already shown.
//
// `watch` starts a fresh read on every change and emits whatever comes back. Reads are async and
// independent, so nothing made them finish in the order they started: a list re-read after the
// fourth item could land AFTER the re-read that followed the fifth, and the view would settle on
// four items — permanently, because the store has nothing left to notify about. On a synced list
// (where a write also wakes the record's own cojson subscription, so two reads are in flight at
// once) that is exactly what happened: items stopped appearing and only a reload brought them back.

import { describe, expect, it } from "vitest";
import { watchEntityQuery } from "../src/watch.js";
import type { RuntimeCore } from "../src/core.js";
import type { Resolved } from "potyro";

/** A core whose reads resolve in an order we choose, not the order they were asked for. */
function coreWithDelays(delays: number[]): { core: RuntimeCore; fire: () => void; answers: Resolved[][] } {
  const listeners = new Set<() => void>();
  let call = 0;
  const answers: Resolved[][] = [];
  const core = {
    store: {
      subscribe: (_entity: string, cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    onInvalidate: () => () => {},
    queryEntity: async (): Promise<Resolved[]> => {
      const n = call++;
      // The nth read answers with n+1 rows — a list that only ever grows.
      const rows = Array.from({ length: n + 1 }, (_, i) => ({ id: `r${i}` }) as unknown as Resolved);
      await new Promise((r) => setTimeout(r, delays[n] ?? 0));
      return rows;
    },
  } as unknown as RuntimeCore;
  return { core, fire: () => listeners.forEach((cb) => cb()), answers };
}

/** A core whose reads all take `ms`, counting how many were actually asked for. */
function countingCore(ms: number): { core: RuntimeCore; fire: () => void; reads: () => number } {
  const listeners = new Set<() => void>();
  let reads = 0;
  const core = {
    store: {
      subscribe: (_entity: string, cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    onInvalidate: () => () => {},
    queryEntity: async (): Promise<Resolved[]> => {
      reads++;
      await new Promise((r) => setTimeout(r, ms));
      return [];
    },
  } as unknown as RuntimeCore;
  return { core, fire: () => listeners.forEach((cb) => cb()), reads: () => reads };
}

describe("watching a query", () => {
  it("answers a burst of changes with one more read, not one per change", async () => {
    // Opening a synced list is a burst: every record the relay hands back notifies separately. One
    // full re-read per notification is how a 90-item list cost two thousand of them — each re-reading
    // every record — and why the app crawled on a phone while it caught up.
    const { core, fire, reads } = countingCore(20);
    const stop = watchEntityQuery(core, "item", undefined, () => {});

    for (let i = 0; i < 50; i++) fire();
    await new Promise((r) => setTimeout(r, 200));
    stop();

    // The first read, plus ONE covering everything that arrived while it ran.
    expect(reads()).toBeLessThanOrEqual(2);
  });


  it("keeps the newest answer when an older read finishes last", async () => {
    // Read 0 is slow, read 1 is quick: the four-row answer lands after the five-row one.
    const { core, fire } = coreWithDelays([60, 0]);
    const seen: number[] = [];
    const stop = watchEntityQuery(core, "item", undefined, (s) => seen.push(s.rows.length));

    fire();
    await new Promise((r) => setTimeout(r, 120));
    stop();

    // Two rows is what the second read found. The first read's one row must not overwrite it.
    expect(seen.at(-1)).toBe(2);
  });

  it("still emits every answer that is genuinely newer", async () => {
    const { core, fire } = coreWithDelays([0, 0, 0]);
    const seen: number[] = [];
    const stop = watchEntityQuery(core, "item", undefined, (s) => seen.push(s.rows.length));

    await new Promise((r) => setTimeout(r, 10));
    fire();
    await new Promise((r) => setTimeout(r, 10));
    fire();
    await new Promise((r) => setTimeout(r, 10));
    stop();

    expect(seen).toEqual([1, 2, 3]);
  });
});
