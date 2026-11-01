// The seeds the repository's own packages ship with (apps/*/seed.json) fit their apps as they are:
// fitting a seed as an app opens (#486) must never drop a row of a package's own sample records.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { EntityDef } from "potyro";
import { seedThatFits, type AppSeed } from "../src/app-seed.js";

// Mood & sleep imports chart.js by URL, which only the shell resolves; its shape is what is read here.
vi.mock("https://esm.sh/chart.js@4.5.1?bundle", () => ({ Chart: class {}, registerables: [] }));

const APPS: Array<[string, () => Promise<{ default: { entities?: Record<string, EntityDef> } }>]> = [
  ["mood-sleep", () => import("../../../apps/mood-sleep/mood-sleep.app.ts") as never],
  ["receipt-split", () => import("../../../apps/receipt-split/receipt-split.app.ts") as never],
  ["markdown-notes", () => import("../../../apps/markdown-notes/notes.app.tsx") as never],
  ["which-is-cheaper", () => import("../../../apps/which-is-cheaper/which-is-cheaper.app.tsx") as never],
];

describe("a package's own seed.json fits its app", () => {
  for (const [dir, load] of APPS) {
    it(dir, async () => {
      const seed = JSON.parse(readFileSync(new URL(`../../../apps/${dir}/seed.json`, import.meta.url), "utf8")) as AppSeed;
      const app = (await load()).default;
      expect(seedThatFits(seed, app.entities)).toEqual(seed);
    }, 60_000);
  }
});

// A demo link of a bundled example carries its first-run records, and the device that opens it fits
// them to the app as it loads there (demo.tsx, #486): that must never drop one of them either.
const EXAMPLES: Array<[string, () => Promise<{ default: { entities?: Record<string, EntityDef> } }>]> = [
  ["groceries", () => import("../../../examples/groceries.app.ts") as never],
  ["places", () => import("../../../examples/places.app.ts") as never],
  ["plants", () => import("../../../examples/plants.app.ts") as never],
  ["recipes", () => import("../../../examples/recipes.app.tsx") as never],
  ["split", () => import("../../../examples/split.app.ts") as never],
  ["workout", () => import("../../../examples/workout.app.tsx") as never],
];

describe("a bundled example's demo records fit its app", () => {
  for (const [id, load] of EXAMPLES) {
    it(id, async () => {
      const { demoSeed } = await import("../src/demo-package.js");
      const entities = (await load()).default.entities!;
      const seed = await demoSeed(id, Object.keys(entities));
      expect(seed).toBeDefined();
      expect(seedThatFits(seed, entities)).toEqual(seed);
    }, 60_000);
  }
});
