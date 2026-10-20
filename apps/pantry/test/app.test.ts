// The app's shape, its words, and every path through "Add from a photo" and "What can I cook?"
// against a scripted ctx: a photo read into checked items, a receipt, a blurry photo, no food, no AI,
// an AI that fails, the sample, typing it in, and the item and idea actions.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps, type Ctx, type Resolved } from "potyro";
import app from "../pantry.app.js";
import { COOK_INSTRUCTIONS, cookText, IDEAS, keepReal, MAX_SENT } from "../cook.js";
import { instructions, SHELF, toDrafts, type ShelfAnswer } from "../reading.js";
import { sampleReading, sampleShelfSvg } from "../sample.js";
import { expiryText, reminderText, reminderTitle, rowText } from "../words.js";
import { LANGUAGES, sayIn } from "./say.js";

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "vitest.config.ts");
const source = sources.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

/** Thu 15 Oct 2026, 10:00 in Warsaw. */
const NOW = new Date(2026, 9, 15, 10, 0);
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d);

const line = (l: Partial<ShelfAnswer["items"][number]>): ShelfAnswer["items"][number] => ({ name: "Milk", category: "dairy", where: null, bestBefore: null, amount: null, ...l });

interface Script {
  answer?: ShelfAnswer | Error;
  ideas?: unknown;
  sheets?: unknown[];
  form?: (initial: Record<string, unknown>, title: string) => Record<string, unknown> | null;
  ai?: boolean;
  rows?: Array<Record<string, unknown>>;
  language?: string;
}

function fakeCtx(s: Script = {}) {
  const say = sayIn(s.language ?? "en");
  const sheets = [...(s.sheets ?? [])];
  const log = {
    asked: [] as Array<Record<string, unknown>>,
    sheets: [] as Array<{ title: string; items: Array<{ id: unknown; label: string; detail?: string }> }>,
    forms: [] as Array<{ title: string; initial: Record<string, unknown>; fields: Record<string, unknown> }>,
    created: [] as Array<{ entity: string; data: Record<string, unknown> }>,
    patched: [] as Array<{ id: string; data: Record<string, unknown> }>,
    toasts: [] as string[],
    progress: [] as string[],
    navigated: [] as string[],
    media: [] as Blob[],
    shared: [] as Array<{ title?: string; text?: string }>,
    captured: [] as unknown[],
  };
  const w = (x: unknown) => (typeof x === "string" ? x : say.t(x as never));
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const ctx = {
    ...say,
    now: () => NOW,
    today: () => day(10, 15),
    caps: {
      ...(s.ai === false
        ? {}
        : {
            ai: {
              extract: async (req: Record<string, unknown>) => {
                log.asked.push(req);
                if (s.answer instanceof Error) throw s.answer;
                if (req.schema === IDEAS) return s.ideas ?? { ideas: [] };
                return s.answer ?? { kind: "food", boughtOn: null, items: [line({})] };
              },
              ask: async () => "",
            },
          }),
      camera: { capture: async (o: unknown) => (log.captured.push(o), photo) },
    },
    query: async () => (s.rows ?? []) as Resolved[],
    media: { put: async (b: Blob) => (log.media.push(b), { key: `m${log.media.length}`, mime: b.type }), url: async () => "" },
    ui: {
      sheet: async (o: { title: unknown; items: Array<{ id: unknown; label: unknown; detail?: unknown }> }) => {
        log.sheets.push({ title: w(o.title), items: o.items.map((i) => ({ id: i.id, label: w(i.label), ...(i.detail ? { detail: w(i.detail) } : {}) })) });
        return sheets.length ? sheets.shift() : null;
      },
      form: async (o: { title: unknown; initial: Record<string, unknown>; fields: Record<string, unknown> }) => {
        const title = w(o.title);
        log.forms.push({ title, initial: o.initial, fields: o.fields });
        return s.form ? s.form(o.initial, title) : o.initial;
      },
      toast: (m: unknown) => void log.toasts.push(w(m)),
      progress: (m: unknown) => (log.progress.push(w(m)), { update: () => {}, done: () => {} }),
      share: async (d: { title?: string; text?: string }) => (log.shared.push(d), true),
    },
    create: async (entity: string, data: Record<string, unknown>) => {
      log.created.push({ entity, data });
      return { id: `r${log.created.length}`, ...data } as Resolved;
    },
    patch: async (_e: string, id: string, data: Record<string, unknown>) => {
      log.patched.push({ id, data });
      return { id, ...data } as Resolved;
    },
    navigate: (page: string) => void log.navigated.push(page),
  } as unknown as Ctx;
  return { ctx, log, photo, say };
}

