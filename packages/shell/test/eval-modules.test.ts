// @vitest-environment happy-dom
//
// PAID, opt-in: does the Studio now make a change whose code is in one of an app's own modules (#448)?
//
//   POTYRO_MODULES_EVAL=1 OPENROUTER_API_KEY=sk-or-… pnpm --filter @potyro/shell exec vitest run test/eval-modules.test.ts
//   … MODEL=<openrouter id> RUNS=2 OUT=/tmp/modules-eval.json   (defaults: the Studio's model, 1 run)
//
// Each case is a real app from apps/ and a request a person would make whose code lives in a module
// (piano's rest day in progress.ts, daily-puzzle's tries in puzzle.ts, palette-catcher's grey names in
// names.ts), plus one control aimed at the entry file. Each runs twice through the Studio's own path
// (`studioEngine().modify`, the modify loop and every gate, real): BEFORE — the model shown the entry
// alone, as before #448 — and AFTER — shown every file. Whether the change LANDED is checked
// mechanically on the files that came back; cost is what OpenRouter reported. Skipped without both
// variables, so `pnpm test` never spends anything.

import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { lockEntryFor, srcKey, type AppLock } from "@potyro/store";
import type { EsbuildLike } from "../src/app-bundler.js";
import { memoryModules, withLibrariesStoodIn, type ModuleSource } from "../src/package-modules.js";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const RUN = process.env.POTYRO_MODULES_EVAL === "1" && !!process.env.OPENROUTER_API_KEY;
type Meter = { calls: number; cost: number; unpriced: number };
const newMeter = (): Meter => ({ calls: 0, cost: 0, unpriced: 0 });
const state = vi.hoisted(() => ({ join: true, meter: null as { calls: number; cost: number; unpriced: number } | null }));

// Every model call counted, with what OpenRouter said it cost.
vi.mock("@potyro/generator/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/backends")>();
  return {
    ...actual,
    createOpenRouterEngine: (opts: Parameters<typeof actual.createOpenRouterEngine>[0]) => {
      const engine = actual.createOpenRouterEngine(opts);
      return {
        chat: {
          completions: {
            create: async (req: Parameters<typeof engine.chat.completions.create>[0]) => {
              const res = await engine.chat.completions.create(req);
              const m = state.meter!;
              m.calls += 1;
              if (typeof res.usage?.cost === "number") m.cost += res.usage.cost;
              else m.unpriced += 1;
              return res;
            },
          },
        },
      };
    },
  };
});
// BEFORE: the app is never joined, so the model sees the entry alone, exactly as before #448.
vi.mock("../src/joined-app.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/joined-app.js")>();
  return { ...actual, joinForModel: (...args: Parameters<typeof actual.joinForModel>) => (state.join ? actual.joinForModel(...args) : Promise.resolve(null)) };
});
vi.mock("../src/app-bundler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app-bundler.js")>();
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  const stubs = { potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"), react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8") };
  const esbuild = { build } as unknown as EsbuildLike;
  return {
    ...actual,
    createAppBundler: async () => (source: string, modules?: ModuleSource, opts?: Parameters<typeof actual.bundleAppSource>[4]) => actual.bundleAppSource(source, esbuild, stubs, modules, opts),
  };
});

const { studioEngine } = await import("../src/studio-engine.js");
const { loadDefinition } = await import("../src/validate-app.js");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const enc = (s: string) => new TextEncoder().encode(s);

/** An app from apps/: its entry, and its own modules as the package carries them. */
async function appOf(dir: string, entry: string): Promise<{ source: string; texts: Record<string, string>; modules: ModuleSource }> {
  const at = join(ROOT, "apps", dir);
  const texts: Record<string, string> = {};
  for (const name of readdirSync(at)) if (/\.tsx?$/.test(name) && name !== entry && !name.endsWith(".d.ts") && name !== "vitest.config.ts") texts[name] = readFileSync(join(at, name), "utf8");
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(texts)) {
    lock[srcKey(path)] = await lockEntryFor(`.src/${path}`, enc(text));
    files.set(`.src/${path}`, enc(text));
  }
  return { source: readFileSync(join(at, entry), "utf8"), texts, modules: memoryModules(lock, files) };
}

