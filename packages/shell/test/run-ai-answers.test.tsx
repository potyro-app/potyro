// @vitest-environment happy-dom
//
// The candidate run drives an action's AI path with the answers a real model gives (#74). The app
// here is the one that got through: it photographs a label, asks `ctx.caps.ai.extract` for what is on
// it and writes the answer into fields with fixed options. It runs where the Studio runs a candidate —
// bundled, in the QuickJS isolate — with the run's own stand-in camera and AI; no model is called.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { defineApp, type PotyroApp } from "potyro";
import type { Capabilities } from "@potyro/capabilities";
import type { MemoryStore } from "@potyro/store";
import { regressionGate } from "@potyro/generator/backends";
import { bundleAppSource, potyroStub, type EsbuildLike } from "../src/app-bundler.js";
import { compose } from "../src/compose.js";
import { createSandboxLoader } from "../src/isolate-bridge.js";
import { createNavBridge } from "../src/ui-bridge.js";
import { runCandidate } from "../src/run-candidate.js";

afterEach(() => vi.restoreAllMocks());

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const UI = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

let stubs: { potyro: string; react: string };
beforeAll(() => {
  stubs = { potyro: potyroStub(read("../src/isolate-stubs/potyro.ts"), read("../../schema/src/money.ts")), react: read("../src/isolate-stubs/react.ts") };
});

/** As the Studio composes a candidate: bundled, untrusted, in the isolate — with the run's capabilities. */
const isolated = async (source: string, store: MemoryStore, caps: Capabilities) =>
  compose({
    provenance: "untrusted",
    bundleCode: await bundleAppSource(source, esbuild as unknown as EsbuildLike, stubs),
    store,
    caps,
    ui: UI,
    nav: createNavBridge(() => {}),
    loadIsolated: await createSandboxLoader(store, { timeoutMs: 5_000, loadTimeoutMs: 5_000 }),
  });

const run = (source: string) => runCandidate(source, { compose: isolated, settleMs: 300 });

const SCHEMA = `{ name: "text?", grape: "text?", country: "text?", alcohol: "number?", bio: "boolean?" }`;

/** A cellar. `scan` is the record's action, `add` the page's button; each is the body of an async function. */
const cellar = (scan: string, add = "") => `
import { defineApp } from "potyro";
const GRAPES = ["merlot", "syrah", "riesling"];
const COUNTRIES = ["france", "italy", "germany"];
export default defineApp({
  id: "cellar", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  permissions: { camera: true, ai: true },
  entities: {
    bottle: {
      label: "Bottle", displayField: "name",
      fields: {
        name: { type: "text", required: true },
        grape: { type: "enum", options: GRAPES, required: true },
        country: { type: "enum", options: COUNTRIES },
        alcohol: { type: "number" },
        bio: { type: "boolean" },
        photoFront: { type: "media" },
      },
      actions: { scanLabel: { label: "Scan label", run: async (bottle, ctx) => { ${scan} } } },
    },
  },
  pages: [{
    id: "all", title: "All", view: { type: "list", entity: "bottle", display: { primary: "name" } },
    ${add ? `actions: [{ label: "Scan a bottle", run: async (ctx) => { ${add} } }],` : ""}
  }],
});`;

/** The generated action, as it shipped: whatever the model answered goes into the record. */
const NAIVE_SCAN = `
  const blob = await ctx.caps.camera.capture();
  const ref = await ctx.media.put(blob);
  const info = await ctx.caps.ai.extract({ image: blob, instructions: "A wine label.", schema: ${SCHEMA} });
  await ctx.patch("bottle", bottle.id, { photoFront: ref, grape: info.grape ?? bottle.grape, country: info.country ?? bottle.country, alcohol: info.alcohol ?? bottle.alcohol });`;

const NAIVE_ADD = `
  const blob = await ctx.caps.camera.capture();
  const info = await ctx.caps.ai.extract({ image: blob, instructions: "A wine label.", schema: ${SCHEMA} });
  await ctx.create("bottle", { name: info.name.trim(), grape: info.grape, country: info.country, photoFront: await ctx.media.put(blob) });`;