const kitchen = app.pages.find((p) => p.id === "kitchen")!;
const addFromPhoto = kitchen.actions![0]!.run;
const cook = kitchen.actions![1]!.run;
const action = (entity: "item" | "idea", key: string) => {
  const a = app.entities[entity]!.actions![key]!;
  return typeof a === "function" ? a : a.run;
};
const items = (log: ReturnType<typeof fakeCtx>["log"]) => log.created.filter((c) => c.entity === "item").map((c) => c.data);

describe("What's in my kitchen — the app", () => {
  it("is a valid app that reaches the AI, the camera and the share sheet only through ctx", () => {
    expect(isPotyroApp(app)).toBe(true);
    // defineApp has already checked the structure (it throws on a bad one); these are the rest.
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ ai: true, camera: true, notifications: true });
    expect(source).toContain("ctx.caps.ai");
    expect(source).not.toMatch(/fetch\(|openrouter|navigator\.|document\.|window\./i);
  });

  it("uses only built-in views, so it works for a friend who runs it sealed", () => {
    for (const p of app.pages) {
      const views = p.layout ? p.layout.items.map((i) => i.view) : [p.view];
      for (const v of views) expect(v.type, p.id).not.toBe("custom");
    }
  });

  it("groups the kitchen by a computed key (not a function), which a sealed copy reads off the row", () => {
    const view = kitchen.view as { group?: unknown };
    expect(view.group).toBe("freshness");
    expect(app.entities.item!.computed!.freshness).toBeDefined();
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
    expect(maps.length).toBeGreaterThan(100);
    for (const map of maps) for (const l of ['"pt-BR":', " de:", " es:", " pl:", " it:"]) expect(map, map.slice(0, 80)).toContain(l);
  });

  it("tells the model today's date, to read a date only when printed, and asks nothing about the person", () => {
    const text = instructions(NOW);
    expect(text).toContain("Today is 2026-10-15");
    expect(text).toMatch(/ONLY when a best-before, use-by or expiry date is printed/);
    expect(Object.keys(SHELF.items[0])).toEqual(["name", "category", "where", "bestBefore", "amount"]);
  });
});

describe("reading a photo into items", () => {
  it("keeps a printed date, guesses a missing one from the kind and place, and says which is which", () => {
    const drafts = toDrafts(
      {
        kind: "food",
        boughtOn: null,
        items: [line({ bestBefore: "2026-10-18", amount: "1 L" }), line({ name: "Spinach", category: "produce" }), line({ name: "Peas", category: "frozen", where: "fridge" }), line({ name: "  " })],
      },
      NOW,
    );
    expect(drafts).toEqual([
      { name: "Milk", expires: day(10, 18), guessed: false, category: "dairy", where: "fridge", amount: "1 L" },
      { name: "Spinach", expires: day(10, 20), guessed: true, category: "produce", where: "fridge" },
      // Frozen food lives in the freezer, whatever the photo seemed to show.
      { name: "Peas", expires: day(1, 13, 2027), guessed: true, category: "frozen", where: "freezer" },
    ]);
  });

  it("counts a receipt's guesses from the day it was printed, when that is recent", () => {
    const [d] = toDrafts({ kind: "receipt", boughtOn: "2026-10-12", items: [line({ name: "Chicken", category: "meat" })] }, NOW);
    expect(d!.expires).toEqual(day(10, 14));
    // A receipt from last year is not "bought on": today is.
    const [old] = toDrafts({ kind: "receipt", boughtOn: "2025-10-12", items: [line({ name: "Chicken", category: "meat" })] }, NOW);
    expect(old!.expires).toEqual(day(10, 17));
  });
});

