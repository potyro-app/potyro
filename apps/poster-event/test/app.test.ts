// The app's shape, its words, and every path through "Read a poster" against a scripted ctx: a
// photo read into a checked event, several events, a blurry photo, no date, a past date, no AI, the
// sample, and the two detail actions (the calendar file and the share sheet).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, type Ctx, type Resolved } from "potyro";
import app from "../poster-event.app.js";
import { instructions, POSTER, type PosterAnswer } from "../read.js";
import { sampleDay, samplePosterSvg } from "../sample.js";
import type { PosterReading } from "../dates.js";
import { LANGUAGES, sayIn } from "./say.js";

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "vitest.config.ts");
const source = sources.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

/** Thu 15 Oct 2026, 10:00 in Warsaw. */
const NOW = new Date(2026, 9, 15, 10, 0);

const ev = (r: Partial<PosterReading>): PosterReading => ({
  title: "Night Tram Quartet",
  dateText: "Fri 20 Nov",
  date: "2026-11-20",
  endDate: null,
  yearPrinted: false,
  start: "20:00",
  end: null,
  doors: "19:00",
  timezone: null,
  venue: "The Lantern Room",
  address: "12 Harbour Lane",
  price: "12 €",
  link: "lanternroom.example/tickets",
  description: null,
  ...r,
});

interface Script {
  answer?: PosterAnswer | Error;
  sheets?: unknown[];
  /** What the person does to the form: return the values to save, or null to cancel. */
  form?: (initial: Record<string, unknown>, title: string) => Record<string, unknown> | null;
  ai?: boolean;
  camera?: boolean;
}

function fakeCtx(s: Script = {}) {
  const say = sayIn("en");
  const sheets = [...(s.sheets ?? [])];
  const log = {
    asked: [] as Array<Record<string, unknown>>,
    sheetTitles: [] as string[],
    sheetItems: [] as Array<Array<{ id: unknown; label: string; detail?: string }>>,
    forms: [] as Array<{ title: string; initial: Record<string, unknown> }>,
    created: [] as Array<Record<string, unknown>>,
    toasts: [] as string[],
    navigated: [] as Array<[string, Record<string, string> | undefined]>,
    media: [] as Blob[],
    written: new Map<string, string>(),
    exported: [] as string[],
    shared: [] as Array<{ title?: string; text?: string; url?: string }>,
    captured: [] as unknown[],
  };
  const w = (x: unknown) => (typeof x === "string" ? x : say.t(x as never));
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const ctx = {
    ...say,
    locale: "en",
    now: () => NOW,
    today: () => new Date(2026, 9, 15),
    caps: {
      ...(s.ai === false
        ? {}
        : {
            ai: {
              extract: async (req: Record<string, unknown>) => {
                log.asked.push(req);
                if (s.answer instanceof Error) throw s.answer;
                return s.answer ?? { legible: true, events: [ev({})] };
              },
              ask: async () => "",
            },
          }),
      ...(s.camera === false ? {} : { camera: { capture: async (o: unknown) => (log.captured.push(o), photo) } }),
    },
    files: {
      import: async () => [{ id: "f1", path: "posters/p.jpg", name: "p.jpg", mime: "image/jpeg" }],
      bytes: async () => new Uint8Array([1, 2, 3]),
      remove: async () => {},
      write: async (path: string, data: string) => (log.written.set(path, data), { id: "w", path, name: path.split("/").pop() }),
      export: async (path: string) => void log.exported.push(path),
    },
    media: { put: async (b: Blob) => (log.media.push(b), { key: `m${log.media.length}`, mime: b.type }), url: async () => "" },
    ui: {
      sheet: async (o: { title: unknown; items: Array<{ id: unknown; label: unknown; detail?: unknown }> }) => {
        log.sheetTitles.push(w(o.title));
        log.sheetItems.push(o.items.map((i) => ({ id: i.id, label: w(i.label), ...(i.detail ? { detail: w(i.detail) } : {}) })));
        return sheets.length ? sheets.shift() : null;
      },
      form: async (o: { title: unknown; initial: Record<string, unknown> }) => {
        const title = w(o.title);
        log.forms.push({ title, initial: o.initial });
        return s.form ? s.form(o.initial, title) : o.initial;
      },
      toast: (m: unknown) => void log.toasts.push(w(m)),
      progress: () => ({ update: () => {}, done: () => {} }),
      share: async (d: { title?: string; text?: string; url?: string }) => void log.shared.push(d),
    },
    create: async (_e: string, data: Record<string, unknown>) => {
      log.created.push(data);
      return { id: `e${log.created.length}`, ...data } as Resolved;
    },
    navigate: (page: string, params?: Record<string, string>) => void log.navigated.push([page, params]),
  } as unknown as Ctx;
  return { ctx, log, photo };
}

