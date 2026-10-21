import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps } from "potyro";
import type { Ctx } from "potyro";
import app from "../countdowns.app.js";
import { dayKey, dayOf, daysFromNow, daysLeft, morningOf, split } from "../dates.js";
import { W } from "../words.js";

const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;
/** A Tuesday at a quarter past three: the hour must never change a count of days. */
const TODAY = new Date(2026, 9, 20, 15, 15);

describe("Countdowns", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps an event as what, when (a day) and an emoji, and counts its days", () => {
    const fields = app.entities.event!.fields;
    expect(fields.title).toMatchObject({ type: "text", required: true });
    expect(fields.date).toMatchObject({ type: "datetime", precision: "day", required: true });
    expect(fields.icon).toMatchObject({ type: "text" });
    const computed = app.entities.event!.computed!.daysLeft as { value: (e: unknown, ctx: Ctx) => number };
    const ctx = { today: () => TODAY } as Ctx;
    expect(computed.value({ date: "2026-11-01" }, ctx)).toBe(12);
    expect(computed.value({ date: "2026-10-20" }, ctx)).toBe(0);
    expect(computed.value({ date: "nonsense" }, ctx)).toBe(0);
  });

  it("opens on the countdown screen, adds with the plus, and keeps a page for the event itself", () => {
    const [soon, event] = app.pages;
    expect(soon!.view.type).toBe("custom");
    expect(soon!.add).toBe(0);
    expect(soon!.actions![0]!.run).toBeTypeOf("function");
    expect(event).toMatchObject({ hidden: true, view: { type: "detail", entity: "event", param: "eventId" } });
    expect(app.demo).toBeTypeOf("function");
    expect(app.tile).toBeTypeOf("function");
  });
});

describe("counting days", () => {
  it("counts whole calendar days, whatever the hour", () => {
    expect(daysLeft("2026-10-21", TODAY)).toBe(1);
    expect(daysLeft("2026-10-20", TODAY)).toBe(0);
    expect(daysLeft("2026-10-19", TODAY)).toBe(-1);
    expect(daysLeft("2027-01-01", new Date(2026, 9, 20, 23, 59))).toBe(73);
    expect(daysLeft(new Date(2026, 9, 25, 0, 30), TODAY)).toBe(5);
  });

  it("reads a stored day, a full timestamp, or nothing", () => {
    expect(dayKey(TODAY)).toBe("2026-10-20");
    expect(dayOf("2026-10-25T22:00:00.000Z")?.getDate()).toBe(25);
    expect(dayOf("")).toBeNull();
    expect(daysLeft(null, TODAY)).toBeNull();
    expect(daysFromNow(TODAY, 12)).toBe("2026-11-01");
    expect(daysFromNow(TODAY, -18)).toBe("2026-10-02");
  });

  it("splits what is to come, soonest first, from what has passed, most recent first", () => {
    const { upcoming, past } = split(
      [
        { id: "a", date: "2026-11-01" },
        { id: "b", date: "2026-10-20" },
        { id: "c", date: "2026-09-01" },
        { id: "d", date: "2026-10-15" },
        { id: "e", date: "bad" },
      ],
      TODAY,
    );
    expect(upcoming.map((r) => [r.id, r.left])).toEqual([
      ["b", 0],
      ["a", 12],
    ]);
    expect(past.map((r) => [r.id, r.left])).toEqual([
      ["d", -5],
      ["c", -49],
    ]);
  });

  it("reminds at nine on the morning of the day", () => {
    const at = morningOf("2026-11-01")!;
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 10, 1, 9, 0]);
    expect(morningOf("x")).toBeNull();
  });
});

describe("the tile and the demo", () => {
  function fakeCtx(rows: Array<Record<string, unknown>>) {
    const created: Array<Record<string, unknown>> = [];
    const ctx = {
      today: () => TODAY,
      now: () => TODAY,
      t: (w: Record<string, string>, vars?: Record<string, unknown>) => {
        let s = w.en!;
        for (const [k, v] of Object.entries(vars ?? {})) {
          s = s.replace(new RegExp(`\\{${k}, plural,[^}]*\\}\\}?`), String(v)).replace(`{${k}}`, String(v));
        }
        return s;
      },
      query: async () => rows,
      create: async (_e: string, data: Record<string, unknown>) => {
        created.push(data);
        return { id: `r${created.length}`, ...data };
      },
    } as unknown as Ctx;
    return { ctx, created };
  }

  it("the tile counts the week and names the next event", async () => {
    const { ctx } = fakeCtx([
      { id: "1", title: "Lisbon trip", icon: "✈️", date: "2026-11-01" },
      { id: "2", title: "Dentist", date: "2026-10-23" },
      { id: "3", title: "Moved in", date: "2026-10-02" },
    ]);
    const tile = await app.tile!(ctx);
    expect(tile.count).toBe(1);
    expect(tile.lines).toHaveLength(1);
    expect(tile.lines![0]).toMatch(/^✈️ Lisbon trip · /);
    expect(String(tile.title)).toContain("Dentist");
  });

  it("the tile says so when nothing is coming", async () => {
    const { ctx } = fakeCtx([{ id: "3", title: "Moved in", date: "2026-10-02" }]);
    expect(await app.tile!(ctx)).toEqual({ title: "Nothing soon" });
  });

  it("the demo writes four events around today, one of them past", async () => {
    const { ctx, created } = fakeCtx([]);
    await app.demo!(ctx);
    expect(created).toHaveLength(4);
    const lefts = created.map((e) => daysLeft(e.date, TODAY));
    expect(lefts.filter((n) => n! > 0)).toHaveLength(3);
    expect(lefts.filter((n) => n! < 0)).toHaveLength(1);
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual([...LANGS]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("says everything on its screens in every language, with the same placeholders", () => {
    // The arguments a message takes, each once, with the words inside its plural branches left out.
    const vars = (s: string) => [...new Set([...s.replace(/(=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\}/g, "").matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]))].sort();
    for (const [key, words] of Object.entries(W)) {
      const map = words as Record<string, string>;
      for (const l of LANGS) expect(map[l], `${key}.${l}`).toBeTruthy();
      for (const l of LANGS) expect(vars(map[l]!), `${key}.${l}`).toEqual(vars(map.en!));
    }
  });
});
