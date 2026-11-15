// A form's fill button in every runner (#81): one function, written once as source, run as a trusted
// app's function, in the QuickJS isolate and in the browser realm. The draft goes in as a copy of
// plain data; what comes back is checked by the HOST (`runFill`) before a form would see any of it —
// so a sealed app's answer, whatever it is, can only ever become values its own fields take.

import { afterAll, describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeAi, FakeCapabilities } from "@potyro/capabilities";
import { actionFailure, checkFill, createHost, declined, draftCopy, FILL_LIMITS, runFill, type FillOutcome, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, liveThreads, type Runner } from "./runners.js";

const FIELDS = {
  name: { type: "text", required: true },
  year: { type: "number", integer: true, min: 1900 },
  grape: { type: "enum", options: ["malbec", "merlot", "syrah"] },
  price: { type: "money", currency: "EUR" },
  label: { type: "media" },
  tasted: { type: "datetime" },
  tags: { type: "tags" },
  notes: { type: "text", multiline: true },
} as const;

const definition = (permissions: Record<string, boolean> = {}) => ({
  id: "cellar",
  name: "Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  permissions,
  entities: { bottle: { label: "Bottle", fields: FIELDS } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "bottle" } }],
});

const nav: NavBridge = { navigate: () => {} };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7]);

type Trust = "trusted" | Runner;
const EVERY: Trust[] = ["trusted", ...RUNNERS];
const nameOf = (t: Trust): string => (t === "trusted" ? "trusted" : t.name);

interface Opts {
  permissions?: Record<string, boolean>;
  draft?: Record<string, unknown>;
  confirm?: (message: string) => boolean;
  /** A second fill button, to be called by index 1. */
  index?: number;
}

/** Run `fill` (a function's source) as the bottle form's fill button, in `trust`'s runner. */
async function fill(trust: Trust, source: string, opts: Opts = {}): Promise<{ outcome?: FillOutcome; error?: unknown; store: MemoryStore; asked: number }> {
  const store = new MemoryStore();
  await store.open("cellar");
  const ai = new FakeAi(['{"name":"Catena","grape":"Cabernet Sauvignon"}'], { language: "en" });
  const caps = new FakeCapabilities({ ai, blob: new Blob([PNG], { type: "image/png" }) });
  const ui: UiBridge = { toast: () => {}, confirm: async (m) => (opts.confirm ? opts.confirm(String(m)) : true), prompt: async () => null, pick: async () => null };
  const def = definition(opts.permissions);
  const other = `function () { return { name: "the other button" }; }`;
  const host = trust === "trusted" ? createHost() : createHost({ loadIsolated: await trust.loader(store) });
  const loaded =
    trust === "trusted"
      ? await host.load({
          kind: "module",
          app: defineApp({
            ...def,
            entities: { bottle: { ...def.entities.bottle, fill: [{ label: "Scan label", run: new Function(`return ${source}`)() }, { label: "Other", run: new Function(`return ${other}`)() }] } },
          } as never),
        })
      : await host.load({
          kind: "bundle",
          code: `globalThis.__potyroApp = ${JSON.stringify(def).replace(/"pages":/, () => `"__fill":0,"pages":`)}; globalThis.__potyroApp.entities.bottle.fill = [{ label: "Scan label", run: ${source} }, { label: "Other", run: ${other} }];`,
          provenance: "untrusted",
        });
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  try {
    const outcome = await runFill(loaded, "bottle", opts.index ?? 0, opts.draft ?? {}, ctx);
    return { outcome, store, asked: ai.calls.length };
  } catch (error) {
    return { error, store, asked: ai.calls.length };
  } finally {
    loaded.dispose?.();
  }
}

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

