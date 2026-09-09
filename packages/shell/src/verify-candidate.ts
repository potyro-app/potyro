// Does the candidate actually fix what the person reported?
//
// This is the gate the whole agent loop hangs on: an edit that compiles, validates and renders is
// exactly what gets reported as a fix today while the app is still broken. The only answer that
// counts is replaying the user's own recorded path against the candidate — but what that replay can
// prove depends entirely on what data it runs against, which is why `appStore` below matters.
//
// With `appStore` supplied (the normal case once a real caller wires this up), replay reads the
// user's own records, read-only, so `passed: true` means the candidate handled the ACTUAL data
// behind the bug report: a page that opens but returns zero rows against real data still fails here,
// which is exactly the "the page opens but shows nothing" class of report a fresh empty store is
// structurally blind to. Without `appStore` (tests, or a caller with no store to offer), replay runs
// against a fresh empty MemoryStore: `passed: true` proves only that the candidate compiles and the
// recorded steps execute without throwing against zero rows — it cannot see a bug that only shows up
// with real records. Know which verdict you're getting.
//
// It runs UNTRUSTED. The Studio's preview runs trusted on purpose (custom views cannot render in
// the isolate), and that is why a generated app with a runaway loop once froze the tab outright.
// Verification has no such need — it replays navigation and queries, never renders a custom view —
// so it takes the isolate plus an explicit budget, and a candidate that spins is a failed verdict
// instead of a dead browser. The budget is deliberately larger than the render default: a
// verification runs a handful of queries back to back, and killing a slow-but-correct app would
// report a false failure, which is the failure mode this whole feature exists to remove.
//
// Reading the user's real records into an UNVERIFIED, model-written candidate is safe for two
// independent reasons, not one: the isolate's `network.fetch` throws outright (host/isolate policy,
// unconditional), so a candidate under verification cannot exfiltrate anything it reads no matter
// what it tries; and it is the user's own data in their own browser, so reading it is exactly what
// happens the moment they open the app themselves. The remaining risk isn't leakage, it's a
// REJECTED candidate mutating the very records the bug report is about — and that is removed below
// by wrapping whichever store is chosen in `readOnlyStore`, so a write attempt throws instead of
// landing.

import { MemoryStore, type Store } from "@karta/store";
import { replayCase, replayPassed, type Case, type ReplayTarget } from "@karta/runtime";
import { createWebCapabilities } from "@karta/capabilities";
import { createAppBundler } from "./app-bundler.js";
import { observeRender } from "./observe-render.js";
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

/** The shape both the original app and a candidate expose that we compare — structural, so this
 *  needs no runtime and no schema import. */
export interface AppShape {
  pages: Array<{ id: string; view: { type: string; entity?: string } }>;
  /** Optional so the pages-only checks in tests keep compiling; every real definition has it. */
  entities?: Record<string, unknown>;
}

/**
 * What the candidate DESTROYED, or null if it destroyed nothing.
 *
 * Only removals and substitutions count. Adding a page is how a genuine fix for "tapping a city
 * should open a map" looks, so additions are free; dropping the map, or turning it into a form, is
 * the failure mode this exists to stop.
 */
export function structuralLoss(before: AppShape, after: AppShape): string | null {
  // Entities first: "it deleted my app" is usually the DATA model gone, with the pages that showed
  // it following. Naming the entity is more useful to a person (and to a retry prompt) than naming
  // the pages that depended on it.
  const lostEntities = Object.keys(before.entities ?? {}).filter((e) => !(after.entities && e in after.entities));
  if (lostEntities.length) {
    const list = lostEntities.map((e) => `"${e}"`).join(", ");
    return `removes the ${list} ${lostEntities.length === 1 ? "entity" : "entities"} the app already had — a change may add to the data model, never drop part of it`;
  }
  for (const page of before.pages) {
    if (!after.pages.some((p) => p.id === page.id)) {
      return `removes the "${page.id}" page (${page.view.type}) instead of fixing it — a change may add pages, never drop one the app already had`;
    }
  }
  return null;
}

/**
 * View-type substitutions the candidate makes — reported, NOT blocked.
 *
 * This used to fail the verdict, and it was wrong within one attempt. The rule came from a real
 * incident (a broken map replaced by a plain list — the feature deleted to make the case pass) and I
 * generalised it to "any view type change is a regression". The very next candidate changed a
 * hand-written `custom` view that hung into the built-in `map` view, which is exactly the right
 * repair, and the guard rejected it. Ranking view types by capability is not something this code can
 * do: `map → list` is a gutting and `custom → map` is a fix, and they are the same shape.
 *
 * So the render decides whether it WORKS (that is what `observe` is for), and the person decides
 * whether the substitution is what they wanted — which they can only do if they are told it happened.
 */
export function viewSubstitutions(before: AppShape, after: AppShape): string[] {
  const out: string[] = [];
  for (const page of before.pages) {
    const now = after.pages.find((p) => p.id === page.id);
    if (now && now.view.type !== page.view.type) {
      out.push(`the "${page.id}" page changes from a ${page.view.type} view to a ${now.view.type} view`);
    }
  }
  return out;
}

