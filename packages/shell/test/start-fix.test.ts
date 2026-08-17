import { describe, expect, it, vi } from "vitest";
import { addStep, newCase } from "@karta/runtime";
import { startFix } from "../src/start-fix.js";
import { DEFAULT_ENGINE_CONFIG } from "../src/engines.js";

const aCase = () => addStep(newCase("city-maps", "clicking a city"), { kind: "open", page: "nowhere" });

const runtime = {
  definition: { pages: [{ id: "all", title: "Cities", view: { type: "list", entity: "city" } }] },
  queryPage: async () => ({ rows: [], ctx: {} }),
  ctx: { query: async () => [] },
} as never;

describe("startFix", () => {
  // The engine picker offers five engines; only one can drive a tool loop. Discovering that at
  // runtime, mid-loop, would be the worst place to find out.
  it("refuses an engine that cannot investigate, before spending anything", async () => {
    const out = await startFix({
      source: "x",
      theCase: aCase(),
      runtime,
      store: null as never,
      engine: { ...DEFAULT_ENGINE_CONFIG, engine: "cli" },
    });

    expect(out.kind).toBe("diagnosis");
    expect((out as { text: string }).text).toMatch(/claude -p|cannot investigate/i);
  });

  it("refuses a cloud engine with no key", async () => {
    const out = await startFix({
      source: "x",
      theCase: aCase(),
      runtime,
      store: null as never,
      engine: { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "" },
    });

    expect(out.kind).toBe("diagnosis");
    expect((out as { text: string }).text).toMatch(/key/i);
  });
});