interface Case {
  id: string;
  app: string;
  entry: string;
  ask: string;
  /** Whether the change is there, on the files that came back. */
  landed: (files: { entry: string; modules: Record<string, string> }) => boolean;
}

const CASES: Case[] = [
  {
    id: "piano-rest-day",
    app: "piano",
    entry: "piano.app.tsx",
    ask: "Make the rest day the 6th day of my cycle instead of the 7th.",
    landed: (f) => /isRestDay[^\n]*===\s*6\b/.test(f.modules["progress.ts"] ?? "") || /isRestDay[^\n]*===\s*6\b/.test(f.entry),
  },
  {
    id: "puzzle-tries",
    app: "daily-puzzle",
    entry: "daily-puzzle.app.ts",
    ask: "Give me 8 tries a day instead of 6.",
    landed: (f) => /TRIES\s*=\s*8\b/.test(f.modules["puzzle.ts"] ?? ""),
  },
  {
    id: "palette-snow",
    app: "palette-catcher",
    entry: "palette-catcher.app.ts",
    ask: "Call the lightest grey “Snow” instead of “Chalk”.",
    landed: (f) => /en:\s*"Snow"/.test(f.modules["names.ts"] ?? "") && !/en:\s*"Chalk"/.test(f.modules["names.ts"] ?? ""),
  },
  {
    id: "piano-log-title (control: the entry)",
    app: "piano",
    entry: "piano.app.tsx",
    ask: "Rename the Log tab to Journal.",
    landed: (f) => /title:\s*"Journal"/.test(f.entry),
  },
];

interface Row {
  id: string;
  condition: "before" | "after";
  run: number;
  outcome: string;
  landed: boolean;
  changedModules: string[];
  calls: number;
  cost: number;
  unpriced: number;
  seconds: number;
  detail?: string;
}

describe.skipIf(!RUN)("paid: changes whose code is in an app's own modules (#448)", () => {
  const engine: EngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    engine: "openrouter",
    openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
    ...(process.env.MODEL ? { openrouterModel: process.env.MODEL } : {}),
  };
  const runs = Number(process.env.RUNS ?? 1);

  it("before and after, every case", async () => {
    const rows: Row[] = [];
    for (const c of CASES) {
      const app = await appOf(c.app, c.entry);
      const before = await loadDefinition(app.source, withLibrariesStoodIn(app.modules));
      for (let run = 1; run <= runs; run++) {
        for (const condition of ["before", "after"] as const) {
          state.join = condition === "after";
          state.meter = newMeter();
          const started = Date.now();
          const out = await studioEngine(engine, () => {}, app.modules).modify(app.source, { pages: before.pages, entities: before.entities }, c.ask);
          const modules = out.kind === "source" || out.kind === "loss" ? { ...app.texts, ...(out.modules ?? {}) } : app.texts;
          const entry = out.kind === "source" || out.kind === "loss" ? out.source : app.source;
          const row: Row = {
            id: c.id,
            condition,
            run,
            outcome: out.kind,
            landed: (out.kind === "source") && c.landed({ entry, modules }),
            changedModules: Object.keys(out.kind === "source" ? (out.modules ?? {}) : {}).filter((p) => out.kind === "source" && out.modules![p] !== app.texts[p]),
            calls: state.meter.calls,
            cost: Number(state.meter.cost.toFixed(4)),
            unpriced: state.meter.unpriced,
            seconds: Math.round((Date.now() - started) / 1000),
            ...(out.kind === "failed" ? { detail: out.detail ?? out.text } : out.kind === "refusal" || out.kind === "question" ? { detail: out.text } : {}),
          };
          rows.push(row);
          console.log(JSON.stringify(row));
        }
      }
    }
    const sum = (cond: "before" | "after") => {
      const r = rows.filter((x) => x.condition === cond);
      return { landed: `${r.filter((x) => x.landed).length}/${r.length}`, cost: Number(r.reduce((n, x) => n + x.cost, 0).toFixed(4)), calls: r.reduce((n, x) => n + x.calls, 0) };
    };
    const summary = { model: engine.openrouterModel, runs, before: sum("before"), after: sum("after"), total: Number(rows.reduce((n, x) => n + x.cost, 0).toFixed(4)) };
    console.log(JSON.stringify(summary, null, 2));
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ summary, rows }, null, 2));
    expect(rows.length).toBe(CASES.length * runs * 2);
  }, 3_600_000);
});
