// Runs on a sealed custom view's frame (#267, docs/22 §11): an opaque-origin sandboxed iframe of its
// own, with the realm's CSP — nothing loads from a URL, nothing connects. Bundled to one script by
// `realm-build.mjs` (`virtual:potyro-realm-view`), React and ReactDOM inside it, and inlined into the
// frame's srcdoc after the WebRTC removal (frame.ts `NO_WEBRTC`).
//
// It receives one port and one `init`: the view bundle (the app's source, React resolved to this
// frame's own), the page, the view's ctx base, the definition as data and the theme. It evaluates the
// bundle, finds the page's custom view and mounts it — `mount(el, props)` or `render(props)` — with
// `ViewProps` whose `runtime` is a proxy: `ctx` is the realm ctx proxy (every op a message the host
// answers through the mediated ctx, exactly as for the app's logic), the watchers are messages the
// host answers with the runtime's own watchers.
//
// It answers the host's pings. A view stuck in a loop cannot, and that is how the host knows.
//
// Nothing here is trusted by the host: the view's code runs in this realm and can rewrite all of it.

import { Component, createElement, useEffect, useRef, useState, type ReactNode } from "react";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import type { Ctx, Id, PotyroRecord, Resolved } from "potyro";
import { loadMessageFormat } from "../format.js";
import { makeRealmCtx } from "./ctx-proxy.js";
import { portTransport } from "./port-transport.js";
import { dispatchSocketEvent } from "./realm-sockets.js";
import type { HostToView, ViewInit, ViewOp } from "./protocol.js";

type Spec = { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number };
type QueryState = { rows: Resolved[]; loading: boolean; error?: string };
type RecordState = { record: Resolved | null; loading: boolean; error?: string };

interface Scope {
  __reactReal?: unknown;
  __reactJsxReal?: unknown;
  __potyroApp?: unknown;
}
const scope = globalThis as unknown as Scope;

window.addEventListener("message", function onInit(e: MessageEvent) {
  // Only the parent may start the frame; nothing else can reach a sandboxed srcdoc frame anyway.
  if (e.source !== window.parent) return;
  const data = e.data as ViewInit | null;
  if (!data || data.t !== "init" || e.ports.length !== 1) return;
  window.removeEventListener("message", onInit);
  void boot(e.ports[0]!, data);
});

function applyTokens(tokens: Record<string, string>): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens)) {
    if (name.startsWith("--")) root.style.setProperty(name, value);
  }
  // The frame paints with the page's own scheme, or an engine gives it an opaque backdrop.
  if (tokens["color-scheme"]) root.style.colorScheme = tokens["color-scheme"];
  if (tokens["font-family"]) root.style.setProperty("--k-view-font", tokens["font-family"]);
  if (tokens.color) root.style.setProperty("--k-view-ink", tokens.color);
}

/** `page` or `page#index`, as `resolveView` reads it (schema/src/layout.ts). */
function findView(app: Record<string, unknown>, pageRef: string): Record<string, unknown> | null {
  const at = pageRef.indexOf("#");
  const pageId = at < 0 ? pageRef : pageRef.slice(0, at);
  const page = ((app.pages ?? []) as Array<Record<string, unknown>>).find((p) => p.id === pageId);
  if (!page) return null;
  const layout = page.layout as { items?: Array<{ view?: Record<string, unknown> }> } | undefined;
  if (at >= 0) return layout?.items?.[Number(pageRef.slice(at + 1))]?.view ?? null;
  return (page.view as Record<string, unknown> | undefined) ?? layout?.items?.[0]?.view ?? null;
}

function applySpec(rows: Resolved[], spec: Spec | undefined): Resolved[] {
  let out = rows;
  if (spec?.filter) out = out.filter((r) => spec.filter!(r));
  if (spec?.sort) out = [...out].sort(spec.sort);
  return out;
}