export interface VerifyCandidateDeps {
  source: string;
  theCase: Case;
  /** The app as it is NOW, to compare the candidate against — so a "fix" cannot pass by deleting
   *  the feature it was supposed to repair. */
  original: AppShape;
  /**
   * The app's real store. Replay reads through this — via the `readOnlyStore` wrap below, so it is
   * never written — which is what makes the verdict actually mean something: a candidate is judged
   * against the data the bug report is actually about, not an empty store where "the page opens but
   * returns nothing" is indistinguishable from "the page opens and works". Safe to pass despite the
   * candidate being unverified, model-written, UNTRUSTED code, for two reasons that hold regardless
   * of what the candidate tries: the isolate's `network.fetch` throws outright, so nothing read here
   * can leave the device; and `readOnlyStore` turns any `ctx.create`/`patch`/`delete` the candidate's
   * filters or computed fields attempt during `queryPage` into a rejected promise instead of a
   * mutation, so even a REJECTED candidate cannot touch the real records.
   *
   * Omitting this produces a WEAKER verdict, not a wrong one: verification falls back to a fresh
   * empty store, which can confirm a candidate compiles and its recorded steps run without throwing,
   * but is structurally blind to any bug that only shows up against real data (see the file header).
   * Every real caller should supply this; only tests reasonably omit it.
   */
  appStore?: Store;
  /**
   * Test seam ONLY — never a real user store. Exists so a test can seed and inspect an exact,
   * disposable set of records without going through `appStore`'s "this is real user data" contract.
   * `verifyCandidate` loads unverified, model-written code UNTRUSTED and lets it run
   * `ctx.create`/`patch`/`delete` through the isolate bridge during `queryPage`; both this and
   * `appStore` are wrapped in the same `readOnlyStore` below, so either is safe from a REJECTED
   * candidate's writes the same way.
   *
   * Precedence when both are supplied: `storeForTests` wins. A test that reaches for it wants exact
   * control over what the candidate sees; letting an incidental `appStore` silently override that
   * would make the test's own setup a lie. Real callers only ever supply `appStore`, so this
   * ordering never matters outside test code. Defaults (when neither is supplied) to a throwaway
   * in-memory store, exactly as before `appStore` existed.
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
  // Precedence (documented on VerifyCandidateDeps above): `storeForTests`, then `appStore`, then a
  // fresh empty store as the last resort. Whichever is chosen is read the SAME way below — wrapped
  // read-only — so picking `appStore` here is what lets the verdict see real data without letting a
  // candidate touch it.
  const rawStore = deps.storeForTests ?? deps.appStore ?? (await freshStore());
  // `readOnlyStore` is what makes it SAFE to have just reached for the user's real store above:
  // `queryPage` runs the candidate's filters and computed fields, and nothing stops one of them from
  // reaching ctx.create/patch/delete through the isolate bridge (confirmed directly: filters get the
  // exact same live-write `ctx` actions do — nothing upstream of this file gates that). Wrapping in
  // `readOnlyStore` means a write attempt — from a buggy or actively malicious candidate — throws
  // instead of mutating whatever store was actually supplied, whether that's `appStore`,
  // `storeForTests`, or (defense in depth even here) a caller who ignored the "test seam only"
  // warning on `storeForTests`. Combined with the isolate's `network.fetch` throwing outright, a
  // candidate under verification can neither exfiltrate nor mutate what it reads.
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

    // DID IT FIX THE APP, OR DELETE THE PROBLEM? Replay asks "did the page resolve, did its query
    // run, did the screen settle" — and a form satisfies all three. So replacing a broken map with
    // a detail form PASSES, and the first real use of this feature produced exactly that: the map
    // gone, the case green, the person's feature destroyed. A metric that can be satisfied by
    // removing the thing being measured is not a gate.
    //
    // So: a fix may ADD pages, but it may not drop one that was there or quietly change what a page
    // IS. That is not a fix, whatever replay says about it afterwards.
    const regression = structuralLoss(deps.original, composed.runtime.definition);
    if (regression) return { passed: false, detail: regression };
    // Not a failure — something the person has to be TOLD, because they are the only one who can
    // judge whether the substitution is the fix they wanted or a feature quietly swapped out.
    const swaps = viewSubstitutions(deps.original, composed.runtime.definition);

    const target: ReplayTarget = {
      definition: composed.runtime.definition,
      // `queryPage` returns `{ rows, ctx }` (not a bare array) — replay only needs the rows.
      query: async (_entity, pageId) => (await composed!.runtime.queryPage(pageId)).rows,
      // LOOK AT THE CANDIDATE, don't re-read the recording. A recorded `saw.loading` describes the
      // app as it WAS; consulting it while judging a candidate fails the step whatever the candidate
      // does, which is precisely how the first real attempt burned all 8 steps and gave up with no
      // possible fix able to pass. This renders the candidate's own page and reports what IT shows.
      observe: (pageId, params) => observeRender(composed!.runtime, pageId, params),
      // runAction is deliberately absent — replaying an action would mutate records.
    };
    const report = await replayCase(target, deps.theCase);
    const lines = report.outcomes.map((o) => `${o.ok ? "ok" : "FAILED"}: ${o.detail}`);
    // Lead with the substitution when there is one: a person skimming a passing verdict needs to see
    // "this swapped your custom view for the built-in map" BEFORE they press Apply, not after.
    const detail = [...swaps.map((s) => `NOTE: ${s}`), ...lines].join("\n");
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
