// IsolateHost (docs/05, docs/07): the untrusted runner. The app bundle runs in a QuickJS-WASM
// isolate with NO ambient authority — no fetch, DOM, filesystem, or globals. The single bridge
// out is `ctx`, mediated by the host. Records/params marshal in, values marshal out, under
// memory + time limits.

import type { AppDefinition, Ctx, PotyroRecord, PermissionManifest, Resolved, UiProgress, Value, Words } from "potyro";
import { localize } from "potyro";
import { hostPure, PURE_ERROR } from "../format.js";
import type { Store } from "@potyro/store";
import type { BindingRef, LoadedApp, Provenance } from "../types.js";
import { prefetchRelated, resolveRecord, type ResolveDeps } from "../resolve.js";
import { assertCountable, assertPatchFits, assertValuesFit, currentPeople, everyone } from "../values-gate.js";
import { assertNotAuthor, stampAuthor, stripAuthor } from "../authorship.js";
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
  /** Budget for each `invoke()` — one computed/action/filter/etc. call. See `loadTimeoutMs` for the load budget, which is a separate, larger number. */
  timeoutMs?: number;
  /**
   * Budget for `loadIsolated` itself — running the bundle's top-level module body, stringifying
   * the definition, and evaluating the harness. This is deliberately independent of `timeoutMs`:
   * a load does strictly more work than a single call (a large bundle, on a slow device, or a
   * deadline crossed while the tab is backgrounded can legitimately take longer than one call is
   * allowed), so reusing the call budget for it made ordinary loads fail, not just runaway ones.
   * Defaults generous so callers that pass no override (real user paths — opening a shared app,
   * Studio validation) do not regress.
   */
  loadTimeoutMs?: number;
}

const DEFAULT_MEMORY = 64 * 1024 * 1024; // 64 MB
const DEFAULT_TIMEOUT = 1000; // ms per invoke() call — NOT the load; see DEFAULT_LOAD_TIMEOUT
const DEFAULT_LOAD_TIMEOUT = 5000; // ms for loadIsolated (parse + eval bundle + harness install)

function base64OfBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function bytesOfBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

class IsolateLoadedApp implements LoadedApp {
  readonly definition: AppDefinition;
  readonly provenance: Provenance = "untrusted";
  readonly permissions: PermissionManifest;