describe("Add from a photo", () => {
  it("photo → reading → checked items, saved with the photo; the soonest named; Kitchen opened", async () => {
    const answer: ShelfAnswer = {
      kind: "food",
      boughtOn: null,
      items: [line({ bestBefore: "2026-10-18" }), line({ name: "Chicken thighs", category: "meat", bestBefore: "2026-10-16" }), line({ name: "Spinach", category: "produce" })],
    };
    const { ctx, log, photo } = fakeCtx({
      answer,
      sheets: ["camera"],
      // The person renames one and removes another before saving.
      form: (initial) => {
        const rows = (initial.items as Array<Record<string, unknown>>).filter((r) => r.name !== "Spinach");
        return { items: rows.map((r) => (r.name === "Milk" ? { ...r, name: "Oat milk" } : r)) };
      },
    });
    await addFromPhoto(ctx);
    expect(log.captured).toEqual([{ source: "camera" }]);
    // What went to the AI: the photo and the app's instructions — no record.
    expect(Object.keys(log.asked[0]!).sort()).toEqual(["image", "instructions", "schema"]);
    expect(log.asked[0]!.image).toBe(photo);
    expect(log.forms[0]!.title).toBe("Check what was found");
    expect(log.forms[0]!.initial.items).toEqual([
      { name: "Milk", expires: day(10, 18), guessed: false, category: "dairy", where: "fridge" },
      { name: "Chicken thighs", expires: day(10, 16), guessed: false, category: "meat", where: "fridge" },
      { name: "Spinach", expires: day(10, 20), guessed: true, category: "produce", where: "fridge" },
    ]);
    expect(items(log)).toEqual([
      { name: "Oat milk", expires: day(10, 18), guessed: false, category: "dairy", where: "fridge", status: "in", photo: { key: "m1", mime: "image/jpeg" } },
      { name: "Chicken thighs", expires: day(10, 16), guessed: false, category: "meat", where: "fridge", status: "in", photo: { key: "m1", mime: "image/jpeg" } },
    ]);
    expect(log.media).toEqual([photo]);
    expect(log.toasts).toEqual(["Added 2 things. First to go: Chicken thighs (Expires tomorrow)."]);
    expect(log.navigated).toEqual(["kitchen"]);
  });

  it("a row left without a date is saved with a guess, marked as one", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["manual"], form: () => ({ items: [{ name: "Leftover curry", category: "leftovers", where: "fridge" }] }) });
    await addFromPhoto(ctx);
    expect(log.forms[0]!.title).toBe("Add to my kitchen");
    expect(log.asked).toEqual([]);
    expect(items(log)).toEqual([{ name: "Leftover curry", expires: day(10, 18), guessed: true, category: "leftovers", where: "fridge", status: "in" }]);
  });

  it("cancelling the form saves nothing", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["camera"], form: () => null });
    await addFromPhoto(ctx);
    expect(log.created).toEqual([]);
    expect(log.navigated).toEqual([]);
  });

  it("a blurry photo says so and offers another; a photo of no food says that instead", async () => {
    const blurry = fakeCtx({ answer: { kind: "unreadable", boughtOn: null, items: [line({})] }, sheets: ["camera"] });
    await addFromPhoto(blurry.ctx);
    expect(blurry.log.sheets[1]!.title).toBe("The photo is too blurry to read");
    expect(blurry.log.sheets[1]!.items[0]).toEqual({ id: "camera", label: "Take another photo", detail: "Closer, with more light, labels facing you" });
    expect(blurry.log.forms).toEqual([]);

    const none = fakeCtx({ answer: { kind: "not food", boughtOn: null, items: [] }, sheets: ["library"] });
    await addFromPhoto(none.ctx);
    expect(none.log.captured).toEqual([{ source: "library" }]);
    expect(none.log.sheets[1]!.title).toBe("There's no food on this photo");
  });

  it("with no AI here, says so and offers the sample — which sends nothing", async () => {
    const { ctx, log } = fakeCtx({ ai: false, sheets: ["camera", "sample"] });
    await addFromPhoto(ctx);
    expect(log.sheets[1]!.title).toBe("AI isn't available here, so a photo can't be read");
    expect(log.captured).toEqual([]);
    expect(log.forms[0]!.title).toBe("Sample shelf — check what was found");
    expect(items(log).map((r) => r.name)).toEqual(["Chicken thighs", "Milk", "Spinach", "Tomatoes", "Greek yogurt", "Cheddar"]);
    expect(log.media[0]!.type).toBe("image/svg+xml");
  });

  it("when the AI fails, shows its words and what still works", async () => {
    const { ctx, log } = fakeCtx({ answer: new Error("You're offline. AI needs the internet — try again when you're connected."), sheets: ["camera", "manual"], form: () => null });
    await addFromPhoto(ctx);
    expect(log.sheets[1]!.title).toBe("You're offline. AI needs the internet — try again when you're connected.");
    expect(log.sheets[1]!.items.map((i) => i.id)).toEqual(["manual", "sample"]);
    expect(log.forms[0]!.title).toBe("Add to my kitchen");
  });
});

