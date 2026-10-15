// Runs inside the realm's Worker (opaque origin, the realm CSP: nothing loads, nothing connects).
// Bundled to one script by `realm-build.mjs`; the frame starts it from a blob: URL.
//
// It receives the app's port, evaluates the app bundle — the SAME IIFE the QuickJS isolate runs, which
// sets `globalThis.__potyroApp` — and answers the host's calls with `DirectLoadedApp`, the trusted
// runner's own dispatch, handed a `ctx` proxy instead of a real ctx.
//
// Nothing here is trusted by the host. App code shares this realm and can rewrite all of it.

import type { AppDefinition } from "potyro";
import { DirectLoadedApp } from "../direct-host.js";
import { loadMessageFormat } from "../format.js";
import { makeRealmCtx } from "./ctx-proxy.js";
import { portTransport } from "./port-transport.js";
import { dispatchSocketEvent } from "./realm-sockets.js";
import type { CallKind, HostToRealm } from "./protocol.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  __potyroApp?: unknown;
}
const scope = globalThis as unknown as WorkerScope;

/** How often the worker says it is alive. The host stops a realm that is silent for its heartbeat budget. */
const HEARTBEAT_MS = 100;

scope.onmessage = (e: MessageEvent) => {
  const data = e.data as { t?: string; port?: MessagePort } | null;
  if (data?.t !== "port") return;
  const port = data.port ?? e.ports?.[0];
  if (!port) return;
  scope.onmessage = null;
  boot(port);
};

function boot(port: MessagePort): void {
  // Beat from the start: a bundle whose top level never returns is caught by the load deadline, and
  // anything that spins later by the heartbeat.
  setInterval(() => port.postMessage({ t: "hb", at: Date.now() }), HEARTBEAT_MS);
  port.postMessage({ t: "up" });
  const tx = portTransport(port);
  let app: DirectLoadedApp | null = null;

  port.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as HostToRealm;
    if (tx.onReply(msg)) return;
    if (msg.t === "sock") return dispatchSocketEvent(msg.ev);
    if (msg.t === "load") {
      if (app) return; // one app per realm
      void load(msg.code).then(
        (loaded) => {
          app = loaded.app;
          port.postMessage({ t: "ready", definition: loaded.definition });
        },
        (err: unknown) => port.postMessage({ t: "ready", error: err instanceof Error ? err.message : String(err) }),
      );
      return;
    }
    if (msg.t !== "call") return;
    if (!app) {
      port.postMessage({ t: "result", id: msg.id, ok: false, error: "no app loaded" });
      return;
    }
    const ctx = makeRealmCtx(msg.base, tx);
    run(app, msg.kind, msg.args, ctx as never).then(
      (value) => {
        try {
          port.postMessage({ t: "result", id: msg.id, ok: true, value });
        } catch (cloneErr) {
          port.postMessage({ t: "result", id: msg.id, ok: false, error: `the app returned a value that cannot leave it: ${cloneErr instanceof Error ? cloneErr.message : String(cloneErr)}` });
        }
      },
      (err: unknown) => port.postMessage({ t: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  };
}

async function load(code: string): Promise<{ app: DirectLoadedApp; definition: string }> {
  await loadMessageFormat();
  // Indirect eval: the bundle's top level runs in the worker's global scope, as a classic script
  // would. The realm CSP allows it on purpose (protocol.ts REALM_CSP).
  (0, eval)(code);
  const def = scope.__potyroApp as AppDefinition | undefined;
  if (!def || typeof def !== "object") throw new Error("the bundle did not set globalThis.__potyroApp");
  return {
    app: new DirectLoadedApp(def, "untrusted"),
    // Structure only, as the isolate reads it: every function becomes the sentinel the shell knows.
    definition: JSON.stringify(def, (_k, v: unknown) => (typeof v === "function" ? "__potyro_fn__" : v)),
  };
}

function run(app: DirectLoadedApp, kind: CallKind, a: unknown[], ctx: never): Promise<unknown> {
  const s = (i: number) => String(a[i]);
  const v = (i: number) => a[i] as never;
  switch (kind) {
    case "computed":
      return app.callComputed(s(0), s(1), v(2), ctx);
    case "action":
      return app.callAction(s(0), s(1), v(2), ctx, a[3]);
    case "filter":
      return app.callFilter(s(0), v(1), ctx);
    case "sort":
      return app.callSort(s(0), v(1), v(2), ctx);
    case "binding":
      return app.callBinding(v(0), v(1), ctx);
    case "viewOption":
      return app.callViewOption(s(0), s(1), ctx);
    case "pageOption":
      return app.callPageOption(s(0), s(1), ctx);
    case "pageAction":
      return app.callPageAction(s(0), Number(a[1]), ctx);
    case "summary":
      return app.callSummary(s(0), Number(a[1]), v(2), ctx);
    case "aggregate":
      return app.callAggregate(s(0), v(1), ctx);
    case "fold":
      return app.callFold(s(0), s(1), v(2), ctx);
    case "fieldDefault":
      return app.callFieldDefault(s(0), s(1), ctx);
    case "reminderWhen":
      return app.reminderWhen(s(0), v(1), ctx);
    default:
      return Promise.reject(new Error(`unknown call ${String(kind)}`));
  }
}
