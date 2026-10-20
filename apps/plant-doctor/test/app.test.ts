// The app's shape, its words — how sure they sound above all — and every path through "Check a plant"
// and a check-up against a scripted ctx: a photo looked at, read, and saved with a care plan; Not now;
// no plant, a poor photo, no AI, an AI that fails; the sample and its check-up; watering; sharing.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps, type Ctx, type Resolved } from "potyro";
import app from "../plant-doctor.app.js";
import { DIAGNOSIS, firstInstructions, followUpInstructions, toFinding, type DiagnosisAnswer } from "../reading.js";
import { samplePlantSvg, sampleReading } from "../sample.js";
import { checkShare, carePlanShare, expertText, headline, plantLine, remindersText, trendText, waterText } from "../words.js";
import { LANGUAGES, sayIn } from "./say.js";

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "vitest.config.ts");
const source = sources.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

/** Thu 15 Oct 2026, 10:00 in Warsaw. */
const NOW = new Date(2026, 9, 15, 10, 0);
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d);

function answer(over: Omit<Partial<DiagnosisAnswer>, "problem"> & { problem?: Partial<DiagnosisAnswer["problem"]> } = {}): DiagnosisAnswer {
  const base: DiagnosisAnswer = {
    isPlant: true,
    clear: true,
    plant: { common: "Monstera", latin: "Monstera deliciosa", sure: "high" },
    problem: { kind: "underwatering", name: "Too little water", sure: "medium", signs: ["Curling leaves", " ", "Dry, pulled-back soil"], check: ["Feel the soil"], todo: ["Water deeply", "Then let it drain"], serious: false },
    care: { waterEveryDays: 8.4, light: "bright", watch: ["Brown tips"] },
    trend: null,
    trendNote: null,
  };
  return { ...base, ...over, problem: { ...base.problem, ...(over.problem ?? {}) } } as DiagnosisAnswer;
}

interface Script {
  answer?: DiagnosisAnswer | Error;
  sheets?: unknown[];
  confirm?: boolean;
  form?: (initial: Record<string, unknown>) => Record<string, unknown> | null;
  ai?: boolean;
  checks?: Array<Record<string, unknown>>;
}

function fakeCtx(s: Script = {}) {
  const say = sayIn("en");
  const sheets = [...(s.sheets ?? [])];
  const log = {
    asked: [] as Array<Record<string, unknown>>,
    sheets: [] as Array<{ title: string; items: Array<{ id: unknown; label: string; detail?: string }> }>,
    confirms: [] as Array<{ msg: string; detail: string; ok: string; cancel: string }>,
    forms: [] as Array<{ title: string; initial: Record<string, unknown> }>,
    created: [] as Array<{ entity: string; data: Record<string, unknown> }>,
    patched: [] as Array<{ entity: string; id: string; data: Record<string, unknown> }>,
    toasts: [] as string[],
    navigated: [] as Array<[string, Record<string, string> | undefined]>,
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
                return s.answer ?? answer();
              },
              ask: async () => "",
            },
          }),
      camera: { capture: async (o: unknown) => (log.captured.push(o), photo) },
    },
    query: async () => (s.checks ?? []) as Resolved[],
    media: { put: async (b: Blob) => (log.media.push(b), { key: `m${log.media.length}`, mime: b.type }), url: async () => "" },
    ui: {
      sheet: async (o: { title: unknown; items: Array<{ id: unknown; label: unknown; detail?: unknown }> }) => {
        log.sheets.push({ title: w(o.title), items: o.items.map((i) => ({ id: i.id, label: w(i.label), ...(i.detail ? { detail: w(i.detail) } : {}) })) });
        return sheets.length ? sheets.shift() : null;
      },
      confirm: async (msg: unknown, o: { detail: unknown; ok: unknown; cancel: unknown }) => {
        log.confirms.push({ msg: w(msg), detail: w(o.detail), ok: w(o.ok), cancel: w(o.cancel) });
        return s.confirm ?? true;
      },
      form: async (o: { title: unknown; initial: Record<string, unknown> }) => {
        log.forms.push({ title: w(o.title), initial: o.initial });
        return s.form ? s.form(o.initial) : o.initial;
      },
      toast: (m: unknown) => void log.toasts.push(w(m)),
      progress: () => ({ update: () => {}, done: () => {} }),
      share: async (d: { title?: string; text?: string }) => (log.shared.push(d), true),
    },
    create: async (entity: string, data: Record<string, unknown>) => {
      log.created.push({ entity, data });
      return { id: `${entity}${log.created.length}`, ...data } as Resolved;
    },
    patch: async (entity: string, id: string, data: Record<string, unknown>) => {
      log.patched.push({ entity, id, data });
      return { id, ...data } as Resolved;
    },
    navigate: (page: string, params?: Record<string, string>) => void log.navigated.push([page, params]),
  } as unknown as Ctx;
  return { ctx, log, photo, say };
}