const read = app.pages.find((p) => p.id === "upcoming")!.actions![0]!.run;
const action = (key: "addToCalendar" | "share") => {
  const a = app.entities.event!.actions![key]!;
  return typeof a === "function" ? a : a.run;
};

describe("Poster to Calendar — the app", () => {
  it("is a valid app that reaches the AI, the camera and the share sheet only through ctx", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ ai: true, camera: true, notifications: true });
    expect(source).toContain("ctx.caps.ai");
    expect(source).not.toMatch(/fetch\(|openrouter|navigator\.|document\.|window\./i);
  });

  it("uses only built-in views, so it works for a friend who runs it sealed", () => {
    for (const p of app.pages) expect(p.view.type, p.id).not.toBe("custom");
  });

  it("is written in English and carries all six languages, in its declared words and in its code", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(LANGUAGES);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
    // Every `{ en: … }` map in the code, ctx.t's included, has the other five.
    const maps = [...source.matchAll(/\{\s*en: /g)].map((m) => {
      let depth = 0;
      let i = m.index!;
      for (; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) break;
      }
      return source.slice(m.index!, i + 1);
    });
    expect(maps.length).toBeGreaterThan(60);
    for (const map of maps) for (const l of ['"pt-BR":', " de:", " es:", " pl:", " it:"]) expect(map, map.slice(0, 80)).toContain(l);
  });

  it("tells the model what it needs and nothing about the person: today's date and the poster rules", () => {
    const text = instructions(NOW);
    expect(text).toContain("Today is 2026-10-15");
    expect(text).toMatch(/doors/);
    expect(Object.keys(POSTER.events[0])).toContain("yearPrinted");
  });
});

