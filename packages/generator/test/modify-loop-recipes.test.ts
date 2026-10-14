// The case the paid eval caught (#262): adding a 1–5 rating to the recipes example went from 3/3 to
// 0/3 once candidates were run, because the run blamed the change for failures the app already had.
// Here the loop runs for real — the scripted reply is the edit a model sends, and the check, the
// shape and the run are the eval's own (bundle, validate, seed, run) — on the example as it ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runModifyLoop } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";
import { loadApp, scoreSource } from "../src/score.js";
import { smokeApp, smokeReport } from "../src/smoke.js";
import { regressionGate, type RunReport } from "../src/run-report.js";
import type { ChatEngine } from "../src/chat-backend.js";
import type { AppShape } from "@potyro/runtime";

const dir = fileURLToPath(new URL("../../../examples/", import.meta.url));
const shipped = readFileSync(`${dir}recipes.app.tsx`, "utf8");

// The example is in six languages (#303), so the new field's label is too: a label in English only
// is a gap the check sends back.
const OVERVIEW = '{ title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" }';
const ADD_RATING = [
  "A 1–5 rating is a whole number, which the number field covers; it goes in the Overview group.",
  "```ts",
  "<<<<<<< SEARCH",
  "        ingredients: {",
  '          type: "list",',
  "=======",
  '        rating: { type: "number", min: 1, max: 5, integer: true, label: { en: "Rating", "pt-BR": "Nota", de: "Bewertung", es: "Valoración", pl: "Ocena", it: "Voto" } },',
  "        ingredients: {",
  '          type: "list",',
  ">>>>>>> REPLACE",
  "<<<<<<< SEARCH",
  `        ${OVERVIEW}, fields: ["name", "status", "photo", "tags"] },`,
  "=======",
  `        ${OVERVIEW}, fields: ["name", "status", "photo", "tags", "rating"] },`,
  ">>>>>>> REPLACE",
  "```",
].join("\n");

function scripted(replies: string[]): { engine: ChatEngine; calls: () => number } {
  let i = 0;
  return {
    calls: () => i,
    engine: { chat: { completions: { create: async () => ({ choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)]! } }] }) } } },
  };
}

const check = async (src: string): Promise<string[]> => {
  const r = await scoreSource(src, dir);
  if (!r.compiles) throw new Error(r.errors.join("; "));
  return r.validates ? [] : r.errors;
};
const shapeOf = async (src: string): Promise<AppShape> => {
  const app = (await loadApp(src, dir)) as unknown as AppShape;
  return { entities: app.entities, pages: app.pages };
};
const nodeRun = async (src: string): Promise<RunReport> => smokeReport(await smokeApp((await loadApp(src, dir)) as never));

async function addRating(original: string) {
  const { engine, calls } = scripted([ADD_RATING]);
  const run = regressionGate(nodeRun, original);
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const out = await runModifyLoop({
      engine,
      tools: buildDiscoveryTools({ check, run, source: original }),
      system: "contract",
      instruction: "add a 1-5 star rating",
      source: original,
      check,
      run,
      shapeOf,
      before: await shapeOf(original),
    });
    return { out, calls: calls() };
  } finally {
    console.warn = quiet;
  }
}

describe("adding a field to the recipes example, with candidates run", () => {
  it("passes the gate on the first candidate", async () => {
    const { out, calls } = await addRating(shipped);
    expect(out.kind).toBe("source");
    expect(out.kind === "source" && out.source).toContain('rating: { type: "number", min: 1, max: 5');
    expect(calls).toBe(1);
  }, 60_000);

  it("still passes when the app already had a failing computed the change does not touch", async () => {
    // A computed that throws in every record, already there before the change.
    const failing = shipped.replace(/computed: \{/, "computed: {\n        broken: (r) => (r as unknown as { nothing: { here: number } }).nothing.here,");
    expect((await nodeRun(failing)).errors.join("\n")).toMatch(/computed \w+\.broken/);
    const { out, calls } = await addRating(failing);
    expect(out.kind).toBe("source");
    expect(calls).toBe(1);
  }, 60_000);
});
