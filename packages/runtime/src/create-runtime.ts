// createRuntime — assembles the RuntimeCore and exposes the docs/05 `Runtime` surface plus a
// few page-aware extras the shell/views use. Views consume this; never Store/Host/Caps.

import type { AppDefinition, Ctx, Id, KartaRecord, Resolved, Runtime } from "karta";
import type { BindingRef } from "@karta/host";
import { RuntimeCore, type RuntimeDeps } from "./core.js";
import { useEntityQuery, usePageQuery, useRecord, type QueryState, type RecordState } from "./hooks.js";

/** The runtime the shell/views use: the docs `Runtime` + page-aware helpers. */
export interface KartaRuntime extends Runtime {
  readonly core: RuntimeCore;
  /** Fresh page-aware query (async) — resolve + JS filter + JS sort via the host. */
  queryPage(pageId: string, params?: Record<string, unknown>): Promise<{ rows: Resolved[]; ctx: Ctx }>;
  /** React hook variant of {@link queryPage}. */
  usePageQuery(pageId: string, params?: Record<string, unknown>): QueryState;
  /** Resolve a view/reminder binding (string field key or function) to a value. */
  resolveBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<import("karta").Value>;
  entityForPage(pageId: string): string;
}

export function createRuntime(deps: RuntimeDeps): KartaRuntime {
  const core = new RuntimeCore(deps);

  return {
    core,
    get definition(): AppDefinition {
      return core.definition;
    },
    get ctx(): Ctx {
      // A fresh ctx per access (deterministic now within the access). Custom views use this for
      // imperative calls; hooks build their own per-pass ctx internally.
      return core.ctxFor();
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
    entityForPage(pageId) {
      return core.entityForPage(pageId);
    },

    // ---- writes / actions ----
    async runAction(entity, key, id, input) {
      await core.runAction(entity, key, id, input);
    },
    create(entity, data): Promise<KartaRecord> {
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