  private ctxHost: Ctx | null = null;
  private progress = new Map<string, UiProgress>();
  private disposed = false;
  /** Questions open for the person, and the time they have held calls up — a call's budget pauses for them. */
  private questionsOpen = 0;
  private questionSince = 0;
  private questionMs = 0;
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
  private async handleOp(op: Record<string, unknown>): Promise<string> {
    const kind = op.op as string;
    const nul = serialize(null);

    switch (kind) {
      case "log":
        // eslint-disable-next-line no-console
        console.log(`[${this.definition.id}]`, ...((op.args as unknown[]) ?? []));
        return nul;
      case "data.all": {
        const rows = await this.store.all(op.entity as string);
        // A cache for this one call: these deps live as long as the isolate, and a cache that did
        // too would serve rows from before any later write.
        const deps = { ...this.resolveDeps, records: new Map() };
        await prefetchRelated(deps, op.entity as string, rows);
        const resolved = await Promise.all(rows.map((r) => resolveRecord(deps, op.entity as string, r, false)));
        return serialize(resolved);
      }
      case "data.get": {
        const raw = await this.store.get(op.entity as string, op.id as string);
        return serialize(raw ? await resolveRecord(this.resolveDeps, op.entity as string, raw, false) : null);
      }
      // The same authorship rule as the direct ctx (authorship.ts): an untrusted app is exactly the
      // code that must not be able to forge or rewrite `createdBy`.
      case "data.create": {
        const me = this.ctxHost?.me.id;
        if (!me) throw new Error("ctx.create: no identity to stamp the record with");
        const clean = stampAuthor(op.data, me);
        assertValuesFit(this.shown(), op.entity as string, clean, currentPeople(this.ctxHost?.space, this.ctxHost?.me));
        const row = await this.store.insert(op.entity as string, clean as Partial<PotyroRecord>);
        return serialize(await resolveRecord(this.resolveDeps, op.entity as string, row, false));
      }
      case "data.patch": {
        const clean = stripAuthor(op.data);
        const current = (await this.store.get(op.entity as string, op.id as string)) as Record<string, unknown> | null;
        assertPatchFits(this.shown(), op.entity as string, clean, current, {
          now: currentPeople(this.ctxHost?.space, this.ctxHost?.me),
          ever: everyone(this.store),
        });
        const row = await this.store.update(op.entity as string, op.id as string, clean as Partial<PotyroRecord>);
        return serialize(await resolveRecord(this.resolveDeps, op.entity as string, row, false));
      }
      // A shared app runs HERE, so this is the surface that decides whether counting is safe for the
      // people it was shared with. Same fallback as the direct path: a store that cannot add deltas
      // is single-writer, where read-modify-write has nothing to race with.
      case "data.increment": {
        const entity = op.entity as string;
        const id = op.id as string;
        const field = op.field as string;
        assertNotAuthor(field);
        assertCountable(this.shown(), entity, field);
        const delta = Number(op.delta);
        if (!Number.isFinite(delta)) throw new Error("ctx.increment: delta must be a number");
        if (this.store.increment) {
          await this.store.increment(entity, id, field, delta);
        } else {
          const current = await this.store.get(entity, id);
          const base = Number((current as Record<string, unknown> | null)?.[field] ?? 0);
          await this.store.update(entity, id, { [field]: base + delta } as Partial<PotyroRecord>);
        }
        const row = await this.store.get(entity, id);
        if (!row) throw new Error(`increment: ${entity}/${id} not found`);
        return serialize(await resolveRecord(this.resolveDeps, entity, row, false));
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
        this.ctxHost?.ui.toast(op.msg as Words);
        return nul;
      // Questions for the person (#112) — and the older confirm/prompt/pick. Plain data both ways, no
      // permission: none of them reach outside the app. While one is open the call's budget pauses.
      case "ui.confirm":
      case "ui.prompt":
      case "ui.pick":
      case "ui.sheet":
      case "ui.menu":
      case "ui.form":
      case "ui.share": {
        const ctx = this.ctxHost;
        if (!ctx) return nul;
        this.openQuestion();
        try {
          const opts = (op.opts ?? undefined) as never;
          const answer =
            kind === "ui.confirm"
              ? await ctx.ui.confirm(op.msg as Words, opts)
              : kind === "ui.prompt"
                ? await ctx.ui.prompt(op.msg as Words, opts)
                : kind === "ui.pick"
                  ? // `opts.label` is a function and cannot cross, so only `{multi}` arrives: an untrusted
                    // picker labels items the host's default way — a deliberate gap, not an oversight.
                    await ctx.ui.pick(op.items as unknown[], opts)
                  : kind === "ui.sheet"
                    ? await ctx.ui.sheet(opts)
                    : kind === "ui.menu"
                      ? await ctx.ui.menu(opts)
                      : kind === "ui.share"
                        ? await ctx.ui.share(opts)
                        : await ctx.ui.form(opts);
          return serialize((answer ?? (kind === "ui.confirm" || kind === "ui.share" ? false : null)) as Value);
        } finally {
          this.closeQuestion();
        }
      }
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
      // The app's own folder (#252). No permission gate: the folder is this app's alone, and import /
      // export go through a dialog the person answers, which is the consent. Bytes travel as base64.
      case "files.list":
      case "files.stat":
      case "files.text":
      case "files.bytes":
      case "files.url":
      case "files.write":
      case "files.rename":
      case "files.remove":
      case "files.import":
      case "files.export": {
        const files = this.ctxHost?.files;
        if (!files) throw new Error("ctx.files is not available here");
        const file = op.file as string | { id: string };
        switch (kind) {
          case "files.list":
            return serialize(await files.list((op.folder as string | null) ?? undefined));
          case "files.stat":
            return serialize(await files.stat(file));
          case "files.text":
            return serialize(await files.text(file));
          case "files.bytes": {
            const bytes = await files.bytes(file);
            return serialize(bytes ? base64OfBytes(bytes) : null);
          }
          case "files.url":
            return serialize(await files.url(file));
          case "files.write": {
            const data = op.enc === "base64" ? bytesOfBase64(op.data as string) : (op.data as string);
            return serialize(await files.write(op.path as string, data, op.mime ? { mime: op.mime as string } : undefined));
          }
          case "files.rename":
            return serialize(await files.rename(file, op.to as string));
          case "files.remove":
            await files.remove(file);
            return nul;
          case "files.import": {
            const o = (op.opts ?? null) as { folder: string | null; accept: string | null; multiple: boolean } | null;
            this.openQuestion(); // a dialog the person answers: the call's budget pauses, as for ui.*
            try {
              return serialize(await files.import(o ? { folder: o.folder ?? undefined, accept: o.accept ?? undefined, multiple: o.multiple } : undefined));
            } finally {
              this.closeQuestion();
            }
          }
          default:
            this.openQuestion();
            try {
              await files.export(file);
            } finally {
              this.closeQuestion();
            }
            return nul;
        }
      }
      // Move a view that is on screen (`ctx.views`). One op for every verb on purpose: the set of
      // things a view can be told will grow, and each addition should be a case in the view's own
      // handler rather than another op here, another method in the harness, and a release of both.
      //
      // No permission gate: a map this app declared, on a page this app declared, showing this app's
      // records. Nothing crosses the app's boundary, so there is nothing to ask about.
      case "views.call": {
        const ctx = this.ctxHost;
        if (!ctx) return serialize(false);
        const page = op.page as string;
        const verb = op.verb as string;
        const arg = op.arg ?? undefined;
        if (verb === "map.flyTo") return serialize(await ctx.views.map(page).flyTo(arg as { center: [number, number]; zoom?: number }));
        if (verb === "map.fit") return serialize(await ctx.views.map(page).fit());
        return serialize(false);
      }
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
        this.ctxHost?.ui.toast(op.msg as Words);
        return;
      case "nav":
        this.ctxHost?.navigate(op.page as string, op.params as Record<string, string>);
        return;
      case "host.call": {
        // Answered later, never now: the VM is mid-execution while this runs.
        const id = op.id as string;
        this.handleOp(op.req as Record<string, unknown>).then(
          (json) => this.settle(id, true, json),
          (e: unknown) => this.settle(id, false, e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      case "ui.progress": {
        // A bar is a handle inside the VM; out here it is an id, opened on first sight.
        const id = op.id as string;
        let bar = this.progress.get(id);
        if (!bar && this.ctxHost) {
          bar = this.ctxHost.ui.progress((op.label ?? "") as Words);
          this.progress.set(id, bar);
        }
        if (!bar) return;
        if (op.done) {
          bar.done();
          this.progress.delete(id);
        } else if (typeof op.fraction === "number") bar.update(op.fraction, (op.detail as string | null) ?? undefined);
        return;
      }
      case "cap.haptics.vibrate":
        void this.ctxHost?.caps.haptics?.vibrate(op.pattern as number | number[]);
        return;
      default:
        // Unknown sync op — ignore (fire-and-forget contract).
        return;
    }
  }

  installBridge(): void {
    const syncFn = this.vm.newFunction("__hostSync", (argHandle) => {
      this.handleSyncOp(this.vm.getString(argHandle));
      return this.vm.undefined;
    });
    this.vm.setProp(this.vm.global, "__hostSync", syncFn);
    syncFn.dispose();

    // Formatting, answered on the spot (#302): the box has no `Intl`. Pure — `Intl` and the ICU
    // formatter over the arguments, in the host's locale — so it may be synchronous; its time counts
    // against the call's deadline like everything else inside `enter()`. Validation: format.ts.
    const pureFn = this.vm.newFunction("__hostPure", (argHandle) => {
      const ctx = this.ctxHost;
      return this.vm.newString(ctx ? hostPure(this.vm.getString(argHandle), ctx) : `${PURE_ERROR}no call is running`);
    });
    this.vm.setProp(this.vm.global, "__hostPure", pureFn);
    pureFn.dispose();
  }

  /** The definition as the person reads it, for messages about a value that does not fit. */
  private shown(): AppDefinition {
    return localize(this.definition, this.ctxHost?.locale);
  }

  private capsAvailable(ctx: Ctx): string[] {
    return Object.keys(ctx.caps).filter((k) => (ctx.caps as Record<string, unknown>)[k] != null);
  }

  private openQuestion(): void {
    if (this.questionsOpen++ === 0) this.questionSince = Date.now();
  }
  private closeQuestion(): void {
    if (--this.questionsOpen === 0) this.questionMs += Date.now() - this.questionSince;
  }
  /** Milliseconds spent waiting on the person so far, including a question still open. */
  private waitedOnPeople(): number {
    return this.questionMs + (this.questionsOpen ? Date.now() - this.questionSince : 0);
  }

  /** One synchronous entry into the VM, under the per-entry CPU budget, then the jobs it queued. */
  private enter(run: () => void): void {
    const deadline = Date.now() + this.timeoutMs;
    this.vm.runtime.setInterruptHandler(() => Date.now() > deadline);
    try {
      run();
      this.vm.runtime.executePendingJobs();
    } finally {
      this.vm.runtime.removeInterruptHandler?.();
    }
  }

  /** A host call's answer, handed back to the promise waiting for it inside the VM. */
  private settle(id: string, ok: boolean, json: string): void {
    if (this.disposed) return;
    try {
      this.enter(() => {
        this.vm.unwrapResult(this.vm.evalCode(`globalThis.__potyro.settle(${JSON.stringify(id)}, ${ok}, ${JSON.stringify(json)})`)).dispose();
      });
    } catch (e) {
      // The continuation ran out of budget or threw at the top level; the call waiting on it
      // reports that through its own timeout. Nothing here can hand the error to app code.
      console.warn(`[${this.definition.id}] isolate continuation failed:`, e);
    }
  }

  /**
   * Invoke `globalThis.__potyro.call(payload)` and return its value. The budget is wall-clock time
   * spent by the call — its own code and the host calls it waits on — but not the time a question
   * is open for the person: a form can take a minute, and that is not the app running away.
   */
  private async invoke(payload: Record<string, unknown>, ctx: Ctx): Promise<Value> {
    this.ctxHost = ctx;
    const code = `globalThis.__potyro.call(${JSON.stringify(serialize(payload))})`;
    let handle: QuickJSHandle | null = null;
    let settled!: Promise<{ error?: QuickJSHandle; value?: QuickJSHandle }>;
    this.enter(() => {
      handle = this.vm.unwrapResult(this.vm.evalCode(code));
      settled = this.vm.resolvePromise(handle);
    });

    const started = Date.now();
    const waitedBefore = this.waitedOnPeople();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      const check = (): void => {
        const used = Date.now() - started - (this.waitedOnPeople() - waitedBefore);
        if (used >= this.timeoutMs) reject(new Error(`isolate call timed out after ${this.timeoutMs} ms`));
        else timer = setTimeout(check, Math.max(10, this.timeoutMs - used));
      };
      timer = setTimeout(check, this.timeoutMs);
    });
    timedOut.catch(() => {});
    try {
      const resolved = await Promise.race([settled, timedOut]);
      const valueHandle = this.vm.unwrapResult(resolved);
      const out = this.vm.getString(valueHandle);
      valueHandle.dispose();
      const parsed = deserialize<{ ok: boolean; value?: Value; error?: string }>(out);
      if (!parsed.ok) throw new Error(`isolate app error: ${parsed.error}`);
      return parsed.value ?? null;
    } finally {
      clearTimeout(timer);
      if (!this.disposed) (handle as QuickJSHandle | null)?.dispose();
      // ctxHost is left as it is: an action that awaited a question resumes after this call has
      // returned, and its host calls still need a ctx of this app.
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
      // The selection is plain resolved data, like `record` — nothing to reach back through.
      scope: ctx.scope,
      // Which language the words are in, so `ctx.locale` and `ctx.t(words)` never leave the box.
      words: { locale: ctx.locale, language: this.definition.language, languages: this.definition.languages, formatLocale: ctx.format.locale },
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
  async callViewOption(pageId: string, key: string, ctx: Ctx): Promise<Value> {
    return this.invoke({ kind: "viewOption", pageId, key, ...this.base(ctx) }, ctx);
  }
  async callSort(pageId: string, a: Resolved, b: Resolved, ctx: Ctx): Promise<number> {
    // The real ctx (#133): a sort may read the selection, the page's chips or the user's position.
    return Number(await this.invoke({ kind: "sort", pageId, a, b, ...this.base(ctx) }, ctx));
  }
  async callPageOption(pageId: string, key: string, ctx: Ctx): Promise<Value> {
    return this.invoke({ kind: "pageOption", pageId, key, ...this.base(ctx) }, ctx);
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
  async callPageAction(pageId: string, index: number, ctx: Ctx): Promise<void> {
    await this.invoke({ kind: "pageAction", pageId, index, ...this.base(ctx) }, ctx);
  }
  async callAggregate(pageId: string, rows: Resolved[], ctx: Ctx): Promise<Value> {
    // Same one-payload trade as `callSummary`: the whole filtered set crosses once rather than N
    // times, which at personal scale is much cheaper than per-row round trips.
    return this.invoke({ kind: "aggregate", pageId, rows, ...this.base(ctx) }, ctx);
  }

  async callFold(pageId: string, path: string, rows: Resolved[], ctx: Ctx): Promise<Value> {
    return this.invoke({ kind: "fold", pageId, path, rows, ...this.base(ctx) }, ctx);
  }

  async callFieldDefault(entity: string, field: string, ctx: Ctx): Promise<Value> {
    // The definition out here carries the sentinel string where the function was; the function
    // itself is only callable inside the VM.
    return this.invoke({ kind: "fieldDefault", entity, key: field, ...this.base(ctx) }, ctx);
  }

  async reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null> {
    const v = await this.invoke({ kind: "reminderWhen", id, record, ...this.base(ctx) }, ctx);
    return v == null ? null : v instanceof Date ? v : new Date(String(v));
  }
  customView(): null {
    return null; // docs/05: custom views run only for trusted apps
  }
  dispose(): void {
    this.disposed = true;
    this.vm.dispose();
  }
}

/** Build the untrusted loader. Each loaded app gets its own isolate. */
export function createIsolateLoader(opts: IsolateLoaderOptions) {
  const memory = opts.memoryLimitBytes ?? DEFAULT_MEMORY;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const loadTimeout = opts.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT;

  return async function loadIsolated(args: { code: string; provenance: Provenance }): Promise<LoadedApp> {
    const vm = await opts.newContext();
    vm.runtime.setMemoryLimit(memory);

    // The candidate's module body runs in step 1 below (`evalCode(args.code)`) — before any
    // `call()` has happened, so `invoke()`'s per-call interrupt handler (further down) has not been
    // installed yet. Without a deadline here too, a bundle whose TOP LEVEL never returns (e.g.
    // `while (true) {}` outside any function) would hang forever with no budget applied at all: the
    // isolate is untrusted precisely because its code has not been reviewed, so "no deadline yet" is
    // not a safe state for even one eval. Cover the whole load with its own budget (`loadTimeout`),
    // independent of the per-call budget `invoke()` uses later — see `loadTimeoutMs` on
    // `IsolateLoaderOptions` for why they must differ.
    const deadline = Date.now() + loadTimeout;
    vm.runtime.setInterruptHandler(() => Date.now() > deadline);
    try {
      // 1) Run the app bundle: it must set globalThis.__potyroApp to the app definition.
      const appRes = vm.evalCode(args.code);
      vm.unwrapResult(appRes).dispose();

      // 2) Read the declarative definition out (structure only; functions stay in the VM).
      const defRes = vm.evalCode(
        "JSON.stringify(globalThis.__potyroApp, (k, v) => (typeof v === 'function' ? '__potyro_fn__' : v))",
      );
      const defHandle = vm.unwrapResult(defRes);
      const raw = deserialize<AppDefinition>(vm.getString(defHandle));
      // The guest's `defineApp` brands and validates; the normalisation the real one does — a
      // layout page's `view` is its first item's (#105) — is repeated here, so the shell reads the
      // same shape whether the app ran directly or in the isolate.
      const definition: AppDefinition = {
        ...raw,
        pages: (raw.pages ?? []).map((p) => (p.view ? p : { ...p, view: p.layout!.items[0]!.view })),
      };
      defHandle.dispose();

      // 3) Install the harness (ctx bridge + __potyro.call).
      const app = new IsolateLoadedApp(vm, definition, opts.store, timeout);
      app.installBridge();
      const harnessRes = vm.evalCode(HARNESS_SOURCE);
      vm.unwrapResult(harnessRes).dispose();

      // Success: `app` now owns `vm` and disposes it via `app.dispose()`. Only the interrupt
      // handler — a property of this load, not of the VM's lifetime — needs clearing here.
      vm.runtime.removeInterruptHandler?.();
      return app;
    } catch (e) {
      // A failed load is now the COMMON case, not the rare one (the deadline above is what makes
      // it fail instead of hang). Nothing else holds a handle to `vm` on this path — `IsolateLoadedApp`
      // was never constructed, or was abandoned before being returned — so without disposing here,
      // every killed runaway, OOM, or syntax error strands its whole QuickJS runtime (64 MB budget)
      // for the page's lifetime. That used to be a rare event; an agent loop retrying up to 8
      // candidates per bug, each calling `verifyCandidate`, makes it routine. Clear the interrupt
      // handler before disposing (disposing first would free the runtime pointer it needs), then
      // rethrow so the caller still sees the original failure.
      vm.runtime.removeInterruptHandler?.();
      vm.dispose();
      throw e;
    }
  };
}
