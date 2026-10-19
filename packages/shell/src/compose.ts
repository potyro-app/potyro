// Composition root (docs/02). Wires Store + Capabilities + Host + Runtime for one app, at one
// provenance. Swap store/caps/target here and nothing else changes.

import type { PotyroApp, Person, Space } from "potyro";
import { createHost, type LoadedApp, type NavBridge, type Provenance, type UiBridge } from "@potyro/host";
import type { Store } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import type { LoadIsolated } from "./isolate-bridge.js";
import { languagePrefs } from "./locale.js";
import { readCatalogs } from "./app-catalogs.js";

export interface ComposeOptions {
  /** Required for the trusted (direct) path; the untrusted (isolate) path loads from `bundleCode`. */
  app?: PotyroApp;
  provenance: Provenance;
  /** Bundle source for the untrusted (isolate) path. */
  bundleCode?: string;
  store: Store;
  caps: Capabilities;
  ui: UiBridge;
  nav: NavBridge;
  loadIsolated?: LoadIsolated;
  /**
   * Who this device is (KA-18), and the space when the app is synced.
   *
   * The composition root is where identity enters — this is the seam docs/02 describes: swap the
   * store, the caps or the person here and nothing downstream changes.
   */
  me?: Person;
  /** A function here keeps membership current; a value is a boot-time snapshot. See RuntimeDeps. */
  space?: Space | (() => Space | undefined);
  /** The person's languages, best first (#302). Default: what this device says (`languagePrefs`). */
  languages?: readonly string[];
}

export interface Composed {
  runtime: PotyroRuntime;
  loaded: LoadedApp;
}

export async function compose(opts: ComposeOptions): Promise<Composed> {
  const host = createHost({ loadIsolated: opts.loadIsolated });
  // Its translations, from its folder (docs/30): before it loads, so it never shows in English first.
  const catalogs = await readCatalogs(opts.store);
  const loaded =
    opts.provenance === "trusted"
      ? await host.load({ kind: "module", app: requireApp(opts.app), provenance: "trusted", catalogs })
      : await host.load({ kind: "bundle", code: requireBundle(opts.bundleCode), provenance: "untrusted", catalogs });

  const runtime = createRuntime({
    app: loaded,
    host,
    store: opts.store,
    caps: opts.caps,
    ui: opts.ui,
    nav: opts.nav,
    me: opts.me,
    space: opts.space,
    languages: opts.languages ?? languagePrefs(),
  });
  return { runtime, loaded };
}

function requireBundle(code: string | undefined): string {
  if (!code) throw new Error("compose: untrusted provenance requires a bundle (bundleCode)");
  return code;
}

function requireApp(app: PotyroApp | undefined): PotyroApp {
  if (!app) throw new Error("compose: trusted provenance requires an app module");
  return app;
}