describe("the sample shelf", () => {
  const say = sayIn("en");

  it("reads as its picture: three printed dates counted from today and three guesses", () => {
    const drafts = toDrafts(sampleReading(NOW, say), NOW);
    expect(drafts.map((d) => [d.name, d.guessed, d.expires.getDate()])).toEqual([
      ["Chicken thighs", false, 16],
      ["Milk", false, 18],
      ["Spinach", true, 20],
      ["Tomatoes", true, 20],
      ["Greek yogurt", false, 24],
      ["Cheddar", false, 8],
    ]);
  });

  it("is a picture that says SAMPLE, carries those dates, and is in the person's language", () => {
    const svg = sampleShelfSvg(NOW, say);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain("SAMPLE PHOTO");
    expect(svg).toContain("18 OCT");
    expect(svg).toContain("USE BY");
    const pl = sampleShelfSvg(NOW, sayIn("pl"));
    expect(pl).toContain("PRZYKŁADOWE ZDJĘCIE");
    expect(pl).toContain("MLEKO");
  });
});

describe("how an item reads", () => {
  const say = sayIn("en");
  it("says how long it has left, and when that is a guess", () => {
    expect(expiryText({ expires: day(10, 20), guessed: true }, say, NOW)).toBe("5 days left · date guessed");
    expect(expiryText({ expires: day(10, 16) }, say, NOW)).toBe("Expires tomorrow");
    expect(expiryText({ expires: day(10, 15) }, say, NOW)).toBe("Expires today");
    expect(expiryText({ expires: day(10, 14) }, say, NOW)).toBe("Expired yesterday");
    expect(expiryText({ expires: day(10, 12) }, say, NOW)).toBe("Expired 3 days ago");
    expect(expiryText({}, say, NOW)).toBe("No date");
    expect(rowText({ expires: day(10, 16), amount: "×4", where: "fridge" }, say, NOW)).toBe("Expires tomorrow · ×4 · Fridge");
  });

  it("in Polish, with Polish plurals", () => {
    const pl = sayIn("pl");
    expect(expiryText({ expires: day(10, 17) }, pl, NOW)).toBe("Zostały 2 dni");
    expect(expiryText({ expires: day(10, 20) }, pl, NOW)).toBe("Zostało 5 dni");
  });

  it("names the reminder as it will come, and titles it for the day before or the day itself", () => {
    expect(reminderText({ expires: day(10, 20), status: "in" }, say, NOW)).toBe("Mon 19 Oct, 9:00");
    expect(reminderText({ expires: day(10, 15), status: "in" }, say, NOW)).toBe("None — it is too late for one");
    expect(reminderText({ status: "in" }, say, NOW)).toBe("None — there is no date");
    expect(reminderTitle({ name: "Milk", expires: day(10, 20) }, say, NOW)).toBe("Milk expires tomorrow");
    expect(reminderTitle({ name: "Chicken", expires: day(10, 16) }, say, NOW)).toBe("Chicken expires today");
  });

  it("the declared reminder fires the day before and carries the item's name", async () => {
    const rem = app.reminders![0]!;
    const { ctx } = fakeCtx();
    const r = { id: "i1", name: "Milk", expires: day(10, 20), status: "in" } as unknown as Resolved;
    expect(rem.when(r, ctx)).toEqual(new Date(2026, 9, 19, 9));
    expect((rem.title as (r: Resolved, c: Ctx) => string)(r, ctx)).toBe("Milk expires tomorrow");
  });
});

describe("used and thrown away", () => {
  it("each marks the item finished, now", async () => {
    const { ctx, log } = fakeCtx();
    const r = { id: "i1", name: "Milk" } as unknown as Resolved;
    await action("item", "used")(r, ctx);
    await action("item", "wasted")(r, ctx);
    expect(log.patched).toEqual([
      { id: "i1", data: { status: "used", finished: NOW } },
      { id: "i1", data: { status: "wasted", finished: NOW } },
    ]);
    expect(log.toasts).toEqual(["Used: Milk. Nice.", "Thrown away: Milk. It counts on Waste."]);
  });
});

