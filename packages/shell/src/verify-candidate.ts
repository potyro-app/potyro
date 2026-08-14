// Does the candidate actually fix what the person reported?
//
// This is the gate the whole agent loop hangs on: an edit that compiles, validates and renders is
// exactly what gets reported as a fix today while the app is still broken. The only answer that
// counts is replaying the user's own recorded path against the candidate.
//
// It runs UNTRUSTED. The Studio's preview runs trusted on purpose (custom views cannot render in
// the isolate), and that is why a generated app with a runaway loop once froze the tab outright.
// Verification has no such need — it replays navigation and queries, never renders a custom view —
// so it takes the isolate plus an explicit budget, and a candidate that spins is a failed verdict
// instead of a dead browser. The budget is deliberately larger than the render default: a
// verification runs a handful of queries back to back, and killing a slow-but-correct app would
// report a false failure, which is the failure mode this whole feature exists to remove.

import { MemoryStore, type Store } from "@karta/store";
import { replayCase, replayPassed, type Case, type ReplayTarget } from "@karta/runtime";
import { createWebCapabilities } from "@karta/capabilities";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { PickerHost } from "./picker.js";
import { Toaster } from "./toaster.js";

const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_MEMORY_BYTES = 64 * 1024 * 1024;

export interface VerifyCandidateDeps {
  source: string;
  theCase: Case;
  /** Overridable for tests; defaults to a throwaway in-memory store. */
  store?: Store;
}

export async function verifyCandidate(deps: VerifyCandidateDeps): Promise<{ passed: boolean; detail: string }> {
  // A fresh MemoryStore, never the user's: verification must not read or write real records.
  const store = deps.store ?? (await freshStore());
  let bundleCode: string;
  try {
    const bundle = await createAppBundler();
    bundleCode = await bundle(deps.source);
  } catch (e) {
    // A candidate that does not compile is a failed verdict, not an exception — the loop has to be
    // able to hand this back to the model as something to fix.
    return { passed: false, detail: `could not compile the candidate: ${e instanceof Error ? e.message : String(e)}` };
  }

  let composed: Composed | undefined;
  try {
    const toaster = new Toaster();
    composed = await compose({
      provenance: "untrusted",
      bundleCode,
      store,
      caps: createWebCapabilities(),
      ui: createUiBridge(toaster.push, new PickerHost()),
      nav: createNavBridge(() => {}),
      loadIsolated: await createSandboxLoader(store, {
        timeoutMs: VERIFY_TIMEOUT_MS,
        memoryLimitBytes: VERIFY_MEMORY_BYTES,
        // The load budget (module body) and per-call budget are separate. Passing loadTimeoutMs
        // explicitly makes the budget that kills a runaway module body visible and stable.
        loadTimeoutMs: VERIFY_TIMEOUT_MS,
      }),
    });

    const target: ReplayTarget = {
      definition: composed.runtime.definition,
      // `queryPage` returns `{ rows, ctx }` (not a bare array) — replay only needs the rows.
      query: async (_entity, pageId) => (await composed!.runtime.queryPage(pageId)).rows,
      // runAction is deliberately absent — replaying an action would mutate records.
    };
    const report = await replayCase(target, deps.theCase);
    const detail = report.outcomes.map((o) => `${o.ok ? "ok" : "FAILED"}: ${o.detail}`).join("\n");
    return { passed: replayPassed(report), detail };
  } catch (e) {
    return { passed: false, detail: `the candidate could not run: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    // `verifyCandidate` is designed to be called in a loop (up to 8 candidates per reported bug) —
    // each call loads its own isolate, and `LoadedApp.dispose()` is the only thing that frees it.
    // Runs whether replay passed, failed, or threw; `composed` is undefined only if `compose()`
    // itself never returned, in which case there is nothing to dispose.
    //
    // Guarded: this function never throws today, but a `finally` that did would replace whatever
    // `return`/`throw` the try block just produced — silently swapping a verdict for a disposal
    // error. `loop.ts` awaits `deps.verify()` with no try/catch on the strength of a never-throw
    // contract; a caller that cannot get a verdict here falls back to guessing, which is the exact
    // failure this whole gate exists to prevent. The verdict outranks cleanup, so a failed dispose
    // is swallowed (and logged) rather than allowed to propagate.
    try {
      composed?.loaded.dispose();
    } catch (e) {
      console.warn("verifyCandidate: failed to dispose the isolate", e);
    }
  }
}

async function freshStore(): Promise<Store> {
  const s = new MemoryStore();
  await s.open("verify-candidate");
  return s;
}
