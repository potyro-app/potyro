// IsolateHost (docs/05, docs/07): the untrusted runner. The app bundle runs in a QuickJS-WASM
// isolate with NO ambient authority — no fetch, DOM, filesystem, or globals. The single bridge
// out is `ctx`, mediated by the host. Records/params marshal in, values marshal out, under
// memory + time limits.

import type { AppDefinition, Ctx, KartaRecord, PermissionManifest, Resolved, Value } from "karta";
import type { Store } from "@karta/store";
import type { BindingRef, LoadedApp, Provenance } from "../types.js";
import { resolveRecord, type ResolveDeps } from "../resolve.js";
import { deserialize, serialize } from "./marshal.js";
import { HARNESS_SOURCE } from "./harness.js";

const KV_PREFIX = "kv:";

// Minimal structural types for the QuickJS async context we depend on (avoids a hard type dep).
export interface QuickJSHandle {
  dispose(): void;
}
export interface QuickJSAsyncContextLike {
  global: QuickJSHandle;
  undefined: QuickJSHandle;
  newString(s: string): QuickJSHandle;
  getString(h: QuickJSHandle): string;
  setProp(target: QuickJSHandle, key: string, value: QuickJSHandle): void;
  newFunction(name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle | undefined): QuickJSHandle;
  newAsyncifiedFunction(name: string, fn: (...args: QuickJSHandle[]) => Promise<QuickJSHandle>): QuickJSHandle;
  evalCode(code: string): { error?: QuickJSHandle; value?: QuickJSHandle };
  evalCodeAsync(code: string): Promise<{ error?: QuickJSHandle; value?: QuickJSHandle }>;
  unwrapResult(result: { error?: QuickJSHandle; value?: QuickJSHandle }): QuickJSHandle;
  resolvePromise(h: QuickJSHandle): Promise<{ error?: QuickJSHandle; value?: QuickJSHandle }>;
  runtime: {
    executePendingJobs(): unknown;
    setMemoryLimit(bytes: number): void;
    setInterruptHandler(cb: () => boolean): void;
    removeInterruptHandler?(): void;
  };
  dispose(): void;
}

export interface IsolateLoaderOptions {
  store: Store;
  /** Factory for a fresh async context (injectable for tests). */
  newContext: () => Promise<QuickJSAsyncContextLike>;
  memoryLimitBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MEMORY = 64 * 1024 * 1024; // 64 MB
const DEFAULT_TIMEOUT = 1000; // ms per call

class IsolateLoadedApp implements LoadedApp {
  readonly definition: AppDefinition;
  readonly provenance: Provenance = "untrusted";
  readonly permissions: PermissionManifest;

  private ctxHost: Ctx | null = null;
  private readonly resolveDeps: ResolveDeps;

  constructor(
    private readonly vm: QuickJSAsyncContextLike,
    definition: AppDefinition,
    private readonly store: Store,
    private readonly timeoutMs: number,
  ) {
    this.definition = definition;
    this.permissions = definition.permissions ?? {};
    this.resolveDeps = {
      definition,
      store,
      // computed are evaluated inside the VM, never here (would re-enter the isolate). The
      // host-side resolver is only used with computed=false, so memo/computing stay empty.
      callComputed: async () => {
        throw new Error("isolate: host must not evaluate computed");
      },
      ctx: undefined as unknown as Ctx,
      memo: new Map(),
      computing: new Set(),
    };
  }