describe("a form's fill button, in every runner", () => {
  for (const trust of EVERY) {
    const T = 30_000;

    it(`${nameOf(trust)}: the function gets the draft and its values come back checked`, async () => {
      const r = await fill(trust, `async function (draft, ctx) { return { name: draft.name + "!", year: 2019, grape: "malbec", tags: ["red"], price: 1250 }; }`, { draft: { name: "Catena" } });
      expect(r.error).toBeUndefined();
      expect(r.outcome).toEqual({ values: { name: "Catena!", year: 2019, grape: "malbec", tags: ["red"], price: 1250 }, refused: [], unknown: [] });
    }, T);

    it(`${nameOf(trust)}: it is called by its index`, async () => {
      expect((await fill(trust, `function () { return { name: "first" }; }`, { index: 1 })).outcome!.values).toEqual({ name: "the other button" });
      expect(actionFailure((await fill(trust, `function () { return {}; }`, { index: 7 })).error).detail).toMatch(/fill bottle\[7\] not found/);
    }, T);

    it(`${nameOf(trust)}: a value its field does not take is refused as data, and the rest is kept`, async () => {
      const r = await fill(trust, `function () { return { name: "Catena", grape: "Cabernet Sauvignon", year: 1492.5, price: "12 €" }; }`);
      expect(r.outcome!.values).toEqual({ name: "Catena" });
      expect(r.outcome!.refused).toEqual([
        { entity: "bottle", field: "grape", issue: { rule: "options", options: ["malbec", "merlot", "syrah"] } },
        { entity: "bottle", field: "year", issue: { rule: "whole" } },
        { entity: "bottle", field: "price", issue: { rule: "amount" } },
      ]);
    }, T);

    it(`${nameOf(trust)}: keys that are no field are dropped and named; a record's own are dropped quietly`, async () => {
      const r = await fill(trust, `function (draft) { return { id: "x", createdAt: "2020-01-01", name: "Catena", vintage: 2019, __proto__: { admin: true }, constructor: "c" }; }`);
      expect(r.outcome!.values).toEqual({ name: "Catena" });
      expect(Object.getPrototypeOf(r.outcome!.values)).toBe(Object.prototype);
      expect(r.outcome!.unknown.sort()).toEqual(["constructor", "vintage"]);
    }, T);

    it(`${nameOf(trust)}: nothing returned is nothing to fill, not an error`, async () => {
      for (const source of [`function () {}`, `async function () { return null; }`]) {
        expect((await fill(trust, source)).outcome).toEqual({ values: {}, refused: [], unknown: [], nothing: true });
      }
      expect((await fill(trust, `function () { return {}; }`)).outcome).toEqual({ values: {}, refused: [], unknown: [] });
    }, T);

    it(`${nameOf(trust)}: an answer that is not a set of values is a bug, in the developer's words`, async () => {
      for (const source of [`function () { return "Catena"; }`, `function () { return ["Catena"]; }`, `function () { return 7; }`]) {
        const failure = actionFailure((await fill(trust, source)).error);
        expect(failure.kind).toBe("broke");
        expect(failure.detail).toMatch(/returns the values to fill, by field key/);
      }
    }, T);

    it(`${nameOf(trust)}: a huge string is not handed to the form`, async () => {
      const failure = actionFailure((await fill(trust, `function () { return { notes: "x".repeat(${FILL_LIMITS.chars + 1}) }; }`)).error);
      expect(failure.kind).toBe("broke");
      expect(failure.detail).toMatch(/more than 2000000 characters/);
    }, T);

    it(`${nameOf(trust)}: what the function throws is sorted like an action's failure`, async () => {
      expect(actionFailure((await fill(trust, `function () { throw new Error("Hold the label flat"); }`)).error)).toMatchObject({ kind: "said", message: "Hold the label flat" });
      expect(actionFailure((await fill(trust, `function (draft) { return draft.nope.deeper; }`)).error).kind).toBe("broke");
    }, T);

    it(`${nameOf(trust)}: the draft is a copy — changing it changes nothing outside`, async () => {
      const draft = { name: "Catena", tags: ["red"] };
      const r = await fill(trust, `function (draft) { draft.name = "changed"; draft.tags.push("x"); return { notes: draft.name + " " + draft.tags.length }; }`, { draft });
      expect(r.outcome!.values).toEqual({ notes: "changed 2" });
      expect(draft).toEqual({ name: "Catena", tags: ["red"] });
    }, T);

    it(`${nameOf(trust)}: a picture taken in it comes back as the reference a media field takes`, async () => {
      const r = await fill(trust, `async function (draft, ctx) { var shot = await ctx.caps.camera.capture(); var a = await ctx.caps.ai.extract({ schema: { name: "text", grape: "text?" }, image: shot }); return { label: await ctx.media.put(shot), name: a.name, grape: a.grape }; }`, {
        permissions: { camera: true, ai: true },
      });
      expect(r.error).toBeUndefined();
      const label = r.outcome!.values.label as { key: string; mime: string };
      expect(label).toMatchObject({ mime: "image/png" });
      expect(Array.from(new Uint8Array(await (await r.store.getBlob(label))!.arrayBuffer()))).toEqual(Array.from(PNG));
      expect(r.outcome!.values.name).toBe("Catena");
      // The AI read a grape the field does not list: refused, by the field's own rule.
      expect(r.outcome!.refused.map((x) => x.field)).toEqual(["grape"]);
      expect(r.asked).toBe(1);
    }, T);

    it(`${nameOf(trust)}: it saves nothing by returning values`, async () => {
      const r = await fill(trust, `function () { return { name: "Catena", year: 2019 }; }`);
      expect(await r.store.all("bottle")).toEqual([]);
    }, T);
  }

  for (const runner of RUNNERS) {
    it(`${runner.name}: a function in the answer never reaches the host as one`, async () => {
      const r = await fill(runner, `function () { return { name: "Catena", notes: function () { return "pwned"; } }; }`);
      // The realm cannot send it at all (the engine's error: a bug, never words); QuickJS drops it.
      if (r.error) expect(actionFailure(r.error).kind).toBe("broke");
      else expect(r.outcome!.values).toEqual({ name: "Catena" });
    }, 30_000);

    it(`${runner.name}: "Not now" to the AI question is an answer, not a failure`, async () => {
      const r = await fill(runner, `async function (draft, ctx) { var a = await ctx.caps.ai.extract({ schema: { name: "text" }, text: "Catena 2019" }); return { name: a.name }; }`, {
        permissions: { ai: true },
        confirm: (m) => !/AI/.test(m),
      });
      expect(declined(r.error)).toBe(true);
      expect(r.asked).toBe(0);
    }, 30_000);

    it(`${runner.name}: an undeclared capability stays out of reach in a fill, as in an action`, async () => {
      const r = await fill(runner, `function (draft, ctx) { return { notes: typeof ctx.caps.camera + " " + typeof ctx.caps.ai }; }`);
      expect(r.outcome!.values).toEqual({ notes: "undefined undefined" });
    }, 30_000);
  }
});