const plants = app.pages.find((p) => p.id === "plants")!;
const checkAPlant = plants.actions![0]!.run;
const action = (entity: "plant" | "check", key: string) => {
  const a = app.entities[entity]!.actions![key]!;
  return typeof a === "function" ? a : a.run;
};
const made = (log: ReturnType<typeof fakeCtx>["log"], entity: string) => log.created.filter((c) => c.entity === entity).map((c) => c.data);

describe("Plant Doctor — the app", () => {
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

  it("never claims certainty, in any language, and the model is told not to", () => {
    for (const l of LANGUAGES) {
      const say = sayIn(l);
      for (const sure of ["low", "medium", "high"]) {
        const text = headline({ kind: "pests", problem: "X", sure }, say);
        expect(text, `${l}/${sure}`).not.toMatch(/certain|definitely|sicher ist|na pewno|certeza absoluta|sicuramente/i);
      }
    }
    expect(firstInstructions()).toMatch(/never say anything is certain/);
    expect(firstInstructions()).toMatch(/never high from one sign or a poor photo/);
  });
});

describe("a look, normalised", () => {
  it("cleans the lists, clamps the interval and keeps how sure each part was", () => {
    const f = toFinding(answer(), false);
    expect(f).toMatchObject({
      plantName: "Monstera",
      latin: "Monstera deliciosa",
      plantSure: "high",
      kind: "underwatering",
      problem: "Too little water",
      sure: "medium",
      signs: ["Curling leaves", "Dry, pulled-back soil"],
      waterEvery: 8,
      light: "bright",
      trend: "first",
      health: "struggling",
      serious: false,
    });
  });

  it("says when there is no plant, or the photo is too poor, instead of guessing", () => {
    expect(toFinding(answer({ isPlant: false }), false)).toBe("not a plant");
    expect(toFinding(answer({ clear: false }), false)).toBe("unclear");
  });

  it("a disease is serious even when the model said not; a healthy plant has no problem name", () => {
    const sick = toFinding(answer({ problem: { kind: "disease", name: "Leaf spot", serious: false } }), false);
    expect(sick).toMatchObject({ serious: true, health: "serious" });
    const fine = toFinding(answer({ problem: { kind: "none", name: "Nothing", sure: "high" } }), false);
    expect(fine).toMatchObject({ problem: "", health: "thriving" });
  });

  it("a check-up keeps the trend; one with nothing to compare says it cannot tell", () => {
    expect(toFinding(answer({ trend: "worse", trendNote: " More yellow leaves. " }), true)).toMatchObject({ trend: "worse", trendNote: "More yellow leaves." });
    expect(toFinding(answer(), true)).toMatchObject({ trend: "unsure" });
  });

  it("asks, on a check-up, with the earlier photo's date and what it seemed — nothing more of the record", () => {
    const text = followUpInstructions({ on: day(10, 8), said: "overwatering (Too much water)" });
    expect(text).toContain("The first image is the same plant on 2026-10-08, when it looked like: overwatering (Too much water). The second image is today's.");
    expect(followUpInstructions(null)).toContain("There is no earlier photo of it.");
    expect(Object.keys(DIAGNOSIS)).toEqual(["isPlant", "clear", "plant", "problem", "care", "trend", "trendNote"]);
  });
});

