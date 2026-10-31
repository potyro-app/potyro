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
