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
import { readOnlyStore } from "./read-only-store.js";
import { Toaster } from "./toaster.js";

// Exported (not just internal) so tests can state their own time bounds as multiples of the real
// budget instead of a second, easily-stale hardcoded number — "reuse the existing budget constant
// so the numbers stay stated in one place" applies to the tests that assert on them too.
export const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_MEMORY_BYTES = 64 * 1024 * 1024;
// The isolate's own interrupt handler bounds CPU running INSIDE QuickJS (module load, each
// invoke()). It cannot bound a host promise the isolate is merely awaiting — e.g. ctx.ui.pick()
// during queryPage, whose promise only settles from a mounted React tree that verification never
// creates. While that promise is pending, QuickJS is not executing, so the interrupt handler never
// gets a chance to fire. This is the wall clock for that class: it wraps the ENTIRE verification
// (compile + load + replay), not just one isolate call, so any never-settling host promise still
// produces a failed verdict instead of a hang. Sized as a multiple of the per-call budget: replay
// makes a handful of isolate calls back to back, so the wall clock has to comfortably outlast a
// single call without becoming another false-failure source for a slow-but-correct app.
export const VERIFY_WALL_CLOCK_MS = VERIFY_TIMEOUT_MS * 2;

export interface VerifyCandidateDeps {
  source: string;
  theCase: Case;
  /**
   * Test seam ONLY — never a real user store. `verifyCandidate` loads unverified, model-written
   * code UNTRUSTED and lets it run `ctx.create`/`patch`/`delete` through the isolate bridge during
   * `queryPage`. The agent loop calls this up to 8 times per reported bug; a caller that passed the
   * user's real store here would let a REJECTED candidate destroy the very records the bug report
   * is about, that many times over. Defaults to a throwaway in-memory store, exactly as before.
   */
  storeForTests?: Store;
}

export async function verifyCandidate(deps: VerifyCandidateDeps): Promise<{ passed: boolean; detail: string }> {
  // Whichever settles first wins. `runVerification`'s own `finally` still disposes the isolate
  // when/if it eventually settles, even after this race has already returned the timeout verdict.
  return Promise.race([runVerification(deps), timeoutVerdict()]);
}

function timeoutVerdict(): Promise<{ passed: boolean; detail: string }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        passed: false,
        detail:
          `verification timed out after ${VERIFY_WALL_CLOCK_MS}ms — the candidate was still running ` +
          "(possibly waiting on something, like a UI prompt, that verification can never answer)",
      });
    }, VERIFY_WALL_CLOCK_MS);
  });
}

async function runVerification(deps: VerifyCandidateDeps): Promise<{ passed: boolean; detail: string }> {
  // A fresh MemoryStore, never the user's: verification must not read or write real records.
  const rawStore = deps.storeForTests ?? (await freshStore());
  // Defense in depth beyond the `storeForTests` contract above: `queryPage` runs the candidate's
  // filters and computed fields, and nothing stops one of them from reaching ctx.create/patch/
  // delete through the isolate bridge. Wrapping in `readOnlyStore` means a write attempt — from a
  // buggy candidate, or from a caller who ignored the "test seam only" warning — throws instead of
  // mutating whatever store was actually supplied.
  const store = readOnlyStore(rawStore, "verifyCandidate runs a candidate read-only; writes are refused");
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
      // No picker: `createUiBridge`'s headless fallback resolves `ctx.ui.pick()` to `null`
      // immediately when no `PickerHost` is supplied (ui-bridge.ts). A mounted `PickerHost.pick()`
      // instead returns a promise that only settles when a React tree calls `settle()` — verification
      // renders no tree, so that promise would simply never resolve. A verification has no user to
      // answer a prompt, so a prompt must resolve to "nothing chosen", never wait for one.
      ui: createUiBridge(toaster.push),
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
