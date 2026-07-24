// RuntimeCore — the framework-agnostic engine (docs/05 "Runtime"). It owns the read path
// (resolve via ctx → JS filter via host → JS sort via host), the write/action path, reminder
// reconciliation, and binding resolution. React hooks (hooks.ts) wrap this. Everything goes
// through the Host so trusted (direct) and untrusted (isolate) execution are uniform.

import type { AppDefinition, Ctx, Id, KartaRecord, Resolved, Value, View } from "karta";
import type { BindingRef, Host, LoadedApp, MakeCtxBase, NavBridge, UiBridge } from "@karta/host";
import type { Capabilities } from "@karta/capabilities";
import type { Store } from "@karta/store";
import { asyncSort } from "./async-sort.js";

/** Sentinel a bundler/isolate loader uses to mark a function-valued binding it can't serialize. */
export const FN_SENTINEL = "__karta_fn__";

export interface RuntimeDeps {
  app: LoadedApp;
  host: Host;
  store: Store;
  caps: Capabilities;
  ui: UiBridge;
  nav: NavBridge;
  /** Fixed evaluation time (tests); omit for real now(). */
  now?: Date;
}

function viewOf(def: AppDefinition, pageId: string): View {
  const page = def.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`page ${pageId} not found`);
  return page.view;
}

export class RuntimeCore {
  readonly app: LoadedApp;
  readonly host: Host;
  readonly store: Store;
  private readonly caps: Capabilities;
  private readonly ui: UiBridge;
  private readonly nav: NavBridge;
  private readonly now?: Date;

  constructor(deps: RuntimeDeps) {
    this.app = deps.app;
    this.host = deps.host;
    this.store = deps.store;
    this.caps = deps.caps;
    this.ui = deps.ui;
    this.nav = deps.nav;
    this.now = deps.now;
  }

  get definition(): AppDefinition {
    return this.app.definition;
  }

  /** Build a fresh ctx (deterministic time per pass) with optional view params. */
  ctxFor(params?: Record<string, unknown>): Ctx {
    const base: MakeCtxBase = { store: this.store, caps: this.caps, ui: this.ui, nav: this.nav, params, now: this.now };
    return this.host.makeCtx(this.app, base);
  }

  entityForPage(pageId: string): string {
    const view = viewOf(this.definition, pageId) as { entity: string };
    return view.entity;
  }

  /**
   * Resolve a page's rows: fetch + resolve (relations/computed) via ctx, then apply the view's
   * JS filter and sort through the host (uniform across trust). Always goes through the host so
   * an untrusted app's predicates run in its isolate.
   */
  async queryPage(pageId: string, params?: Record<string, unknown>): Promise<{ rows: Resolved[]; ctx: Ctx }> {
    const entity = this.entityForPage(pageId);
    const ctx = this.ctxFor(params);
    const resolved = await ctx.query(entity);
    const keep = await Promise.all(resolved.map((r) => this.app.callFilter(pageId, r, ctx)));
    const filtered = resolved.filter((_, i) => keep[i]);
    const sorted = await asyncSort(filtered, (a, b) => this.app.callSort(pageId, a, b));
    return { rows: sorted, ctx };
  }

  /** Query an entity with explicit JS predicates (used by custom views; trusted closures). */
  async queryEntity(
    entity: string,
    spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number },
    params?: Record<string, unknown>,
  ): Promise<Resolved[]> {
    const ctx = this.ctxFor(params);
    return ctx.query(entity, spec);
  }

  async getRecord(entity: string, id: Id, params?: Record<string, unknown>): Promise<Resolved | null> {
    return this.ctxFor(params).get(entity, id);
  }

  async runAction(entity: string, key: string, id: Id, input?: unknown, params?: Record<string, unknown>): Promise<void> {
    const ctx = this.ctxFor(params);
    const record = await ctx.get(entity, id);
    if (!record) throw new Error(`runAction: ${entity}/${id} not found`);
    await this.app.callAction(entity, key, record, ctx, input);
  }

  async create(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord> {
    return this.ctxFor().create(entity, data as Record<string, unknown>);
  }

  async patch(entity: string, id: Id, data: Partial<KartaRecord>): Promise<void> {
    await this.ctxFor().patch(entity, id, data as Record<string, unknown>);
  }

  async remove(entity: string, id: Id): Promise<void> {
    await this.ctxFor().delete(entity, id);
  }

  /** Raw binding value from the (trust-visible) definition, for string-vs-function decisions. */
  private rawBinding(ref: BindingRef): unknown {
    const def = this.definition;
    if (ref.kind === "reminder") {
      const rem = (def.reminders ?? []).find((r) => r.id === ref.id);
      return rem?.[ref.path];
    }
    const view = viewOf(def, ref.page) as unknown as Record<string, unknown>;
    if (ref.path.startsWith("display.")) {
      const key = ref.path.slice("display.".length);
      return (view.display as Record<string, unknown> | undefined)?.[key];
    }
    return view[ref.path];
  }

  /** Resolve a view/reminder binding to a value: field-key strings read the record; functions
   *  (or isolate sentinels) are called through the host. */
  async resolveBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value> {
    const raw = this.rawBinding(ref);
    if (typeof raw === "string" && raw !== FN_SENTINEL) {
      return (record[raw] ?? null) as Value;
    }
    if (raw == null) return null;
    return this.app.callBinding(ref, record, ctx);
  }

  /** Reconcile reminders: schedule future ones via notifications (docs/03). No-op offline. */
  async reconcileReminders(params?: Record<string, unknown>): Promise<void> {
    const ctx = this.ctxFor(params);
    const notif = ctx.caps.notifications;
    for (const rem of this.definition.reminders ?? []) {
      const rows = await ctx.query(rem.entity);
      for (const r of rows) {
        const when = await this.app.reminderWhen(rem.id, r, ctx);
        if (!when || !notif) continue;
        if (when.getTime() <= ctx.now().getTime()) continue; // only schedule future
        const title = await this.resolveBinding({ kind: "reminder", id: rem.id, path: "title" }, r, ctx);
        const body = rem.body ? await this.resolveBinding({ kind: "reminder", id: rem.id, path: "body" }, r, ctx) : undefined;
        await notif.schedule({
          id: `${rem.id}:${r.id}`,
          at: when,
          title: String(title ?? ""),
          body: body == null ? undefined : String(body),
        });
      }
    }
  }
}
