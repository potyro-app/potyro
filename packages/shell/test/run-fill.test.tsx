// @vitest-environment happy-dom
//
// The candidate run runs a form's fill buttons (#81). A fill saves nothing, so nothing else in the
// run would ever call it: here each is run on a new record's draft and on a sample record's, and —
// when it reads a structured answer from `ctx.caps.ai` — again on the awkward answers. What it
// throws, a value it returns that its field refuses, and a key that is no field come back in words
// naming the button. It runs where the Studio runs a candidate: bundled, in the QuickJS isolate,
// with the run's stand-in camera and AI; no model is called.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import type { Capabilities } from "@potyro/capabilities";
import type { MemoryStore } from "@potyro/store";
import { bundleAppSource, potyroStub, type EsbuildLike } from "../src/app-bundler.js";
import { compose } from "../src/compose.js";
import { createSandboxLoader } from "../src/isolate-bridge.js";
import { createNavBridge } from "../src/ui-bridge.js";
import { runCandidate } from "../src/run-candidate.js";
import { fillProblem } from "../src/run-ai-answers.js";

afterEach(() => vi.restoreAllMocks());

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const UI = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

let stubs: { potyro: string; react: string };
beforeAll(() => {
  stubs = { potyro: potyroStub(read("../src/isolate-stubs/potyro.ts"), read("../../schema/src/money.ts")), react: read("../src/isolate-stubs/react.ts") };
});

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

const SCHEMA = `{ name: "text?", grape: "text?", year: "number?" }`;

/** A cellar whose bottle form has one fill button; `fill` is the body of `async (draft, ctx) => { … }`. */
const cellar = (fill: string, guide = "") => `
import { defineApp } from "potyro";
const GRAPES = ["merlot", "syrah", "riesling"];
export default defineApp({
  id: "cellar", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  permissions: { camera: true, ai: true },
  ${guide ? `guide: [${JSON.stringify(guide)}],` : ""}
  entities: {
    bottle: {
      label: "Bottle", displayField: "name",
      fields: {
        name: { type: "text", required: true },
        grape: { type: "enum", options: GRAPES },
        year: { type: "number", integer: true, min: 1900 },
        label: { type: "media" },
      },
      fill: [{ label: "Scan label", icon: "camera", run: async (draft, ctx) => { ${fill} } }],
    },
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "bottle", display: { primary: "name" } } }],
});`;

const READ = `
  const blob = await ctx.caps.camera.capture();
  const info = await ctx.caps.ai.extract({ image: blob, instructions: "A wine label.", schema: ${SCHEMA} });`;

/** As a model first writes it: whatever the AI answered goes into the form. */
const NAIVE = `${READ}
  return { label: await ctx.media.put(blob), name: info.name.trim(), grape: info.grape, year: info.year };`;

/** Taking only what the app has an option for, and nothing where there is nothing. */
const CAREFUL = `${READ}
  const grape = typeof info.grape === "string" && GRAPES.includes(info.grape.toLowerCase()) ? info.grape.toLowerCase() : undefined;
  const year = Number.isInteger(info.year) && info.year >= 1900 ? info.year : undefined;
  return { label: await ctx.media.put(blob), name: info.name ?? undefined, grape, year };`;

const NAME = `the "Scan label" fill button of the bottle form`;

describe("the candidate run runs a form's fill buttons (#81)", () => {
  it("a careful fill passes, and the run says it ran it", async () => {
    const report = await run(cellar(CAREFUL));
    expect(report.errors).toEqual([]);
    expect(report.ran).toContain("the AI was a stand-in");
    expect(report.ran).toContain("1 form fill button");
  }, 30_000);

  it("a naive fill fails on the answers a real model gives, each named with the answer and the cause", async () => {
    const report = await run(cellar(NAIVE));
    expect(report.errors).toEqual([
      // A plausible answer is still a model's: a number is whatever number it read.
      `${NAME} fails when the AI answers every key it was asked for: the value it returns for bottle.year is refused — year takes a number of at least 1900`,
      `${NAME} fails when the AI finds no name, grape, year (it answers null, or an empty list): TypeError: cannot read property 'trim' of null`,
      `${NAME} fails when the AI answers name, grape with text that is in no list ("Something not in any list"): the value it returns for bottle.grape is refused — grape takes one of "merlot", "syrah", "riesling"; the value it returns for bottle.year is refused — year takes a number of at least 1900`,
    ]);
  }, 30_000);

  it("a fill that reads no AI is run too: a throw, and a returned value its field refuses", async () => {
    const thrown = await run(cellar(`return { name: draft.title.trim() };`));
    expect(thrown.errors).toHaveLength(1);
    expect(thrown.errors[0]).toMatch(new RegExp(`^${NAME} fails: TypeError: `));
    expect(thrown.ran).toContain("1 form fill button was run on a new and a sample record");

    const refused = await run(cellar(`return { name: "Catena", year: "2019", grape: "Malbec" };`));
    expect(refused.errors).toEqual([
      `${NAME} fails: the value it returns for bottle.year is refused — year takes a finite number; the value it returns for bottle.grape is refused — grape takes one of "merlot", "syrah", "riesling"`,
    ]);
  }, 30_000);

  it("a key that is no field of the entity is said: the form would drop it", async () => {
    const report = await run(cellar(`return { name: "Catena", vintage: 2019 };`));
    expect(report.errors).toEqual([`${NAME} fails: it returns "vintage", which is no field of bottle — a fill returns values by field key, and the rest is dropped`]);
  }, 30_000);

  it("a fill that only breaks on a record's own values is caught on the edit form", async () => {
    const report = await run(cellar(`if (draft.id) return { year: 12 }; return { name: "Catena" };`));
    expect(report.errors).toEqual([`${NAME} fails on the edit form: the value it returns for bottle.year is refused — year takes a number of at least 1900`]);
  }, 30_000);

  it("an answer that is not a set of values is an error in the developer's words", async () => {
    const report = await run(cellar(`return "Catena";`));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain(`${NAME} fails: TypeError: a form's fill returns the values to fill, by field key`);
  }, 30_000);

  it("a fill that returns nothing, or saves nothing, is fine — and the records are left as seeded", async () => {
    const report = await run(cellar(`return;`));
    expect(report.errors).toEqual([]);
  }, 30_000);

  it("the guide may name the fill button; a name nothing has is still a warning", async () => {
    expect((await run(cellar(CAREFUL, "Adding a bottle? Tap “Scan label” and check what it read."))).warnings.filter((w) => w.includes("guide"))).toEqual([]);
    expect((await run(cellar(CAREFUL, "Tap “Read the label” first."))).warnings.join("\n")).toContain("names “Read the label”");
  }, 30_000);
});

describe("fillProblem", () => {
  it("is null for an answer the form takes whole", () => {
    expect(fillProblem("bottle", { values: { name: "Catena" }, refused: [], unknown: [] })).toBeNull();
  });
  it("counts the keys past the first few", () => {
    expect(fillProblem("bottle", { values: {}, refused: [], unknown: ["a", "b", "c", "d", "e", "f"] })).toBe(
      `it returns "a", "b", "c", "d" and 2 more, which are no fields of bottle — a fill returns values by field key, and the rest is dropped`,
    );
  });
});