/** The same two, taking only what the app has an option for and falling back when there is nothing. */
const CAREFUL_SCAN = `
  const blob = await ctx.caps.camera.capture();
  const ref = await ctx.media.put(blob);
  const info = await ctx.caps.ai.extract({ image: blob, instructions: "A wine label.", schema: ${SCHEMA} });
  const one = (list, v, fallback) => (typeof v === "string" && list.includes(v.toLowerCase()) ? v.toLowerCase() : fallback);
  await ctx.patch("bottle", bottle.id, { photoFront: ref, grape: one(GRAPES, info.grape, bottle.grape), country: one(COUNTRIES, info.country, bottle.country), alcohol: info.alcohol ?? bottle.alcohol });`;

const CAREFUL_ADD = `
  const blob = await ctx.caps.camera.capture();
  const info = await ctx.caps.ai.extract({ image: blob, instructions: "A wine label.", schema: ${SCHEMA} });
  const one = (list, v, fallback) => (typeof v === "string" && list.includes(v.toLowerCase()) ? v.toLowerCase() : fallback);
  await ctx.create("bottle", { name: info.name || "A bottle", grape: one(GRAPES, info.grape, "merlot"), country: one(COUNTRIES, info.country, undefined), photoFront: await ctx.media.put(blob) });`;

describe("the candidate run answers an action's AI calls (#74)", () => {
  it("runs an action that begins with a capture and an extraction, instead of stopping at its first line", async () => {
    const report = await run(cellar(CAREFUL_SCAN));
    expect(report.errors).toEqual([]);
    expect(report.ran).toContain("1 action");
    expect(report.ran).toContain("the AI was a stand-in");
  }, 30_000);

  it("fails an action that writes whatever the AI answered into a field with fixed options", async () => {
    const report = await run(cellar(NAIVE_SCAN));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^the "Scan label" action \(bottle\.scanLabel\) fails when the AI answers name, grape, country with text that is in no list/);
    expect(report.errors[0]).toBe(
      'the "Scan label" action (bottle.scanLabel) fails when the AI answers name, grape, country with text that is in no list ("Something not in any list"): isolate app error: Grape must be one of: merlot, syrah, riesling.',
    );
  }, 30_000);

  it("fails a page's button under each answer it cannot take: nothing found, and a value its list does not hold", async () => {
    const report = await run(cellar(CAREFUL_SCAN, NAIVE_ADD));
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toMatch(/^the "Scan a bottle" button of page "all" fails when the AI finds no name, grape, country, alcohol and 1 more/);
    expect(report.errors[0]).toBe(
      `the "Scan a bottle" button of page "all" fails when the AI finds no name, grape, country, alcohol and 1 more (it answers null, or an empty list): isolate app error: cannot read property 'trim' of null`,
    );
    expect(report.errors[1]).toMatch(/^the "Scan a bottle" button of page "all" fails when the AI answers name, grape, country with text that is in no list/);
    expect(report.errors[1]).toMatch(/Grape must be one of/);
  }, 30_000);

  it("passes both once they take only what the app has an option for", async () => {
    const report = await run(cellar(CAREFUL_SCAN, CAREFUL_ADD));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ran).toContain("2 actions read an answer from it, and ran again with everything optional missing and with text in no list (4 more runs)");
  }, 30_000);

  it("gives an answer its plausible form first: a value the app's own list holds, so a working path is not failed", async () => {
    // Written straight into the list, and right to: the shape holds the model to the app's options.
    const strict = `
      const info = await ctx.caps.ai.extract({ image: await ctx.caps.camera.capture(), schema: { grape: { oneOf: GRAPES }, year: "number" } });
      await ctx.patch("bottle", bottle.id, { grape: info.grape, alcohol: info.year });`;
    const report = await run(cellar(strict));
    expect(report.errors).toEqual([]);
    // Nothing optional and no free text: no other answer exists, so it is not run again.
    expect(report.ran).not.toContain("ran again");
  }, 30_000);
});

