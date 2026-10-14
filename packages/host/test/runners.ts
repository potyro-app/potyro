// The two untrusted runners, behind one seam, so the contract tests (docs/09) run against both while
// both exist: the QuickJS-WASM isolate (the fallback) and the browser realm (#272).
//
// In Node there is no iframe, so the realm's WORKER RUNTIME — the same bundle the browser runs — is
// started in a worker thread, and the host side is the product's `createRealmLoader` unchanged. That
// tests the protocol, the op table, the mediated ctx and the watchdog (a spinning thread is really
// terminated). It does NOT test containment: a worker thread is not a sandbox. The browser's iframe,
// CSP and opaque origin are tested in e2e (realm-escape-sandbox.spec.ts).

import { Worker } from "node:worker_threads";
import { newAsyncContext } from "quickjs-emscripten";
import type { Store } from "@potyro/store";
import type { LoadedApp, Provenance } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";
import { createRealmLoader, type RealmSpawner } from "../src/realm/index.js";
// @ts-expect-error — a plain .mjs build script, typed by use
import { bundleRealmWorker } from "../realm-build.mjs";

export type Loader = (args: { code: string; provenance: Provenance }) => Promise<LoadedApp>;
export interface RunnerOptions {
  timeoutMs?: number;
  loadTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  onKill?: (reason: string) => void;
}
export interface Runner {
  name: "quickjs" | "realm";
  loader(store: Store, opts?: RunnerOptions): Promise<Loader>;
}

let workerSource: Promise<string> | null = null;
/** The worker runtime, bundled once per test file (not minified: stack traces stay readable). */
export function realmWorkerSource(): Promise<string> {
  workerSource ??= (bundleRealmWorker({ minify: false }) as Promise<{ code: string }>).then((r) => r.code);
  return workerSource;
}

/** Gives the browser runtime the globals it expects: `self`, `onmessage`, a port in the data. */
const SHIM = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
parentPort.on("message", (data) => { const h = globalThis.onmessage; if (typeof h === "function") h({ data, ports: [] }); });
`;

/** Every realm a test started, so a file can check none is left running. */
export const liveThreads = new Set<Worker>();

/** The test spawner: the worker runtime in a Node worker thread. NOT a sandbox — tests only. */
export const threadSpawner: RealmSpawner = async ({ workerSource: source, onLost }) => {
  const worker = new Worker(SHIM + source, { eval: true });
  liveThreads.add(worker);
  let killed = false;
  worker.on("error", (e) => {
    if (!killed) onLost(`the worker failed: ${e.message}`);
  });
  worker.on("exit", () => {
    liveThreads.delete(worker);
    if (!killed) onLost("the worker exited");
  });
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ t: "port", port: port2 }, [port2 as never]);
  return {
    port: port1,
    kill() {
      if (killed) return;
      killed = true;
      port1.close();
      void worker.terminate();
    },
  };
};

export const quickjs: Runner = {
  name: "quickjs",
  async loader(store, opts = {}) {
    return createIsolateLoader({
      store,
      newContext: () => newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>,
      timeoutMs: opts.timeoutMs,
      loadTimeoutMs: opts.loadTimeoutMs,
    });
  },
};

export const realm: Runner = {
  name: "realm",
  async loader(_store, opts = {}) {
    return createRealmLoader({ spawn: threadSpawner, workerSource: await realmWorkerSource(), ...opts });
  },
};

export const RUNNERS: Runner[] = [quickjs, realm];
