// A test load in the box the app will run in, before the person says yes (#271).
//
// An app that arrives from someone else runs sealed, and the sealed box is not a browser: an app or a
// library that reaches for `Intl` there fails, and the person used to find out by opening an app that
// did not work. So before the Add-an-app card asks them anything, the app is loaded in the sealed
// box exactly as it will run — its own modules and its libraries — on a throwaway store, and the
// generator's smoke run puts sample records through its computed values, filters, actions and
// reminders. What it reached for and the box does not have comes back named in plain words
// (missing-features.ts), with the reason the card offers to run it as theirs instead.
//
// Three outcomes are kept apart, because they mean different things to the card:
//   - unreadable: it does not compile, or a module it imports is not here. It will not run anywhere.
//   - loadFailed: it compiles, and its top level throws in the sealed box. It may well run as theirs.
//   - loaded:     its definition, its structure problems, and what the smoke run found missing.
//
// Nothing here has authority: the store is in memory, the capabilities are fakes, a confirm says yes
// to a question about sample records, and a budget stops a loop that never ends.

import type { AppDefinition } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { smokeRuntime } from "@potyro/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { isLibraryStartError, type ModuleSource } from "./package-modules.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge } from "./ui-bridge.js";
import { validateDefinition } from "./validate-app.js";
import { missingFeature, missingFeatures } from "./missing-features.js";

const CALL_MS = 5_000;
const MEMORY_BYTES = 64 * 1024 * 1024;
/** The whole smoke run. Past it, the trial says what it found so far and nothing about the rest. */
export const TRIAL_MS = 15_000;

export interface Trial {
  /** The definition as it loaded in the sealed box. Absent when it did not load. */
  definition?: unknown;
  /** Its structure problems, when it loaded. */
  issues: string[];
  /** It could not be read at all — a syntax error, a module that is not here. */
  unreadable?: string;
  /** It was read, and its top level threw in the sealed box. */
  loadFailed?: string;
  /** One of its libraries could not start in the sealed box: the sentence `wrapForIsolate` wrote. */
  libraryProblem?: string;
  /** What it reached for that the sealed box does not have, in plain words, each once. */
  missing: string[];
}

export interface TrialOptions {
  /** A library whose bytes are not here yet loads as an inert stand-in: enough to read the app, not to try it. */
  standIns?: boolean;
  /** Put sample records through its logic. Off when only the definition is wanted. */
  smoke?: boolean;
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
/** The sentence `wrapForIsolate` wrote, without whatever the isolate put in front of it. */
const startProblem = (e: unknown): string => firstLine(e).replace(/^.*?Error: /, "");

function within<T>(ms: number, work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function load(code: string, store: MemoryStore): Promise<Composed> {
  return compose({
    provenance: "untrusted",
    bundleCode: code,
    store,
    caps: new FakeCapabilities(),
    // Sample records in a throwaway store: confirming is safe, and lets the code behind a confirm run.
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: createNavBridge(() => {}),
    loadIsolated: await createSandboxLoader(store, { timeoutMs: CALL_MS, memoryLimitBytes: MEMORY_BYTES, loadTimeoutMs: CALL_MS }),
  });
}

/** Load a source in the sealed box, and — with `smoke` — put sample records through it. Never throws. */
export async function trySealed(source: string, modules?: ModuleSource, opts: TrialOptions = {}): Promise<Trial> {
  let code: string;
  try {
    code = await (await createAppBundler())(source, modules, { standIns: opts.standIns });
  } catch (e) {
    return { issues: [], missing: [], unreadable: firstLine(e) };
  }
  const store = new MemoryStore();
  await store.open("trial");
  let composed: Composed;
  try {
    composed = await load(code, store);
  } catch (e) {
    const found = missingFeature(e);
    return {
      issues: [],
      missing: found ? [found.words] : [],
      loadFailed: firstLine(e),
      ...(isLibraryStartError(e) ? { libraryProblem: startProblem(e) } : {}),
    };
  }
  try {
    const definition = composed.runtime.definition;
    const issues = validateDefinition(definition);
    if (!opts.smoke || issues.length) return { definition, issues, missing: [] };
    // The smoke run's own failures are about sample records as often as about the app; only what the
    // box is missing is the card's business.
    const result = await within(
      TRIAL_MS,
      smokeRuntime(definition as AppDefinition & { id: string }, composed.runtime, { customViews: false }).catch((e: unknown) => ({ errors: [firstLine(e)] })),
    );
    return { definition, issues, missing: missingFeatures(result?.errors ?? []).map((f) => f.words) };
  } finally {
    try {
      composed.loaded.dispose();
    } catch {
      // nothing more is freed by saying so
    }
  }
}