describe("Read a poster", () => {
  it("photo → reading → the checked event, saved with its poster, a reminder and the page opened", async () => {
    const { ctx, log, photo } = fakeCtx({ sheets: ["camera"] });
    await read(ctx);
    expect(log.captured).toEqual([{ source: "camera" }]);
    // What went to the AI: the photo and the app's instructions — no record.
    expect(Object.keys(log.asked[0]!).sort()).toEqual(["image", "instructions", "schema"]);
    expect(log.asked[0]!.image).toBe(photo);
    expect(log.forms).toHaveLength(1);
    expect(log.forms[0]!.title).toBe("Check the event");
    expect(log.forms[0]!.initial).toMatchObject({
      title: "Night Tram Quartet",
      start: new Date(2026, 10, 20, 20, 0),
      doors: "19:00",
      venue: "The Lantern Room",
      link: "https://lanternroom.example/tickets",
      remind: "1 day before",
      allDay: false,
    });
    expect(log.created).toHaveLength(1);
    expect(log.created[0]).toMatchObject({ title: "Night Tram Quartet", poster: { key: "m1", mime: "image/jpeg" } });
    expect(log.toasts).toEqual(["Saved. Reminder: Thu 19 Nov, 20:00."]);
    expect(log.navigated).toEqual([["event", { eventId: "e1" }]]);
  });

  it("saves what the person corrected, not what the AI read", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["library"], form: (init) => ({ ...init, title: "Night Tram Quartet (late show)", remind: "3 hours before" }) });
    await read(ctx);
    expect(log.captured).toEqual([{ source: "library" }]);
    expect(log.created[0]).toMatchObject({ title: "Night Tram Quartet (late show)", remind: "3 hours before" });
    expect(log.toasts).toEqual(["Saved. Reminder: Fri 20 Nov, 17:00."]);
  });

  it("saves nothing when the form is cancelled, and asks nothing when the sheet is closed", async () => {
    const cancelled = fakeCtx({ sheets: ["camera"], form: () => null });
    await read(cancelled.ctx);
    expect(cancelled.log.created).toEqual([]);
    expect(cancelled.log.media).toHaveLength(1);
    const closed = fakeCtx({ sheets: [] });
    await read(closed.ctx);
    expect(closed.log.asked).toEqual([]);
    expect(closed.log.forms).toEqual([]);
  });

  it("several events: the person picks one", async () => {
    const answer = { legible: true, events: [ev({ title: "Night one", date: "2026-11-20" }), ev({ title: "Night two", date: "2026-11-21", dateText: "Sat 21 Nov" })] };
    const { ctx, log } = fakeCtx({ answer, sheets: ["camera", 1] });
    await read(ctx);
    expect(log.sheetTitles[1]).toBe("This poster has 2 events");
    expect(log.sheetItems[1]!.map((i) => i.label)).toEqual(["Night one", "Night two", "All 2, one after another"]);
    expect(log.sheetItems[1]![1]!.detail).toBe("Sat 21 Nov, 20:00");
    expect(log.created.map((c) => c.title)).toEqual(["Night two"]);
  });

  it("several events: all of them, one form after another, the poster stored once", async () => {
    const answer = { legible: true, events: [ev({ title: "Night one" }), ev({ title: "Night two", date: "2026-11-21" }), ev({ title: "Night three", date: "2026-11-22" })] };
    const { ctx, log } = fakeCtx({ answer, sheets: ["camera", -1], form: (init) => (init.title === "Night two" ? null : init) });
    await read(ctx);
    expect(log.forms.map((f) => f.initial.title)).toEqual(["Night one", "Night two", "Night three"]);
    expect(log.created.map((c) => c.title)).toEqual(["Night one", "Night three"]);
    expect(log.media).toHaveLength(1);
    expect(log.navigated).toEqual([]); // several made: the list shows them
  });

  it("a blurry photo says so in plain words and offers another photo or typing it in", async () => {
    const { ctx, log } = fakeCtx({ answer: { legible: false, events: [] }, sheets: ["camera", "manual"] });
    await read(ctx);
    expect(log.sheetTitles[1]).toBe("The photo is too blurry to read");
    expect(log.sheetItems[1]!.map((i) => i.label)).toEqual(["Take another photo", "Choose another photo", "Type it in myself"]);
    expect(log.sheetItems[1]![0]!.detail).toBe("Closer, flat on, with more light");
    expect(log.forms[0]!.title).toBe("New event");
    expect(log.created[0]).not.toHaveProperty("poster");
  });

  it("a photo with no event on it says that, not that it is blurry", async () => {
    const { ctx, log } = fakeCtx({ answer: { legible: true, events: [] }, sheets: ["camera"] });
    await read(ctx);
    expect(log.sheetTitles[1]).toBe("There's no event on this photo");
  });

  it("no date found: the form asks for it, empty", async () => {
    const { ctx, log } = fakeCtx({ answer: { legible: true, events: [ev({ date: null, dateText: null })] }, sheets: ["camera"] });
    await read(ctx);
    expect(log.forms[0]!.title).toBe("Add the date — it isn't on the poster");
    expect(log.forms[0]!.initial).not.toHaveProperty("start");
    expect(log.forms[0]!.initial.title).toBe("Night Tram Quartet");
  });

  it("a date that has passed: the form says so, and saving puts it under Past", async () => {
    const answer = { legible: true, events: [ev({ date: "2026-10-03", dateText: "Sat 3 Oct", yearPrinted: true })] };
    const { ctx, log } = fakeCtx({ answer, sheets: ["camera"] });
    await read(ctx);
    expect(log.forms[0]!.title).toBe("Check the date — this has already happened");
    expect(log.toasts).toEqual(["Saved under Past."]);
  });

  it("an AI that fails says why, through the action's own failure", async () => {
    const { ctx, log } = fakeCtx({ answer: new Error("You're offline. AI needs the internet — try again when you're connected."), sheets: ["camera"] });
    await expect(read(ctx)).rejects.toThrow(/offline/);
    expect(log.created).toEqual([]);
  });

  it("no AI here: offers typing it in and the sample, never a photo it cannot read", async () => {
    const { ctx, log } = fakeCtx({ ai: false, sheets: ["camera", "sample"] });
    await read(ctx);
    expect(log.captured).toEqual([]);
    expect(log.sheetTitles[1]).toBe("AI isn't available here, so a photo can't be read");
    expect(log.created[0]).toMatchObject({ title: "Night Tram Quartet" });
  });

  it("closing the camera is 'not now': nothing is read and nothing is said", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["camera"] });
    (ctx.caps.camera as { capture: () => Promise<Blob> }).capture = async () => {
      throw new Error("Cancelled: no file was chosen");
    };
    await read(ctx);
    expect(log.asked).toEqual([]);
    expect(log.toasts).toEqual([]);
  });

  it("a camera that fails for another reason says so", async () => {
    const { ctx } = fakeCtx({ sheets: ["camera"] });
    (ctx.caps.camera as { capture: () => Promise<Blob> }).capture = async () => {
      throw new Error("Permission denied: Poster to Calendar → the camera");
    };
    await expect(read(ctx)).rejects.toThrow(/Permission denied/);
  });

  it("no camera here: the file picker instead", async () => {
    const { ctx, log } = fakeCtx({ camera: false, sheets: ["camera"] });
    await read(ctx);
    expect(log.asked[0]!.image).toBeInstanceOf(Blob);
    expect(log.created).toHaveLength(1);
  });
});

