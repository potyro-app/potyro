// createRuntime — assembles the RuntimeCore and exposes the docs/05 `Runtime` surface plus a
// few page-aware extras the shell/views use. Views consume this; never Store/Host/Caps.

import type { AppDefinition, Ctx, Id, PotyroRecord, Resolved, Runtime } from "potyro";
import { onAppFailure, reportAppFailure, type AppFailure, type BindingRef } from "@potyro/host";
import { RuntimeCore, type RuntimeDeps } from "./core.js";
import { useEntityQuery, usePageQuery, useRecord, type QueryState, type RecordState } from "./hooks.js";
import { watchEntityQuery, watchPageQuery, watchRecord } from "./watch.js";

/** The runtime the shell/views use: the docs `Runtime` + page-aware helpers. */
export interface PotyroRuntime extends Runtime {
  readonly core: RuntimeCore;
  /** Fresh page-aware query (async) — resolve + JS filter + JS sort via the host. */
  queryPage(pageId: string, params?: Record<string, unknown>): Promise<{ rows: Resolved[]; ctx: Ctx }>;
  /** React hook variant of {@link queryPage}. */
  usePageQuery(pageId: string, params?: Record<string, unknown>): QueryState;
  /** A page's rows as a subscription — the framework-free form of `usePageQuery`. */
  watchPageQuery(
    pageId: string,
    params: Record<string, unknown> | undefined,
    cb: (state: QueryState) => void,
  ): () => void;
  /** Resolve a view/reminder binding (string field key or function) to a value. */
  resolveBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<import("potyro").Value>;
  entityForPage(pageId: string): string;
  /** The app-wide selection (`ctx.scope`), by entity — what the header chip shows. */
  readonly scope: Readonly<Record<string, Resolved | undefined>>;
  /**
   * Select the app-wide record for an entity by id (`null` clears it). Loads it resolved, then every
   * live watcher re-runs. The shell calls this from the scope picker and at boot from what it saved.
   */
  setScope(entity: string, id: string | null): Promise<void>;
  /** A `Dynamic<T>` view option — the literal, or the function evaluated with a fresh ctx. */
  viewOption(pageId: string, key: string, params?: Record<string, unknown>): Promise<import("potyro").Value>;
  /** A `Dynamic<T>` page option (`title`) — the literal, or the function evaluated with a fresh ctx. */
  pageOption(pageId: string, key: string, params?: Record<string, unknown>): Promise<import("potyro").Value>;
  /**
   * Be told when a photo's bytes arrive (KA-20).
   *
   * In a shared app a photo is its own CoValue, fetched when someone looks at it, so a view can hold
   * a reference whose bytes are still on their way. Returns a no-op unsubscribe on a store that keeps
   * everything locally, where there is nothing to wait for.
   */
  watchMedia(ref: import("potyro").MediaRef, cb: () => void): () => void;
  /**
   * A view says it is on screen and can be driven (`ctx.views`); the returned function takes it back
   * out on unmount. `verb` is namespaced by view type ("map.flyTo"), and a handler returns whether
   * it took the call, so a page showing several views can be addressed by page id alone.
   */
  registerViewControl(pageId: string, handle: (verb: string, arg?: unknown) => boolean | Promise<boolean>): () => void;
  /** Run a page's declared button (`Page.actions[index]`), with the page's current params in ctx. */
  runPageAction(pageId: string, index: number, params?: Record<string, unknown>): Promise<void>;
  /**
   * Resolves once every write this runtime started has landed (or failed). Await it before closing
   * the store: a write still on its way would otherwise land on a closed database and be lost.
   */
  settle(): Promise<void>;
  /**
   * Hear this app's contained failures (#271): a computed value, a filter, an action or a view that
   * threw and was kept to that part. `what` names the part in the app's own terms — `computed
   * meal.kcal`, `page today`, `view today#1`, `action meal.log`. Returns the unsubscribe.
   */
  onFailure(cb: (failure: AppFailure) => void): () => void;
  /** Say that a part of this app failed and was contained — for the views that contain it. */
  reportFailure(what: string, error: unknown): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createRuntime(deps: RuntimeDeps): PotyroRuntime {
  const core = new RuntimeCore(deps);

  // Tell the store what the app declared (KA-38).
  //
  // Here, because this is the only place holding both — `Store.open` takes an id and nothing else,
  // which is exactly why a CRDT store could not merge the things the schema had already named.
  // Every composition root goes through `createRuntime`, so there is no second call site to forget,
  // and a store without `describe` is unaffected.
  //
  // Only the FIELDS, which are plain data. Computed and actions are functions, and a seam that
  // carried them across would be inviting whatever is on the other side to call them.
  deps.store.describe?.(
    Object.fromEntries(Object.entries(core.definition.entities).map(([entity, def]) => [entity, def.fields ?? {}])),
    // Who may change what (KA-21). The store is where authorship is signed, so it is the one that
    // can hold another member's edit to someone else's row back.
    {
      creatorOnly: Object.entries(core.definition.entities)
        .filter(([, def]) => def.editableBy === "creator")
        .map(([entity]) => entity),
    },
  );

  return {
    watchMedia: (ref, cb) => deps.store.subscribeBlob?.(ref, cb) ?? (() => {}),
    registerViewControl: (pageId, handle) => core.registerViewControl(pageId, handle),
    settle: () => core.settle(),
    async runPageAction(pageId, index, params) {
      // The same catch `runAction` needs, for the same reason: a button fires this from a click
      // handler, so an escaping rejection would be invisible to the person who pressed it.
      try {
        await core.runPageAction(pageId, index, params);
      } catch (e) {
        const message = messageOf(e);
        deps.ui.toast(message);
        reportAppFailure({ app: core.definition.id, what: `page action ${pageId}[${index}]`, message });
        console.warn(`[potyro] page action ${pageId}[${index}] failed:`, e);
      }
    },
    onFailure(cb) {
      const app = core.definition.id;
      return onAppFailure((f) => {
        if (f.app === app) cb(f);
      });
    },
    reportFailure(what, error) {
      reportAppFailure({ app: core.definition.id, what, message: messageOf(error) });
    },
    core,
    get definition(): AppDefinition {
      return core.definition;
    },
    get ctx(): Ctx {
      // A fresh ctx per access (deterministic now within the access). Custom views use this for
      // imperative calls; hooks build their own per-pass ctx internally.
      return core.ctxFor();
    },

    // ---- docs/05 data access: framework-free watchers, then the React sugar over them ----
    watchQuery(entity, spec, cb) {
      return watchEntityQuery(core, entity, () => spec, cb);
    },
    watchRecord(entity, id, cb) {
      return watchRecord(core, entity, id, cb);
    },
    /** A page's rows, with the view's own filter/sort applied — the built-in views' data source. */
    watchPageQuery(pageId, params, cb) {
      return watchPageQuery(core, pageId, params, cb);
    },

    // ---- docs/05 Runtime hooks ----
    useQuery(entity, spec) {
      return useEntityQuery(core, entity, spec);
    },
    useRecord(entity, id) {
      return useRecord(core, entity, id);
    },

    // ---- page-aware extras ----
    usePageQuery(pageId, params) {
      return usePageQuery(core, pageId, params);
    },
    queryPage(pageId, params) {
      return core.queryPage(pageId, params);
    },
    resolveBinding(ref, record, ctx) {
      return core.resolveBinding(ref, record, ctx);
    },
    get scope() {
      return core.getScope();
    },
    async setScope(entity, id) {
      core.setScope(entity, id ? await core.getRecord(entity, id) : null);
    },
    viewOption(pageId, key, params) {
      return core.viewOption(pageId, key, params);
    },
    pageOption(pageId, key, params) {
      return core.pageOption(pageId, key, params);
    },
    entityForPage(pageId) {
      return core.entityForPage(pageId);
    },

    // ---- writes / actions ----
    async runAction(entity, key, id, input) {
      // An action is app code and can fail for ordinary reasons — permission denied, network down,
      // a bad id. Every caller fires this from a click handler as `void runtime.runAction(...)`, so
      // an escaping rejection is invisible to the user and shows up only as an unhandled promise
      // rejection in the console. Catch here, once, rather than at each of those call sites.
      try {
        await core.runAction(entity, key, id, input);
      } catch (e) {
        const message = messageOf(e);
        deps.ui.toast(message);
        reportAppFailure({ app: core.definition.id, what: `action ${entity}.${key}`, message });
        console.warn(`[potyro] action ${entity}.${key} failed:`, e);
      }
    },
    create(entity, data): Promise<PotyroRecord> {
      return core.create(entity, data);
    },
    async patch(entity, id, data): Promise<void> {
      await core.patch(entity, id, data);
    },
    async remove(entity, id): Promise<void> {
      await core.remove(entity, id);
    },
    reconcileReminders() {
      return core.reconcileReminders();
    },
  };
}

export type { QueryState, RecordState, Id };