  // ---- host-side bridge servicing ctx.* ops from inside the VM ----
  private async handleOp(opJson: string): Promise<string> {
    const op = deserialize<Record<string, unknown>>(opJson);
    const kind = op.op as string;
    const nul = serialize(null);

    switch (kind) {
      case "log":
        // eslint-disable-next-line no-console
        console.log(`[${this.definition.id}]`, ...((op.args as unknown[]) ?? []));
        return nul;
      case "data.all": {
        const rows = await this.store.all(op.entity as string);
        const resolved = await Promise.all(rows.map((r) => resolveRecord(this.resolveDeps, op.entity as string, r, false)));
        return serialize(resolved);
      }
      case "data.get": {
        const raw = await this.store.get(op.entity as string, op.id as string);
        return serialize(raw ? await resolveRecord(this.resolveDeps, op.entity as string, raw, false) : null);
      }
      case "data.create": {
        const row = await this.store.insert(op.entity as string, op.data as Partial<KartaRecord>);
        return serialize(await resolveRecord(this.resolveDeps, op.entity as string, row, false));
      }
      case "data.patch": {
        const row = await this.store.update(op.entity as string, op.id as string, op.data as Partial<KartaRecord>);
        return serialize(await resolveRecord(this.resolveDeps, op.entity as string, row, false));
      }
      case "data.delete":
        await this.store.delete(op.entity as string, op.id as string);
        return nul;
      case "storage.get": {
        const raw = await this.store.kvGet(KV_PREFIX + (op.key as string));
        return serialize(raw == null ? null : JSON.parse(raw));
      }
      case "storage.set":
        await this.store.kvSet(KV_PREFIX + (op.key as string), JSON.stringify(op.value));
        return nul;
      case "storage.delete":
        await this.store.kvDelete(KV_PREFIX + (op.key as string));
        return nul;
      case "storage.keys": {
        const all = (await this.store.kvKeys?.(KV_PREFIX)) ?? [];
        const prefix = (op.prefix as string | null) ?? null;
        return serialize(all.map((k) => k.slice(KV_PREFIX.length)).filter((k) => (prefix ? k.startsWith(prefix) : true)));
      }
      case "ui.toast":
        this.ctxHost?.ui.toast(op.msg as string);
        return nul;
      case "ui.confirm":
        return serialize((await this.ctxHost?.ui.confirm(op.msg as string)) ?? false);
      case "ui.prompt":
        return serialize((await this.ctxHost?.ui.prompt(op.msg as string, op.opts as { default?: string })) ?? null);
      case "nav":
        this.ctxHost?.navigate(op.page as string, op.params as Record<string, string>);
        return nul;
      case "cap.geo.current":
        return serialize((await this.ctxHost?.caps.geo?.current()) ?? null);
      case "cap.notifications.schedule": {
        const n = op.n as { id: string; at: string; title: string; body?: string };
        await this.ctxHost?.caps.notifications?.schedule({ id: n.id, at: new Date(n.at), title: n.title, body: n.body });
        return nul;
      }
      case "cap.notifications.cancel":
        await this.ctxHost?.caps.notifications?.cancel(op.id as string);
        return nul;
      case "media.url":
        return serialize((await this.ctxHost?.media.url(op.ref as { key: string; mime: string })) ?? "");
      default:
        throw new Error(`isolate bridge: unknown op ${kind}`);
    }
  }

  /** Fire-and-forget ops (toast/log/nav): synchronous so they are safe in promise continuations. */
  private handleSyncOp(opJson: string): void {
    const op = deserialize<Record<string, unknown>>(opJson);
    switch (op.op as string) {
      case "log":
        // eslint-disable-next-line no-console
        console.log(`[${this.definition.id}]`, ...((op.args as unknown[]) ?? []));
        return;
      case "ui.toast":
        this.ctxHost?.ui.toast(op.msg as string);
        return;
      case "nav":
        this.ctxHost?.navigate(op.page as string, op.params as Record<string, string>);
        return;
      case "cap.haptics.vibrate":
        void this.ctxHost?.caps.haptics?.vibrate(op.pattern as number | number[]);
        return;
      default:
        // Unknown sync op — ignore (fire-and-forget contract).
        return;
    }
  }

  installBridge(): void {
    const asyncFn = this.vm.newAsyncifiedFunction("__host", async (argHandle) => {
      const opJson = this.vm.getString(argHandle);
      const result = await this.handleOp(opJson);
      return this.vm.newString(result);
    });
    this.vm.setProp(this.vm.global, "__host", asyncFn);
    asyncFn.dispose();

    const syncFn = this.vm.newFunction("__hostSync", (argHandle) => {
      this.handleSyncOp(this.vm.getString(argHandle));
      return this.vm.undefined;
    });
    this.vm.setProp(this.vm.global, "__hostSync", syncFn);
    syncFn.dispose();
  }

  private capsAvailable(ctx: Ctx): string[] {
    return Object.keys(ctx.caps).filter((k) => (ctx.caps as Record<string, unknown>)[k] != null);
  }

  /** Invoke `globalThis.__karta.call(payload)` in the VM under a timeout; return its value. */
  private async invoke(payload: Record<string, unknown>, ctx: Ctx): Promise<Value> {
    this.ctxHost = ctx;
    const deadline = Date.now() + this.timeoutMs;
    this.vm.runtime.setInterruptHandler(() => Date.now() > deadline);
    try {
      const payloadJson = serialize(payload);
      const code = `globalThis.__karta.call(${JSON.stringify(payloadJson)})`;
      const evalRes = await this.vm.evalCodeAsync(code);
      const promiseHandle = this.vm.unwrapResult(evalRes);
      const nativePromise = this.vm.resolvePromise(promiseHandle);
      this.vm.runtime.executePendingJobs();
      const resolved = await nativePromise;
      promiseHandle.dispose();
      const valueHandle = this.vm.unwrapResult(resolved);
      const out = this.vm.getString(valueHandle);
      valueHandle.dispose();
      const parsed = deserialize<{ ok: boolean; value?: Value; error?: string }>(out);
      if (!parsed.ok) throw new Error(`isolate app error: ${parsed.error}`);
      return parsed.value ?? null;
    } finally {
      this.vm.runtime.removeInterruptHandler?.();
      this.ctxHost = null;
    }
  }

