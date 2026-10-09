// "Will this app survive two people?" — asked in the browser, on the source about to be saved.
//
// The gate itself lives in `@potyro/generator` and is driven here over two peers and two composed
// runtimes, so the check the shell runs is byte-for-byte the one the eval harness runs. Rebuilding
// the host wiring separately is how two code paths end up testing subtly different things.
//
// ## Untrusted, on purpose
//
// The app is loaded through the isolate, the same as `buildAndValidate`. It is about to be run by
// somebody, and running unreviewed code directly to find out whether it is safe would be an odd
// order of operations. It also matches how a SHARED app actually executes, which is the situation
// being tested.
//
// ## Never blocks a save
//
// A hazard is a warning about sharing, not a syntax error. Plenty of apps are never shared, and an
// app whose reorder is unsafe is still a perfectly good app for one person. Refusing to save it
// would be the tool substituting its judgement for the user's — so this reports, and the user
// decides. Sharing is where it is worth being loud.

import type { ConcurrencyResult } from "@potyro/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";

export type { ConcurrencyResult } from "@potyro/generator/backends";

/** How long to let it run before giving up. Two isolates and two cojson nodes are not free. */
const BUDGET_MS = 30_000;

/**
 * Run the concurrency gate against a source.
 *
 * Resolves to `null` when the check could not run at all — a bundling failure, a browser without
 * the APIs, a timeout. `null` means "unknown", never "safe", and callers must not report it as a
 * clean bill of health.
 */
export async function checkConcurrency(source: string, appId: string): Promise<ConcurrencyResult | null> {
  try {
    return await Promise.race([
      run(source, appId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BUDGET_MS)),
    ]);
  } catch {
    // Never let a diagnostic take down the save it was diagnosing.
    return null;
  }
}

async function run(source: string, appId: string): Promise<ConcurrencyResult | null> {
  const [{ concurrencyChecks, seedRecords }, { createPeerPair }] = await Promise.all([
    import("@potyro/generator/backends"),
    import("@potyro/store"),
  ]);

  const bundle = await createAppBundler();
  const bundleCode = await bundle(source);
  const pair = await createPeerPair(`check:${appId}`);

  try {
    const make = async (store: Parameters<typeof compose>[0]["store"]) =>
      compose({
        provenance: "untrusted",
        bundleCode,
        store,
        caps: (await import("@potyro/capabilities")).createWebCapabilities(),
        ui: createUiBridge(() => {}),
        nav: createNavBridge(() => {}),
        loadIsolated: await createSandboxLoader(store),
      });

    const a = await make(pair.a);
    const b = await make(pair.b);
    const definition = a.runtime.definition as Parameters<typeof concurrencyChecks>[0]["app"];

    return await concurrencyChecks({
      app: { ...definition, id: appId },
      pair,
      runA: a.runtime,
      runB: b.runtime,
      seed: async (rt) => (await seedRecords({ ...definition, id: appId }, rt as never)).created,
    });
  } finally {
    await pair.close().catch(() => {});
  }
}

/** One line per hazard, for a dialog. Empty when there is nothing to say. */
export function describeHazards(result: ConcurrencyResult | null): string[] {
  if (!result) return [];
  return result.hazards.map((h) => {
    const where = `${h.entity}${h.action ? `.${h.action}` : ""}${h.field ? ` (${h.field})` : ""}`;
    const what =
      h.kind === "lost-update"
        ? "one of two simultaneous changes is silently discarded"
        : h.kind === "fused-key"
          ? "two rows can end up sharing a sort key, after which reordering them stops working"
          : h.kind === "corrupt-number"
            ? "a number can be overwritten with nothing"
            : "the two devices stop agreeing";
    return `${where}: ${what}`;
  });
}
