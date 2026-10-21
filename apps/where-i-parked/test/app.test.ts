import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps } from "potyro";
import type { Ctx, Resolved } from "potyro";
import app, { currentSpot } from "../where-i-parked.app.js";
import { W } from "../words.js";

const source = readFileSync(new URL("../where-i-parked.app.tsx", import.meta.url), "utf8");
const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;

/** Enough of ctx for the app's logic: records in memory, where the device says it is, what it said. */
function fakeCtx(opts: { here?: { lat: number; lng: number } | null; now?: Date } = {}) {
  const records: Array<Record<string, unknown> & { id: string }> = [];
  const toasts: unknown[] = [];
  const timers: Array<{ id?: string; seconds: number }> = [];
  const now = opts.now ?? new Date("2026-10-21T10:00:00Z");
  const ctx = {
    now: () => now,
    t: (w: { en?: string } | string, vars?: Record<string, unknown>) => {
      let s = typeof w === "string" ? w : (w.en ?? "");
      for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    format: { relative: () => "40 minutes ago", date: () => "10:00", number: (n: number) => String(n) },
    caps: {
      geo: opts.here === null ? undefined : { current: async () => opts.here ?? { lat: 52.5, lng: 13.4 } },
      haptics: { vibrate: async () => undefined },
    },
    media: { put: async () => ({ key: "k", mime: "image/jpeg" }), url: async () => "blob:x" },
    query: async (_e: string) => records as Resolved[],
    create: async (_e: string, data: Record<string, unknown>) => {
      const r = { id: `s${records.length + 1}`, ...data };
      records.push(r);
      return r as Resolved;
    },
    patch: async (_e: string, id: string, data: Record<string, unknown>) => Object.assign(records.find((r) => r.id === id)!, data) as Resolved,
    ui: {
      toast: (m: unknown) => void toasts.push(m),
      timers: async () => [],
      timer: async (o: { id?: string; seconds: number }) => void timers.push(o),
    },
  };
  return { ctx: ctx as unknown as Ctx, records, toasts, timers };
}

describe("Where I parked", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("reaches the device's position and camera only through ctx (CLAUDE.md rule 2)", () => {
    expect(app.permissions).toMatchObject({ geo: true, camera: true });
    expect(source).toContain("ctx.caps.geo");
    expect(source).toContain("ctx.caps.camera");
    expect(source).not.toMatch(/navigator\.(geolocation|mediaDevices)|getCurrentPosition|getUserMedia/);
  });

  it("the car is the newest spot nobody has found again", () => {
    const spots = [
      { id: "a", at: "2026-10-20T09:00:00Z", found: "2026-10-20T11:00:00Z" },
      { id: "b", at: "2026-10-21T09:00:00Z" },
      { id: "c", at: "2026-10-19T09:00:00Z" },
    ] as unknown as Resolved[];
    expect(currentSpot(spots)?.id).toBe("b");
    expect(currentSpot([spots[0]!])).toBeUndefined();
  });

  it("the demo opens on a parked car, with two spots found again", async () => {
    const { ctx, records } = fakeCtx();
    await app.demo!(ctx);
    expect(records).toHaveLength(3);
    const current = currentSpot(records as Resolved[]);
    expect(current?.note).toBe("Level 2, near the stairs");
    expect(records.filter((r) => r.found)).toHaveLength(2);
  });

  it("Found it stamps the spot into the history", async () => {
    const { ctx, records, toasts } = fakeCtx();
    await app.demo!(ctx);
    const current = currentSpot(records as Resolved[])!;
    const found = app.entities.spot!.actions!.found as { run: (r: Resolved, c: Ctx) => Promise<void> };
    await found.run(current, ctx);
    expect(records.find((r) => r.id === current.id)!.found).toBe("2026-10-21T10:00:00.000Z");
    expect(currentSpot(records as Resolved[])).toBeUndefined();
    expect(toasts).toEqual([W.foundToast]);
  });

  it("says on the tile whether a car is parked", async () => {
    const empty = fakeCtx();
    expect(await app.tile!(empty.ctx)).toEqual({ title: W.tileNone });
    const parked = fakeCtx();
    await app.demo!(parked.ctx);
    const tile = await app.tile!(parked.ctx);
    expect(tile.count).toBe(1);
    expect(tile.title).toBe("Parked 40 minutes ago");
    expect(tile.lines).toEqual(["Level 2, near the stairs"]);
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual([...LANGS]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("says everything on its screens in every language, with the same {placeholders}", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const [key, words] of Object.entries(W)) {
      const map = words as Record<string, string>;
      for (const l of LANGS) {
        expect(map[l], `${key}.${l}`).toBeTruthy();
        expect(vars(map[l]!), `${key}.${l}`).toEqual(vars(map.en!));
      }
    }
  });
});