  private base(ctx: Ctx): Record<string, unknown> {
    // Identity crosses as plain data (KA-18). `me` is a value, not a handle, so an isolate cannot
    // reach back through it; `space.invite()` is deliberately NOT sent, because minting an invite is
    // host-mediated UI — untrusted code that could call it could hand the space away silently.
    return {
      params: ctx.params,
      nowIso: ctx.now().toISOString(),
      capsAvailable: this.capsAvailable(ctx),
      me: ctx.me,
      space: ctx.space ? { id: ctx.space.id, role: ctx.space.role, members: ctx.space.members } : undefined,
    };
  }

  async callComputed(entity: string, key: string, record: Resolved, ctx: Ctx): Promise<Value> {
    return this.invoke({ kind: "computed", entity, key, record, ...this.base(ctx) }, ctx);
  }
  async callAction(entity: string, key: string, record: Resolved, ctx: Ctx, input?: unknown): Promise<void> {
    await this.invoke({ kind: "action", entity, key, record, input, ...this.base(ctx) }, ctx);
  }
  async callFilter(pageId: string, record: Resolved, ctx: Ctx): Promise<boolean> {
    return Boolean(await this.invoke({ kind: "filter", pageId, record, ...this.base(ctx) }, ctx));
  }
  async callSort(pageId: string, a: Resolved, b: Resolved): Promise<number> {
    // Sort needs no live caps; a bare ctx-ish payload suffices.
    const ctx = { params: {}, now: () => new Date(), caps: {} } as unknown as Ctx;
    return Number(await this.invoke({ kind: "sort", pageId, a, b, params: {}, nowIso: new Date().toISOString(), capsAvailable: [] }, ctx));
  }
  async callBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value> {
    const payload =
      ref.kind === "view"
        ? { kind: "binding", refKind: "view", pageId: ref.page, path: ref.path, record, ...this.base(ctx) }
        : { kind: "binding", refKind: "reminder", id: ref.id, path: ref.path, record, ...this.base(ctx) };
    return this.invoke(payload, ctx);
  }
  async callSummary(pageId: string, index: number, rows: Resolved[], ctx: Ctx): Promise<Value> {
    // The whole filtered set crosses in one payload. At personal scale (docs/01: thousands, not
    // millions) that is cheaper than N per-row round trips through the string bridge.
    return this.invoke({ kind: "summary", pageId, index, rows, ...this.base(ctx) }, ctx);
  }
  async callAggregate(pageId: string, rows: Resolved[], ctx: Ctx): Promise<Value> {
    // Same one-payload trade as `callSummary`: the whole filtered set crosses once rather than N
    // times, which at personal scale is much cheaper than per-row round trips.
    return this.invoke({ kind: "aggregate", pageId, rows, ...this.base(ctx) }, ctx);
  }

  async reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null> {
    const v = await this.invoke({ kind: "reminderWhen", id, record, ...this.base(ctx) }, ctx);
    return v == null ? null : v instanceof Date ? v : new Date(String(v));
  }
  customView(): null {
    return null; // docs/05: custom views run only for trusted apps
  }
  dispose(): void {
    this.vm.dispose();
  }
}

/** Build the untrusted loader. Each loaded app gets its own isolate. */
export function createIsolateLoader(opts: IsolateLoaderOptions) {
  const memory = opts.memoryLimitBytes ?? DEFAULT_MEMORY;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  return async function loadIsolated(args: { code: string; provenance: Provenance }): Promise<LoadedApp> {
    const vm = await opts.newContext();
    vm.runtime.setMemoryLimit(memory);

    // 1) Run the app bundle: it must set globalThis.__kartaApp to the app definition.
    const appRes = vm.evalCode(args.code);
    vm.unwrapResult(appRes).dispose();

    // 2) Read the declarative definition out (structure only; functions stay in the VM).
    const defRes = vm.evalCode(
      "JSON.stringify(globalThis.__kartaApp, (k, v) => (typeof v === 'function' ? '__karta_fn__' : v))",
    );
    const defHandle = vm.unwrapResult(defRes);
    const definition = deserialize<AppDefinition>(vm.getString(defHandle));
    defHandle.dispose();

    // 3) Install the harness (ctx bridge + __karta.call).
    const app = new IsolateLoadedApp(vm, definition, opts.store, timeout);
    app.installBridge();
    const harnessRes = vm.evalCode(HARNESS_SOURCE);
    vm.unwrapResult(harnessRes).dispose();

    return app;
  };
}
