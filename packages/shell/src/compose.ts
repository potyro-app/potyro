// Composition root (docs/02). Wires Store + Capabilities + Host + Runtime for one app, at one
// provenance. Swap store/caps/target here and nothing else changes.

import type { KartaApp } from "karta";
import { createHost, type LoadedApp, type NavBridge, type Provenance, type UiBridge } from "@karta/host";
import type { Store } from "@karta/store";
import type { Capabilities } from "@karta/capabilities";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import type { LoadIsolated } from "./isolate-bridge.js";

export interface ComposeOptions {
  /** Required for the trusted (direct) path; the untrusted (isolate) path loads from `bundleCode`. */
  app?: KartaApp;
  provenance: Provenance;
  /** Bundle source for the untrusted (isolate) path. */
  bundleCode?: string;
  store: Store;
  caps: Capabilities;
  ui: UiBridge;
  nav: NavBridge;
  loadIsolated?: LoadIsolated;
}

export interface Composed {
  runtime: KartaRuntime;
  loaded: LoadedApp;
}

export async function compose(opts: ComposeOptions): Promise<Composed> {
  const host = createHost({ loadIsolated: opts.loadIsolated });
  const loaded =
    opts.provenance === "trusted"
      ? await host.load({ kind: "module", app: requireApp(opts.app), provenance: "trusted" })
      : await host.load({ kind: "bundle", code: requireBundle(opts.bundleCode), provenance: "untrusted" });

  const runtime = createRuntime({ app: loaded, host, store: opts.store, caps: opts.caps, ui: opts.ui, nav: opts.nav });
  return { runtime, loaded };
}

function requireBundle(code: string | undefined): string {
  if (!code) throw new Error("compose: untrusted provenance requires a bundle (bundleCode)");
  return code;
}

function requireApp(app: KartaApp | undefined): KartaApp {
  if (!app) throw new Error("compose: trusted provenance requires an app module");
  return app;
}