describe("What can I cook?", () => {
  const rows = [
    { id: "a", name: "Rice", status: "in", expires: null },
    { id: "b", name: "Milk", status: "in", expires: day(10, 18) },
    { id: "c", name: "Chicken thighs", status: "in", expires: day(10, 16) },
    { id: "d", name: "Old bread", status: "wasted", expires: day(10, 10) },
  ];

  it("sends only the names and days left of what is in the kitchen, soonest first, after saying so", async () => {
    const { ctx, log } = fakeCtx({
      rows,
      sheets: ["ask"],
      ideas: { ideas: [{ title: "Chicken rice", uses: ["chicken thighs", "rice", "saffron"], minutes: 30.4, steps: ["Fry", "Simmer", ""] }] },
    });
    await cook(ctx);
    expect(log.sheets[0]!.items[0]!.detail).toBe("Sends only these names and how long each has left: Chicken thighs, Milk and Rice");
    expect(log.asked).toHaveLength(1);
    expect(Object.keys(log.asked[0]!).sort()).toEqual(["instructions", "schema", "text"]);
    expect(log.asked[0]!.text).toBe("- Chicken thighs: 1 day left\n- Milk: 3 days left\n- Rice: no date");
    expect(log.asked[0]!.instructions).toBe(COOK_INSTRUCTIONS);
    // The idea keeps only what is really in the kitchen, as it is named there.
    expect(log.created).toEqual([{ entity: "idea", data: { title: "Chicken rice", uses: "Chicken thighs and Rice", minutes: 30, steps: "1. Fry\n2. Simmer", made: NOW, sample: false } }]);
    expect(log.navigated).toEqual(["cook"]);
    expect(log.toasts).toEqual(["1 idea, using what goes first."]);
  });

  it("an empty kitchen says to add things first; no AI offers the sample ideas only", async () => {
    const empty = fakeCtx({ rows: [] });
    await cook(empty.ctx);
    expect(empty.log.toasts[0]).toMatch(/^Add what's in your kitchen first/);
    expect(empty.log.sheets).toEqual([]);

    const sample = sayIn("en");
    const shelf = toDrafts(sampleReading(NOW, sample), NOW).map((d, i) => ({ id: `s${i}`, status: "in", ...d }));
    const noAi = fakeCtx({ ai: false, rows: shelf, sheets: ["sample"] });
    await cook(noAi.ctx);
    expect(noAi.log.sheets[0]!.title).toBe("AI isn't available here, so ideas can't be asked for");
    expect(noAi.log.sheets[0]!.items.map((i) => i.id)).toEqual(["sample"]);
    expect(noAi.log.created.map((c) => [c.data.title, c.data.uses, c.data.sample])).toEqual([
      ["Chicken and spinach skillet", "Chicken thighs, Spinach and Tomatoes", true],
      ["Tomato salad with yogurt dressing", "Tomatoes, Greek yogurt and Cheddar", true],
    ]);
  });

  it("offers at most a handful of things, and matches names loosely but only to what is there", () => {
    expect(MAX_SENT).toBe(10);
    const there = [{ name: "Greek yogurt" }, { name: "Spinach" }] as unknown as Resolved[];
    expect(keepReal(["yogurt", "SPINACH", "spinach", "eggs"], there)).toEqual(["Greek yogurt", "Spinach"]);
    expect(cookText([{ name: "Ham", expires: day(10, 15) }, { name: "Eggs", expires: day(10, 13) }] as unknown as Resolved[], NOW)).toBe("- Ham: use today\n- Eggs: past its date");
  });

  it("an idea goes to the share sheet with what it uses and its steps", async () => {
    const { ctx, log } = fakeCtx();
    await action("idea", "share")({ id: "x", title: "Chicken rice", uses: "Chicken thighs and Rice", minutes: 30, steps: "1. Fry\n2. Simmer" } as unknown as Resolved, ctx);
    expect(log.shared).toEqual([{ title: "Chicken rice", text: "Chicken rice (30 min)\n\nUses: Chicken thighs and Rice\n\n1. Fry\n2. Simmer" }]);
  });
});

describe("a demo link (docs/04 §Demo)", () => {
  it("keeps the sample reading without a question, so the link opens on something", async () => {
    const { ctx, log } = fakeCtx();
    await app.demo!(ctx as never);
    expect(log.forms).toEqual([]);
    expect(log.sheets).toEqual([]);
    expect(log.created.length).toBeGreaterThan(0);
    expect(log.created.every((c) => (c.data as { photo?: unknown; poster?: unknown }).photo || (c.data as { poster?: unknown }).poster || c.entity === "check")).toBe(true);
  });
});
