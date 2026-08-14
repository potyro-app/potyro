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
import { compose } from "./compose.js";
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

  try {
    const toaster = new Toaster();
    const composed = await compose({
      provenance: "untrusted",
      bundleCode,
      store,
      caps: createWebCapabilities(),
      ui: createUiBridge(toaster.push, new PickerHost()),
      nav: createNavBridge(() => {}),
      loadIsolated: await createSandboxLoader(store, {
        timeoutMs: VERIFY_TIMEOUT_MS,
        memoryLimitBytes: VERIFY_MEMORY_BYTES,
      }),
    });

    const target: ReplayTarget = {
      definition: composed.runtime.definition,
      // `queryPage` returns `{ rows, ctx }` (not a bare array) — replay only needs the rows.
      query: async (_entity, pageId) => (await composed.runtime.queryPage(pageId)).rows,
      // runAction is deliberately absent — replaying an action would mutate records.
    };
    const report = await replayCase(target, deps.theCase);
    const detail = report.outcomes.map((o) => `${o.ok ? "ok" : "FAILED"}: ${o.detail}`).join("\n");
    return { passed: replayPassed(report), detail };
  } catch (e) {
    return { passed: false, detail: `the candidate could not run: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function freshStore(): Promise<Store> {
  const s = new MemoryStore();
  await s.open("verify-candidate");
  return s;
}
