// Build the `ctx` handed to app functions (docs/04). Data/time/storage/media/ui/nav are always
// real (namespaced to the app via its own Store); `caps` are trust-mediated. Time is fixed at
// construction so computed values are deterministic within an evaluation pass.

import type { Ctx, Id, KartaRecord, MediaRef, QuerySpec, Resolved, Value } from "karta";
import type { Store } from "@karta/store";
import { mediateCaps } from "./mediate.js";
import { resolveRecord, type ResolveDeps } from "./resolve.js";
import type { LoadedApp, MakeCtxBase } from "./types.js";

const KV_PREFIX = "kv:";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function mediaUrl(store: Store, ref: MediaRef): Promise<string> {
  const blob = await store.getBlob(ref);
  if (!blob) return "";
  const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
  if (g.URL?.createObjectURL) return g.URL.createObjectURL(blob);
  // Node / non-DOM fallback: inline data URL.
  const bytes = Buffer.from(await blob.arrayBuffer());
  return `data:${ref.mime};base64,${bytes.toString("base64")}`;
}

export function buildCtx(app: LoadedApp, base: MakeCtxBase): Ctx {
  const { store, caps, ui, nav } = base;
  const fixedNow = base.now ?? new Date();

  // Resolver dependencies. `ctx` is filled in after construction (computed fns receive it).
  // memo/computing are per-ctx → per evaluation pass (docs/04: now() is fixed per pass too).
  const deps: ResolveDeps = {
    definition: app.definition,
    store,
    callComputed: (entity, key, record, c) => app.callComputed(entity, key, record, c),
    ctx: undefined as unknown as Ctx,
    memo: new Map(),
    computing: new Set(),
  };

  // Resolve rows sequentially (not Promise.all): computed may call ctx.query and resolve shared
  // records, so a single-threaded resolution chain keeps the cycle guard's `computing` set a
  // valid stack (concurrent resolution of the same computed would look like a false cycle).
  // Memoization makes the repeated work cheap; personal scale makes the lost parallelism moot.
  const resolveMany = async (entity: string, rows: KartaRecord[]): Promise<Resolved[]> => {
    const out: Resolved[] = [];
    for (const r of rows) out.push(await resolveRecord(deps, entity, r));
    return out;
  };

  const applySpec = (rows: Resolved[], spec?: QuerySpec): Resolved[] => {
    let out = rows;
    if (spec?.filter) out = out.filter((r) => spec.filter!(r));
    if (spec?.sort) out = [...out].sort(spec.sort);
    const offset = spec?.offset ?? 0;
    const end = spec?.limit != null ? offset + spec.limit : undefined;
    return offset || end != null ? out.slice(offset, end) : out;
  };

  const ctx: Ctx = {
    async query(entity, spec) {
      const rows = await store.all(entity);
      const resolved = await resolveMany(entity, rows);
      return applySpec(resolved, spec);
    },

    async get(entity, id) {
      const raw = await store.get(entity, id);
      return raw ? resolveRecord(deps, entity, raw) : null;
    },

    async create(entity, data) {
      const row = await store.insert(entity, data as Partial<KartaRecord>);
      deps.memo.clear(); // data changed → invalidate memoized computed for this pass
      return resolveRecord(deps, entity, row);
    },

    async patch(entity, id, data) {
      const row = await store.update(entity, id, data as Partial<KartaRecord>);
      deps.memo.clear();
      return resolveRecord(deps, entity, row);
    },

    async delete(entity, id) {
      await store.delete(entity, id);
      deps.memo.clear();
    },

    async transaction(fn) {
      return store.transaction(async () => fn(ctx));
    },

    now() {
      return fixedNow;
    },
    today() {
      return startOfDay(fixedNow);
    },

    params: Object.freeze({ ...(base.params ?? {}) }),

    storage: {
      async get<T = unknown>(k: string): Promise<T | null> {
        const raw = await store.kvGet(KV_PREFIX + k);
        return raw == null ? null : (JSON.parse(raw) as T);
      },
      async set(k, v) {
        await store.kvSet(KV_PREFIX + k, JSON.stringify(v));
      },
      async delete(k) {
        await store.kvDelete(KV_PREFIX + k);
      },
      async keys(prefix) {
        const all = (await store.kvKeys?.(KV_PREFIX)) ?? [];
        return all
          .map((k) => k.slice(KV_PREFIX.length))
          .filter((k) => (prefix ? k.startsWith(prefix) : true));
      },
    },

    caps: mediateCaps({
      caps,
      provenance: app.provenance,
      permissions: app.permissions,
      ui,
      appName: app.definition.name,
    }),

    media: {
      put: (bytes) => store.putBlob(bytes),
      url: (ref) => mediaUrl(store, ref),
    },

    ui: {
      toast: (msg) => ui.toast(msg),
      confirm: (msg) => ui.confirm(msg),
      prompt: (msg, opts) => ui.prompt(msg, opts),
      pick: (items, opts) => ui.pick(items, opts),
    },

    navigate: (pageId, params) => nav.navigate(pageId, params),

    log: (...args) => {
      // Namespaced diagnostic; the shell may route this elsewhere.
      // eslint-disable-next-line no-console
      console.log(`[${app.definition.id}]`, ...args);
    },
  };

  deps.ctx = ctx;
  return ctx;
}

export type { Id, Value };
