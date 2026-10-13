// Run a candidate app the modify loop is about to accept, and say what broke (#262).
//
// The loop's gate used to stop at "it compiles, validates and keeps its shape". This is the rest of
// what a developer does before calling a change done: run it. On a throwaway store seeded with
// sample records, every computed, filter, sort, binding, action and reminder runs (the generator's
// smoke run), and then every page is mounted for real (render-pages.tsx). What threw comes back as
// errors; a page that matched nothing, stayed loading or came up blank comes back as warnings. The
// caller judges a candidate against the original's own run (`regressionGate`), so failures the app
// already had are context, not a reason to refuse the change.
//
// It runs UNTRUSTED, with a budget, for the reason verify-candidate.ts gives: these are candidates
// nobody has looked at yet, most of them rejected, and a generated app with a runaway loop once froze
// the tab when it ran direct. The isolate turns that into a failed run instead of a dead browser. The
// cost is that custom views — which run only as the person's own app — are not mounted here; the run
// says so, rather than passing them silently.
//
// The same goes for the app's libraries (#266). Many need a full web page and cannot start in the
// isolate, which used to fail the app as the person has it — so no change to it could pass. Here
// they stand in as inert values (`withLibrariesStoodIn`), identically for the original and the
// candidate, and the run says which ones, so a model does not chase an error a stand-in caused.

import type { AppDefinition } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import type { PotyroRuntime } from "@potyro/runtime";
import { mergeRuns, paramsForPage, smokeReport, smokeRuntime, type RunReport } from "@potyro/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { standInNote, withLibrariesStoodIn, type ModuleSource } from "./package-modules.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge } from "./ui-bridge.js";
import { renderPages, type PageToRender } from "./render-pages.js";

const RUN_TIMEOUT_MS = 5_000;
const RUN_MEMORY_BYTES = 64 * 1024 * 1024;
/** The whole run — compile, load, logic, every page. Past this the app is reported as not finishing. */
export const RUN_WALL_CLOCK_MS = 30_000;

export interface RunCandidateDeps {
  /** Test seam: compose the candidate on the given store. Defaults to the isolate, with a budget. */
  compose?: (source: string, store: MemoryStore) => Promise<Composed>;
  /** How long a page may take to settle. Defaults to observe-render's SETTLE_MS. */
  settleMs?: number;
  /** The app's libraries and own modules (#266, #258), when it has any. Its libraries stand in as
   *  inert values here (`withLibrariesStoodIn`): the run judges the app's own code, not theirs. */
  modules?: ModuleSource;
}

async function composeIsolated(source: string, store: MemoryStore, modules?: ModuleSource): Promise<Composed> {
  const bundle = await createAppBundler();
  return compose({
    provenance: "untrusted",
    bundleCode: await bundle(source, modules),
    store,
    caps: new FakeCapabilities(),
    // Sample records in a throwaway store: confirming is safe and lets the code behind a confirm run.
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: createNavBridge(() => {}),
    loadIsolated: await createSandboxLoader(store, { timeoutMs: RUN_TIMEOUT_MS, memoryLimitBytes: RUN_MEMORY_BYTES, loadTimeoutMs: RUN_TIMEOUT_MS }),
  });
}

/** Every page with the params it needs, from the records the smoke run seeded. */
async function pagesToRender(def: AppDefinition, runtime: PotyroRuntime): Promise<{ pages: PageToRender[]; sealed: number }> {
  const created: Record<string, string[]> = {};
  const first: Record<string, Record<string, unknown> | undefined> = {};
  for (const entity of Object.keys(def.entities ?? {})) {
    const rows = await runtime.ctx.query(entity).catch(() => []);
    created[entity] = rows.map((r) => r.id);
    first[entity] = rows[0] as Record<string, unknown> | undefined;
  }
  const pages: PageToRender[] = [];
  let sealed = 0;
  // The pages as they render: the runtime's, in the person's language (#302).
  for (const page of runtime.definition.pages ?? []) {
    const type = (page.view as { type?: string } | undefined)?.type;
    if (type === "custom" && !runtime.core.app.customView(page.id)) {
      sealed++;
      continue;
    }
    pages.push({ id: page.id, ...(page.layout ? { layout: page.layout } : {}), params: paramsForPage(def, page.id, created, (e) => first[e]) });
  }
  return { pages, sealed };
}

async function run(source: string, deps: RunCandidateDeps): Promise<RunReport> {
  const store = new MemoryStore();
  await store.open("run-candidate");
  let composed: Composed | undefined;
  try {
    const modules = withLibrariesStoodIn(deps.modules);
    composed = deps.compose ? await deps.compose(source, store) : await composeIsolated(source, store, modules);
    const runtime = composed.runtime;
    const def = runtime.definition as AppDefinition & { id: string };
    // Custom views are mounted below with the real views, effects and all; the smoke run's
    // first-paint render of them would only say the same thing twice.
    const logic = smokeReport(await smokeRuntime(def, runtime, { customViews: false }));
    const { pages, sealed } = await pagesToRender(def, runtime);
    const screens = await renderPages(runtime, pages, deps.settleMs);
    const report = mergeRuns(logic, screens);
    const notes = [
      sealed ? `${sealed} custom view${sealed === 1 ? " was" : "s were"} not run here — custom views run only as the person's own app` : null,
      standInNote(modules),
    ].filter((n): n is string => n !== null);
    return notes.length ? { ...report, ran: [report.ran, ...notes].join("; ") } : report;
  } finally {
    try {
      composed?.loaded.dispose();
    } catch {
      // the report outranks cleanup; a failed dispose frees nothing more by being thrown
    }
  }
}

/** Run a candidate source and report what broke. Rejects only when it cannot be composed at all. */
export function runCandidate(source: string, deps: RunCandidateDeps = {}): Promise<RunReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RunReport>((resolve) => {
    timer = setTimeout(
      () => resolve({ errors: [`it did not finish running in ${RUN_WALL_CLOCK_MS / 1000}s — something waits forever or never stops`], warnings: [], ran: "" }),
      RUN_WALL_CLOCK_MS,
    );
  });
  return Promise.race([run(source, deps), timeout]).finally(() => clearTimeout(timer));
}
