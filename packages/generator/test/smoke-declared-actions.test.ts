// The smoke gate runs every action to catch hallucinated ctx methods. An action that declares its
// input (#213) must actually run there, with seeded input, rather than stop at a form nobody answers.

import { describe, expect, it } from "vitest";
import { defineApp } from "karta";
import { smokeApp } from "../src/smoke.js";

const app = (run: (r: never, ctx: never, input: never) => unknown) =>
  defineApp({
    id: "feeds",
    name: "Feeds",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      plant: {
        displayField: "name",
        fields: { name: { type: "text", required: true }, fed: { type: "number" } },
        actions: { feed: { label: "Feed", input: { grams: { type: "number", min: 1, required: true } }, run } },
      },
    },
    pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant", rowActions: ["feed"] } }],
  } as never);

describe("smoke runs declared actions", () => {
  it("with input that fits, so their code really runs", async () => {
    const seen: unknown[] = [];
    const report = await smokeApp(app(((_r: unknown, _ctx: unknown, input: unknown) => void seen.push(input)) as never));
    expect(report.errors).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect((seen[0] as { grams: number }).grams).toBeGreaterThanOrEqual(1);
  });

  it("and so catches a ctx method that does not exist", async () => {
    const report = await smokeApp(app(((_r: unknown, ctx: { nope: () => void }) => ctx.nope()) as never));
    expect(report.errors.join()).toMatch(/feed/);
  });
});
