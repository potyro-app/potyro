// Proves async computed that call ctx.query now work in the UNTRUSTED isolate too: exercise
// .lastBest (async) queries session history from inside the QuickJS sandbox and matches the
// trusted result. This closes the earlier "async computed don't await in the isolate" caveat.

import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import workout from "../../../examples/workout.app.ts";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import type { NavBridge, UiBridge } from "@karta/host";
import { compose } from "../src/compose.js";
import { createSandboxLoader } from "../src/isolate-bridge.js";
import { seedIfEmpty } from "../src/seed.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function bundleWorkout(): Promise<string> {
  const result = await build({
    entryPoints: [here("../../../examples/workout.app.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__sandbox",
    platform: "browser",
    target: "es2020",
    footer: { js: "globalThis.__kartaApp = (__sandbox && __sandbox.default) ? __sandbox.default : __sandbox;" },
    alias: {
      karta: here("../src/isolate-stubs/karta.ts"),
      react: here("../src/isolate-stubs/react.ts"),
      "react/jsx-runtime": here("../src/isolate-stubs/react.ts"),
      "react/jsx-dev-runtime": here("../src/isolate-stubs/react.ts"),
    },
  });
  return result.outputFiles[0]!.text;
}

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

async function seededStore(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("workout");
  await seedIfEmpty(s, "workout");
  return s;
}

let bundleCode: string;
beforeAll(async () => {
  bundleCode = await bundleWorkout();
}, 30000);

function bestOf(rows: readonly any[], name: string): { kg?: number; reps?: number; score?: number } | null {
  return rows.find((r) => r.name === name)?.lastBest ?? null;
}

describe("workout async computed in the isolate (lastBest via ctx.query)", () => {
  it("matches trusted for Squat and Bench Press", async () => {
    const trustedStore = await seededStore();
    const trusted = await compose({ app: workout, provenance: "trusted", store: trustedStore, caps: new FakeCapabilities(), ui, nav });
    const trustedRows = (await trusted.runtime.queryPage("program")).rows;

    const untrustedStore = await seededStore();
    const loadIsolated = await createSandboxLoader(untrustedStore);
    const untrusted = await compose({
      app: workout,
      provenance: "untrusted",
      bundleCode,
      store: untrustedStore,
      caps: new FakeCapabilities(),
      ui,
      nav,
      loadIsolated,
    });
    const untrustedRows = (await untrusted.runtime.queryPage("program")).rows;

    for (const name of ["Squat", "Bench Press"]) {
      const t = bestOf(trustedRows, name);
      const u = bestOf(untrustedRows, name);
      expect(u).not.toBeNull();
      expect(u!.score).toBe(t!.score); // computed the same way, isolate vs direct
      expect(u!.kg).toBe(t!.kg);
      expect(u!.reps).toBe(t!.reps);
    }
    // Squat best = 110kg × 5 = 550 (heaviest-scoring set across seeded legs history)
    expect(bestOf(untrustedRows, "Squat")).toMatchObject({ kg: 110, reps: 5, score: 550 });
    untrusted.runtime.core.app.dispose();
  }, 30000);
});