describe("how sure it sounds", () => {
  const say = sayIn("en");
  it("says 'most likely', 'probably' or 'possibly', by how sure the look was", () => {
    expect(headline({ kind: "pests", problem: "Spider mites", sure: "high" }, say)).toBe("Most likely: Spider mites");
    expect(headline({ kind: "pests", problem: "Spider mites", sure: "medium" }, say)).toBe("Probably: Spider mites");
    expect(headline({ kind: "pests", problem: "Spider mites", sure: "low" }, say)).toBe("Possibly: Spider mites — hard to tell from a photo");
    expect(headline({ kind: "none", sure: "high" }, say)).toBe("Looks healthy");
    expect(headline({ kind: "none", sure: "low" }, say)).toBe("Probably fine — hard to tell from a photo");
    expect(headline({ kind: "unsure", sure: "high" }, say)).toBe("Hard to tell from this photo");
  });

  it("names the plant the same way, and says when it does not know", () => {
    expect(plantLine({ plantName: "Monstera", latin: "Monstera deliciosa", plantSure: "high" }, say)).toBe("Looks like: Monstera (Monstera deliciosa)");
    expect(plantLine({ plantName: "Fern", plantSure: "low" }, say)).toBe("Maybe: Fern — not sure");
    expect(plantLine({}, say)).toBe("Not sure which plant this is");
  });

  it("always says when to ask someone, louder when it could be serious", () => {
    expect(expertText({ serious: false }, say)).toMatch(/^A photo can't be sure\./);
    expect(expertText({ serious: true }, say)).toMatch(/^This could be serious\. Keep it away from your other plants/);
  });

  it("says better or worse since last time, with what changed", () => {
    expect(trendText({ trend: "better", trendNote: "Greener." }, say)).toBe("Better since last time. Greener.");
    expect(trendText({ trend: "worse" }, say)).toBe("Worse since last time.");
    expect(trendText({ trend: "first" }, say)).toBe("First look. The next photo will be compared with this one.");
  });

  it("names the reminders as they will come, or that none is coming", () => {
    expect(remindersText({ lastWatered: day(10, 14), waterEvery: 5, nextCheck: day(10, 22) }, say, NOW)).toBe("Water: Mon 19 Oct, 9:00 · Check-up photo: Thu 22 Oct, 9:00");
    expect(remindersText({}, say, NOW)).toBe("None coming");
  });

  it("in Polish, with Polish plurals", () => {
    const pl = sayIn("pl");
    expect(waterText({ lastWatered: day(10, 14), waterEvery: 4 }, pl, NOW)).toBe("Podlej za 3 dni");
    expect(waterText({ lastWatered: day(10, 1), waterEvery: 7 }, pl, NOW)).toBe("Podlewanie spóźnione o 7 dni");
  });
});

describe("Check a plant", () => {
  it("photo → the finding, read first → the care plan, checked → plant and check-up saved, the finding opened", async () => {
    const { ctx, log, photo } = fakeCtx({ sheets: ["camera"], form: (initial) => ({ ...initial, name: "Monty", lastWatered: day(10, 13) }) });
    await checkAPlant(ctx);
    expect(log.captured).toEqual([{ source: "camera" }]);
    // What went to the AI: the photo and the app's instructions — no record.
    expect(Object.keys(log.asked[0]!).sort()).toEqual(["image", "instructions", "schema"]);
    expect(log.asked[0]!.image).toBe(photo);
    expect(log.confirms[0]!.msg).toBe("Probably: Too little water");
    expect(log.confirms[0]!.detail).toBe(
      "Looks like: Monstera (Monstera deliciosa)\n\nWhat it looks like: Curling leaves; Dry, pulled-back soil\n\nWhat to check:\n• Feel the soil\n\nA photo can't be sure. If it isn't better by the next check-up, a garden centre or a plant expert can look at it.",
    );
    expect(log.confirms[0]!.ok).toBe("Save it with a care plan");
    expect(log.forms[0]!.initial).toEqual({ name: "Monstera", light: "bright", waterEvery: 8, species: "Monstera deliciosa" });
    const [plant] = made(log, "plant");
    expect(plant).toEqual({
      name: "Monty",
      light: "bright",
      waterEvery: 8,
      species: "Monstera deliciosa",
      lastWatered: day(10, 13),
      photo: { key: "m1", mime: "image/jpeg" },
      watch: "• Brown tips",
      health: "struggling",
      nextCheck: day(10, 22),
    });
    const [check] = made(log, "check");
    expect(check).toMatchObject({ plant: "plant1", date: NOW, photo: { key: "m1", mime: "image/jpeg" }, problem: "Too little water", kind: "underwatering", sure: "medium", toDo: "• Water deeply\n• Then let it drain", trend: "first", sample: false });
    expect(log.toasts).toEqual(["Saved. Water in 6 days. Next check-up photo in 7 days."]);
    expect(log.navigated).toEqual([["check", { checkId: "check2" }]]);
  });

  it("Not now keeps nothing — not even the photo", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["camera"], confirm: false });
    await checkAPlant(ctx);
    expect(log.forms).toEqual([]);
    expect(log.created).toEqual([]);
    expect(log.media).toEqual([]);
  });

  it("no plant on the photo, or too poor a photo, says which and offers another", async () => {
    const none = fakeCtx({ answer: answer({ isPlant: false }), sheets: ["camera"] });
    await checkAPlant(none.ctx);
    expect(none.log.sheets[1]!.title).toBe("There's no plant on this photo");
    expect(none.log.confirms).toEqual([]);
    const poor = fakeCtx({ answer: answer({ clear: false }), sheets: ["camera", "library"] });
    await checkAPlant(poor.ctx);
    expect(poor.log.sheets[1]!.title).toBe("The photo is too blurry or dark to judge");
    expect(poor.log.sheets[1]!.items[0]!.detail).toBe("In daylight, closer, with the leaves in focus");
    expect(poor.log.captured).toEqual([{ source: "camera" }, { source: "library" }]);
  });

  it("with no AI, or an AI that fails, says why and offers the sample — which sends nothing", async () => {
    const noAi = fakeCtx({ ai: false, sheets: ["camera", "sample"] });
    await checkAPlant(noAi.ctx);
    expect(noAi.log.sheets[1]!.title).toBe("AI isn't available here, so a photo can't be looked at");
    expect(noAi.log.captured).toEqual([]);
    expect(noAi.log.confirms[0]!.msg).toBe("Probably: Too much water");
    expect(made(noAi.log, "check")[0]).toMatchObject({ sample: true, kind: "overwatering" });
    expect(noAi.log.media[0]!.type).toBe("image/svg+xml");

    const failed = fakeCtx({ answer: new Error("This month's free AI is used up — add your own OpenRouter key in Model settings."), sheets: ["library", "manual"], form: () => null });
    await checkAPlant(failed.ctx);
    expect(failed.log.sheets[1]!.title).toBe("This month's free AI is used up — add your own OpenRouter key in Model settings.");
    expect(failed.log.sheets[1]!.items.map((i) => i.id)).toEqual(["sample", "manual"]);
  });

  it("a plant added without a photo gets a care plan and no check-up", async () => {
    const { ctx, log } = fakeCtx({ sheets: ["manual"], form: (i) => ({ ...i, name: "Basil", light: "sun", waterEvery: 3 }) });
    await checkAPlant(ctx);
    expect(log.asked).toEqual([]);
    expect(made(log, "plant")).toEqual([{ name: "Basil", light: "sun", waterEvery: 3, health: "okay" }]);
    expect(made(log, "check")).toEqual([]);
    expect(log.navigated).toEqual([["plant", { plantId: "plant1" }]]);
  });
});