describe("the sample poster", () => {
  it("is offered on the first sheet, says it sends nothing, and is read without AI", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["sample"] });
    await read(ctx);
    expect(log.sheetItems[0]!.find((i) => i.id === "sample")).toEqual({ id: "sample", label: "Try it on a sample poster", detail: "A made-up poster, read without AI — nothing is sent" });
    expect(log.asked).toEqual([]);
    expect(log.forms[0]!.title).toBe("Sample poster — check the event");
    // The poster is for the Friday after next, and the event is on that day.
    const day = sampleDay(NOW);
    expect(day).toEqual(new Date(2026, 9, 30));
    expect(log.forms[0]!.initial.start).toEqual(new Date(2026, 9, 30, 20, 0));
    expect(log.forms[0]!.initial.description).toMatch(/^A sample event, made up/);
    expect(log.media[0]!.type).toBe("image/svg+xml");
    expect(log.toasts).toEqual(["Saved. Reminder: Thu 29 Oct, 20:00."]);
  });

  it("prints its date in the person's language, and SAMPLE across the top", () => {
    const pl = samplePosterSvg(NOW, sayIn("pl"));
    expect(pl).toContain("PRZYKŁADOWY PLAKAT");
    expect(pl).toMatch(/PT 30 PAŹ/);
    expect(samplePosterSvg(NOW, sayIn("en"))).toContain("FRI 30 OCT");
    // The SVG carries no script and nothing it would fetch.
    expect(pl).not.toMatch(/<script|href=|xlink|url\((?!#)/i);
  });
});

describe("on an event's page", () => {
  const row = { id: "e9", title: "Night Tram Quartet", start: new Date(2026, 10, 20, 20, 0).toISOString(), end: null, allDay: false, doors: "19:00", venue: "The Lantern Room", address: "12 Harbour Lane", price: "12 €", link: "https://lanternroom.example/tickets", description: "Live jazz.", remind: "1 day before" } as unknown as Resolved;

  it("Add to my calendar writes a .ics into the app's folder and exports it", async () => {
    const { ctx, log } = fakeCtx();
    await action("addToCalendar")(row, ctx);
    expect(log.exported).toEqual(["calendar/night-tram-quartet-20261120.ics"]);
    const ics = log.written.get("calendar/night-tram-quartet-20261120.ics")!;
    expect(ics).toContain("UID:e9@poster-to-calendar.potyro");
    expect(ics).toContain("DTSTART:20261120T190000Z");
    expect(ics).toContain("LOCATION:The Lantern Room\\, 12 Harbour Lane");
    expect(ics).toContain("DESCRIPTION:Live jazz.\\nDoors 19:00\\n12 €");
    expect(ics).toContain("TRIGGER;VALUE=DATE-TIME:20261119T190000Z");
    expect(log.toasts).toEqual(["Open the file to add it to your calendar."]);
  });

  it("Add to my calendar asks for a date first when there is none", async () => {
    const { ctx, log } = fakeCtx();
    await action("addToCalendar")({ ...row, start: null } as unknown as Resolved, ctx);
    expect(log.exported).toEqual([]);
    expect(log.toasts).toEqual(["Add a date first."]);
  });

  it("Share with friends hands the share sheet the event in a few lines and its link", async () => {
    const { ctx, log } = fakeCtx();
    await action("share")(row, ctx);
    expect(log.shared).toEqual([
      {
        title: "Night Tram Quartet",
        text: "Night Tram Quartet\nFri 20 Nov, 20:00 · Doors 19:00\nThe Lantern Room, 12 Harbour Lane\n12 €",
        url: "https://lanternroom.example/tickets",
      },
    ]);
  });
});

describe("pages and reminders", () => {
  const upcoming = app.pages.find((p) => p.id === "upcoming")!.view as { filter: (r: Resolved, c: Ctx) => boolean; group: (r: Resolved, c: Ctx) => string };
  const past = app.pages.find((p) => p.id === "past")!.view as { filter: (r: Resolved, c: Ctx) => boolean };
  const { ctx } = fakeCtx();
  const at = (d: Date, extra: Record<string, unknown> = {}) => ({ id: "x", start: d.toISOString(), ...extra }) as unknown as Resolved;

  it("splits Coming up from Past at the end of an event", () => {
    const tonight = at(new Date(2026, 9, 15, 8, 0)); // started 8:00, over at 11:00
    expect(upcoming.filter(tonight, ctx)).toBe(true);
    expect(past.filter(tonight, ctx)).toBe(false);
    const lastWeek = at(new Date(2026, 9, 8, 20, 0));
    expect(upcoming.filter(lastWeek, ctx)).toBe(false);
    expect(past.filter(lastWeek, ctx)).toBe(true);
  });

  it("heads upcoming events by how soon they are", () => {
    expect(upcoming.group(at(new Date(2026, 9, 15, 8, 0)), ctx)).toBe("On now");
    expect(upcoming.group(at(new Date(2026, 9, 15, 20, 0)), ctx)).toBe("Today");
    expect(upcoming.group(at(new Date(2026, 9, 16, 20, 0)), ctx)).toBe("Tomorrow");
    expect(upcoming.group(at(new Date(2026, 9, 21, 20, 0)), ctx)).toBe("Next 7 days");
    expect(upcoming.group(at(new Date(2026, 10, 20, 20, 0)), ctx)).toBe("November");
    expect(upcoming.group(at(new Date(2027, 1, 2, 20, 0)), ctx)).toBe("February 2027");
  });

  it("reminds a day before by default, and never about an event that is over", () => {
    const rem = app.reminders![0]!;
    expect(rem.when(at(new Date(2026, 10, 20, 20, 0)), ctx)).toEqual(new Date(2026, 10, 19, 20, 0));
    expect(rem.when(at(new Date(2026, 9, 8, 20, 0)), ctx)).toBeNull();
  });
});

describe("a demo link (docs/04 §Demo)", () => {
  it("keeps the sample reading without a question, so the link opens on something", async () => {
    const { ctx, log } = fakeCtx();
    await app.demo!(ctx as never);
    expect(log.forms).toEqual([]);
    expect("sheets" in log ? (log as { sheets?: unknown[] }).sheets : (log as { sheetTitles?: string[] }).sheetTitles).toEqual([]);
    expect(log.created).toHaveLength(1);
    const rec = log.created[0] as Record<string, unknown>;
    expect(rec.title).toBeTruthy();
    expect(rec.start).toBeInstanceOf(Date);
    expect(rec.poster).toBeTruthy();
  });
});