describe("checkFill: what a fill returned, against the entity's fields", () => {
  const fields = FIELDS as never;

  it("trusted: a function, a Blob, a class instance or a cycle in a value is refused by the field's own rule", () => {
    class Wine {
      name = "Catena";
    }
    const loop: Record<string, unknown> = { lat: 1, lng: 2 };
    loop.self = loop;
    const out = checkFill("bottle", fields, { name: () => "x", label: new Blob(["x"]), notes: new Wine(), tags: [Symbol("t")], tasted: loop, year: 10n });
    expect(out.values).toEqual({});
    expect(out.refused.map((r) => [r.field, r.issue.rule])).toEqual([
      ["name", "text"],
      ["label", "media"],
      ["notes", "text"],
      ["tags", "tags"],
      ["tasted", "date"],
      ["year", "number"],
    ]);
  });

  it("copies what it accepts: the form never holds the app's own objects", () => {
    const tags = ["red"];
    const tasted = new Date("2024-05-01T00:00:00Z");
    const out = checkFill("bottle", fields, { tags, tasted });
    expect(out.values).toEqual({ tags: ["red"], tasted });
    expect(out.values.tags).not.toBe(tags);
    expect(out.values.tasted).not.toBe(tasted);
  });

  it("null clears nothing and breaks nothing: it is a value the form may take or ignore", () => {
    expect(checkFill("bottle", fields, { name: null, year: undefined })).toEqual({ values: { name: null }, refused: [], unknown: [] });
  });

  it("refuses more keys than any form has fields", () => {
    const many = Object.fromEntries(Array.from({ length: FILL_LIMITS.keys + 1 }, (_, i) => [`k${i}`, i]));
    expect(() => checkFill("bottle", fields, many)).toThrow(TypeError);
  });

  it("a draft is copied as plain data, leaving out what is not", () => {
    const when = new Date("2024-05-01T00:00:00Z");
    const draft = { name: "Catena", when, fn: () => 1, rows: [{ a: 1 }] };
    const copy = draftCopy(draft);
    expect(copy).toEqual({ name: "Catena", when, rows: [{ a: 1 }] });
    expect(copy.rows).not.toBe(draft.rows);
  });
});

describe("declined: the person said no", () => {
  it("knows a closed picker and a refused question from a failure", () => {
    expect(declined(new Error("Cancelled: no file was chosen"))).toBe(true);
    expect(declined(Object.assign(new Error("Permission denied: Cellar → AI"), { code: "denied" }))).toBe(true);
    expect(declined(new Error("The label is too blurry"))).toBe(false);
    expect(declined(new TypeError("x is undefined"))).toBe(false);
  });
});