async function boot(port: MessagePort, init: ViewInit): Promise<void> {
  const tx = portTransport(port);
  const watchers = new Map<number, (state: unknown) => void>();
  let wseq = 0;
  let teardown: (() => void) | null = null;
  let root: Root | null = null;
  /** The ctx's plain data: the host sends a new one when the selection, the people or the space change. */
  let base = init.base;

  port.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as HostToView;
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "ping") return port.postMessage({ t: "pong", n: msg.n });
    if (tx.onReply(msg as never)) return;
    if (msg.t === "watch") return watchers.get(msg.wid)?.(msg.state);
    if (msg.t === "tokens") return applyTokens(msg.tokens);
    // Kept to its id: the view's ctx is the view's, whatever the message says.
    if (msg.t === "base") return void (base = { ...msg.base, ctxId: init.base.ctxId });
    if (msg.t === "sock") return dispatchSocketEvent(msg.ev);
    if (msg.t === "stop") {
      // A courtesy before the frame is removed: a view that replaced this handler cannot be made to.
      try {
        teardown?.();
        root?.unmount();
      } catch {
        /* going anyway */
      }
      teardown = null;
      root = null;
    }
  };
  port.postMessage({ t: "up" });

  const view = (op: ViewOp, ...args: unknown[]): Promise<unknown> => tx.call(init.base.ctxId, op as never, args);
  const viewSend = (op: ViewOp, ...args: unknown[]): void => tx.send(init.base.ctxId, op as never, args);
  // A fresh ctx per access, as a trusted view's `runtime.ctx` is: its time is now, deterministic
  // within the access. The id is the view's alone; the host answers it with a fresh mediated ctx too.
  const ctxNow = (): Ctx => makeRealmCtx({ ...base, nowIso: new Date().toISOString() }, tx, { progressPrefix: "v" });

  function watch(op: "runtime.watchQuery" | "runtime.watchRecord", args: unknown[], cb: (state: unknown) => void): () => void {
    const wid = ++wseq;
    watchers.set(wid, cb);
    view(op, wid, ...args).catch((e: unknown) => cb({ rows: [], record: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      if (!watchers.delete(wid)) return;
      viewSend("runtime.unwatch", wid);
    };
  }

  const runtime = {
    get ctx(): Ctx {
      return ctxNow();
    },
    definition: JSON.parse(init.definition) as unknown,
    language: init.language,
    watchQuery(entity: string, spec: Spec | undefined, cb: (s: QueryState) => void) {
      // The rows cross; the app's own filter and sort run here, over them, as `ctx.query`'s do.
      return watch("runtime.watchQuery", [String(entity)], (s) => {
        const st = s as QueryState;
        cb({ ...st, rows: applySpec(st.rows ?? [], spec) });
      });
    },
    watchRecord(entity: string, id: Id, cb: (s: RecordState) => void) {
      return watch("runtime.watchRecord", [String(entity), String(id)], (s) => cb(s as RecordState));
    },
    useQuery(entity: string, spec?: Spec): QueryState {
      const [state, setState] = useState<QueryState>({ rows: [], loading: true });
      const specRef = useRef(spec);
      specRef.current = spec;
      useEffect(() => runtime.watchQuery(entity, { filter: (r) => specRef.current?.filter?.(r) ?? true, sort: specRef.current?.sort ? (a, b) => specRef.current!.sort!(a, b) : undefined }, setState), [entity]);
      return state;
    },
    useRecord(entity: string, id: Id): RecordState {
      const [state, setState] = useState<RecordState>({ record: null, loading: true });
      useEffect(() => runtime.watchRecord(entity, id, setState), [entity, id]);
      return state;
    },
    runAction: async (entity: string, key: string, id: Id, input?: unknown): Promise<void> => {
      await view("runtime.runAction", String(entity), String(key), String(id), input);
    },
    create: (entity: string, data: Partial<PotyroRecord>) => ctxNow().create(entity, data as never),
    patch: async (entity: string, id: Id, data: Partial<PotyroRecord>): Promise<void> => {
      await ctxNow().patch(entity, id, data as never);
    },
    remove: (entity: string, id: Id) => ctxNow().delete(entity, id),
    reconcileReminders: async (): Promise<void> => {
      await view("runtime.reconcileReminders");
    },
  };

  const failed = (e: unknown) => port.postMessage({ t: "failed", error: e instanceof Error ? e.message : String(e) });
  try {
    applyTokens(init.tokens);
    await loadMessageFormat();
    // The view bundle's `react` and `react/jsx-runtime` are these (shell app-bundler.ts `bundleViewSource`).
    scope.__reactReal = React;
    scope.__reactJsxReal = JsxRuntime;
    // Indirect eval, as in the Worker: the realm CSP allows it on purpose (protocol.ts REALM_CSP).
    (0, eval)(init.code);
    const app = scope.__potyroApp as Record<string, unknown> | undefined;
    if (!app || typeof app !== "object") throw new Error("the bundle did not set globalThis.__potyroApp");
    const v = findView(app, init.pageRef);
    if (!v || v.type !== "custom") throw new Error(`page ${init.pageRef} has no custom view`);
    const props = {
      runtime,
      entity: init.entity,
      options: {},
      param: init.param,
      navigate: (page: string, params?: Record<string, string>) => viewSend("view.navigate", String(page), params ? { ...params } : undefined),
    };
    const el = document.getElementById("root")!;
    if (typeof v.mount === "function") {
      const t = (v.mount as (el: HTMLElement, p: unknown) => unknown)(el, props);
      teardown = typeof t === "function" ? (t as () => void) : null;
      port.postMessage({ t: "mounted" });
    } else if (typeof v.render === "function") {
      const render = v.render as (p: unknown) => ReactNode;
      const Rendered = (p: typeof props) => render(p) as never;
      root = createRoot(el);
      root.render(createElement(Boundary, { onError: failed, onMounted: () => port.postMessage({ t: "mounted" }) }, createElement(Rendered, props)));
    } else {
      throw new Error(`page ${init.pageRef}'s custom view has neither mount nor render`);
    }
  } catch (e) {
    failed(e);
  }
}

/** A render that throws is that part failing (#271), not the frame: it says so and shows nothing. */
class Boundary extends Component<{ onError: (e: unknown) => void; onMounted: () => void; children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }
  override componentDidMount(): void {
    if (!this.state.failed) this.props.onMounted();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