describe("an AI failure and the regression gate (#74, #262)", () => {
  const gate = (original: string) => regressionGate(run, original);

  it("holds back a change that brings the failure in", async () => {
    const { report, preexisting } = await gate(cellar(CAREFUL_SCAN))(cellar(NAIVE_SCAN));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('the "Scan label" action (bottle.scanLabel) fails when the AI answers');
    expect(preexisting.errors).toEqual([]);
  }, 30_000);

  it("lets a change through when the app already failed that way, and says it was already there", async () => {
    const changed = cellar(NAIVE_SCAN).replace('bio: { type: "boolean" },', 'bio: { type: "boolean" }, vintage: { type: "number" },');
    const { report, preexisting } = await gate(cellar(NAIVE_SCAN))(changed);
    expect(report.errors).toEqual([]);
    expect(preexisting.errors).toHaveLength(1);
    expect(preexisting.errors[0]).toContain("Grape must be one of");
  }, 30_000);
});

describe("the AI passes keep to a budget (#74)", () => {
  const counted = (body: (ctx: never, runs: string[]) => Promise<void>, runs: string[]): PotyroApp =>
    defineApp({
      id: "counted",
      name: "Counted",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        note: {
          label: "Note",
          displayField: "title",
          fields: { title: { type: "text", required: true }, kind: { type: "enum", options: ["idea", "task"] } },
          actions: {
            plain: async () => {
              runs.push("plain");
            },
            read: async (_r: never, ctx: never) => body(ctx, runs),
          },
        },
      },
      pages: [{ id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } }, actions: [{ label: "Tidy", run: async () => void runs.push("tidy") }] }],
    } as never);
  const direct = (app: PotyroApp) => (_s: string, store: MemoryStore, caps: Capabilities) =>
    compose({ provenance: "trusted", app, store, caps, ui: UI, nav: createNavBridge(() => {}) });
  type Ai = { caps: { ai: { extract(r: unknown): Promise<Record<string, unknown>>; ask(q: string): Promise<string> } } };

  it("runs again only the action that read an answer, once per answer that differs", async () => {
    const runs: string[] = [];
    const app = counted(async (ctx, log) => {
      const a = await (ctx as Ai).caps.ai.extract({ text: "a note", schema: { kind: "text?" } });
      log.push(`read ${String(a.kind)}`);
    }, runs);
    const report = await runCandidate("", { compose: direct(app), settleMs: 300 });
    expect(report.errors).toEqual([]);
    // "kind" is a field with a list, so the plausible answer is one of its options.
    expect(runs).toEqual(["plain", "read idea", "read null", "read Something not in any list", "tidy"]);
  });

  it("does not run an action again for an answer in words: there is one kind of sentence", async () => {
    const runs: string[] = [];
    const app = counted(async (ctx, log) => {
      log.push(`asked: ${await (ctx as Ai).caps.ai.ask("What is this?")}`);
    }, runs);
    const report = await runCandidate("", { compose: direct(app), settleMs: 300 });
    expect(report.errors).toEqual([]);
    expect(runs).toEqual(["plain", "asked: Something not in any list.", "tidy"]);
    expect(report.ran).not.toContain("stand-in");
  });

  it("says once what fails the same way under every answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = counted(async (ctx) => {
      await (ctx as Ai).caps.ai.extract({ text: "a note", schema: { kind: "text?" } });
      throw new Error("no such thing");
    }, []);
    const report = await runCandidate("", { compose: direct(app), settleMs: 300 });
    expect(report.errors).toEqual(["action note.read: no such thing"]);
  });

  it("leaves a page's button that waits on something nobody answers unjudged, and still finishes", async () => {
    const app = counted(async () => {}, []);
    (app as unknown as { pages: Array<{ actions: Array<{ run: () => Promise<void> }> }> }).pages[0]!.actions[0]!.run = () => new Promise<void>(() => {});
    const started = Date.now();
    const report = await runCandidate("", { compose: direct(app), settleMs: 300, answerMs: 200 });
    expect(report.errors).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports an action that never finishes under an answer it finished on before", async () => {
    const app = counted(async (ctx) => {
      const a = await (ctx as Ai).caps.ai.extract({ text: "a note", schema: { kind: "text?" } });
      if (a.kind === null) await new Promise<void>(() => {});
    }, []);
    const report = await runCandidate("", { compose: direct(app), settleMs: 300, answerMs: 200 });
    expect(report.errors).toEqual(['the "Read" action (note.read) does not finish when the AI finds no kind (it answers null, or an empty list): it was still running after 0.2s']);
    expect(report.ran).toContain("not every answer was tried");
  });
});