describe("a check-up", () => {
  const plant = { id: "p1", name: "Monty", waterEvery: 5, light: "bright" } as unknown as Resolved;
  const earlier = { id: "c1", plant: { id: "p1", name: "Monty" }, date: day(10, 8), photo: { key: "old", mime: "image/jpeg" }, kind: "overwatering", problem: "Too much water", sample: false };

  it("sends the earlier photo and today's, says what changed, updates the plant and opens the finding", async () => {
    const { ctx, log, photo } = fakeCtx({ checks: [earlier], sheets: ["camera"], answer: answer({ problem: { kind: "none", name: null, sure: "medium" }, trend: "better", trendNote: "Firmer leaves." }) });
    await action("plant", "checkup")(plant, ctx);
    expect(log.sheets[0]!.items.map((i) => i.id)).toEqual(["camera", "library"]); // no sample for a real plant
    expect(log.asked[0]!.image).toEqual([{ key: "old", mime: "image/jpeg" }, photo]);
    expect(log.asked[0]!.instructions).toContain("on 2026-10-08, when it looked like: overwatering (Too much water)");
    expect(made(log, "check")[0]).toMatchObject({ plant: "p1", trend: "better", trendNote: "Firmer leaves.", problem: "Looks healthy" });
    expect(log.patched).toEqual([{ entity: "plant", id: "p1", data: { photo: { key: "m1", mime: "image/jpeg" }, health: "thriving", nextCheck: day(11, 14), watch: "• Brown tips" } }]);
    expect(log.toasts).toEqual(["Better since last time. Firmer leaves."]);
    expect(log.navigated).toEqual([["check", { checkId: "check1" }]]);
  });

  it("the sample's check-up follows the sample, and finds it better without AI", async () => {
    const { ctx, log } = fakeCtx({ ai: false, checks: [{ ...earlier, sample: true }], sheets: ["sample"] });
    await action("plant", "checkup")(plant, ctx);
    expect(log.asked).toEqual([]);
    expect(made(log, "check")[0]).toMatchObject({ trend: "better", sample: true, kind: "none" });
    expect(log.toasts[0]).toBe("Better since last time. No new yellow leaves, and the soil is drier than last time.");
  });

  it("watering counts the next one from today", async () => {
    const { ctx, log } = fakeCtx();
    await action("plant", "watered")({ ...plant, lastWatered: day(10, 1) } as unknown as Resolved, ctx);
    expect(log.patched).toEqual([{ entity: "plant", id: "p1", data: { lastWatered: day(10, 15) } }]);
    expect(log.toasts).toEqual(["Watered. Water in 5 days."]);
  });
});

describe("sharing", () => {
  const say = sayIn("en");
  it("a care plan says how to look after it and how the last check-up went", async () => {
    const { ctx, log } = fakeCtx({ checks: [{ id: "c1", plant: { id: "p1" }, date: day(10, 8), kind: "overwatering", problem: "Too much water", sure: "medium" }] });
    await action("plant", "share")({ id: "p1", name: "Monty", species: "Monstera deliciosa", waterEvery: 7, light: "bright", watch: "• Brown tips" } as unknown as Resolved, ctx);
    expect(log.shared).toEqual([{ title: "Monty", text: "Monty — Monstera deliciosa\n\nWater every 7 days · Bright, indirect light\n\nKeep an eye on:\n• Brown tips\n\nLast check-up: Probably: Too much water" }]);
    expect(carePlanShare({ name: "Basil", waterEvery: 1, light: "sun" }, null, say)).toBe("Basil\n\nWater every day · Direct sun");
  });

  it("a check-up says it is a guess from a photo, not a diagnosis", () => {
    const text = checkShare({ kind: "pests", problem: "Spider mites", sure: "low", toCheck: "• Undersides", toDo: "• Shower it" }, "Monty", say);
    expect(text).toBe("Monty: Possibly: Spider mites — hard to tell from a photo\n\nWhat to check:\n• Undersides\n\nWhat to do:\n• Shower it\n\n(A guess from a photo by Plant Doctor's AI, not a diagnosis.)");
  });
});

describe("the sample plant", () => {
  it("is two pictures that say SAMPLE, in the person's language, and two looks that fit them", () => {
    const say = sayIn("pl");
    expect(samplePlantSvg(say)).toContain("PRZYKŁADOWE ZDJĘCIE");
    expect(samplePlantSvg(say, true)).toContain("PRZY KOLEJNYM SPRAWDZENIU");
    expect(samplePlantSvg(sayIn("en"))).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(sampleReading(say).problem.kind).toBe("overwatering");
    expect(sampleReading(say).problem.name).toBe("Za dużo wody");
    expect(sampleReading(say, true)).toMatchObject({ trend: "better", problem: { kind: "none" } });
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
