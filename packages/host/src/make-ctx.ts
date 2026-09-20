// Build the `ctx` handed to app functions (docs/04). Data/time/storage/media/ui/nav are always
// real (namespaced to the app via its own Store); `caps` are trust-mediated. Time is fixed at
// construction so computed values are deterministic within an evaluation pass.

import type { Ctx, Field, Id, KartaRecord, MediaRef, Person, QuerySpec, Resolved, UiItem, Value } from "karta";
import { checkFormFields } from "karta";
import { assertCountable, assertPatchFits, assertValuesFit, currentPeople, everyone } from "./values-gate.js";
import type { Store } from "@karta/store";
import { mediateCaps } from "./mediate.js";
import { assertNotAuthor, stampAuthor, stripAuthor } from "./authorship.js";
import { resolveRecord, type ResolveDeps } from "./resolve.js";
import type { LoadedApp, MakeCtxBase } from "./types.js";

const KV_PREFIX = "kv:";

/** A sheet or menu's items, checked: each needs an id and a label, or there is nothing to choose. */
function checkItems<T>(opts: { title?: string; items: UiItem<T>[] }): { title?: string; items: UiItem<T>[] } {
  const items = opts?.items;
  if (!Array.isArray(items) || !items.length) throw new Error("ui.sheet / ui.menu need `items`: at least one { id, label }");
  for (const it of items) if (it == null || typeof it.label !== "string" || it.id === undefined) throw new Error("every ui.sheet / ui.menu item needs an `id` and a `label`");
  return opts;
}

/**
 * Stand-in identity for hosts built without one (tests, fakes, the Studio preview).
 *
 * `ctx.me` is always *present* — that is the contract app code is written against, and the reason
 * it never has to branch on whether sync exists. The composition root supplies the real person from
 * `@karta/identity`; this only keeps a `MemoryStore` test from having to mint an account.
 */
const ANONYMOUS: Person = { id: "local", name: "Me" };

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
  const { store, caps, ui, nav, views } = base;
  const fixedNow = base.now ?? new Date();
  const me = base.me ?? ANONYMOUS;

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
    me,
    ...(base.space ? { space: base.space } : {}),

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
      // `createdBy` is stamped HERE and the app's own value is dropped first (KA-18, authorship.ts).
      // Who entered a record is not who it is about (spike F5): that is a `member` field.
      const clean = stampAuthor(data, me.id);
      assertValuesFit(deps.definition, entity, clean, currentPeople(base.space, me));
      const row = await store.insert(entity, clean as Partial<KartaRecord>);
      deps.memo.clear(); // data changed → invalidate memoized computed for this pass
      return resolveRecord(deps, entity, row);
    },

    async patch(entity, id, data) {
      // Authorship is a fact about the insert, so an edit can never change it (authorship.ts).
      const clean = stripAuthor(data);
      assertPatchFits(deps.definition, entity, clean, (await store.get(entity, id)) as Record<string, unknown> | null, {
        now: currentPeople(base.space, me),
        ever: everyone(store),
      });
      const row = await store.update(entity, id, clean as Partial<KartaRecord>);
      deps.memo.clear();
      return resolveRecord(deps, entity, row);
    },

    async increment(entity, id, field, delta) {
      assertNotAuthor(field);
      assertCountable(deps.definition, entity, field);
      // Falls back rather than failing: only a CRDT store can add deltas up, and a local-only app is
      // single-writer anyway, so read-modify-write there is correct and has nothing to race with.
      if (store.increment) {
        await store.increment(entity, id, field, delta);
      } else {
        const current = await store.get(entity, id);
        const base = Number((current as Record<string, unknown> | null)?.[field] ?? 0);
        await store.update(entity, id, { [field]: base + delta } as Partial<KartaRecord>);
      }
      deps.memo.clear();
      const row = await store.get(entity, id);
      if (!row) throw new Error(`increment: ${entity}/${id} not found`);
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
    // Fixed per pass like `now()`: a filter must see the same selection for every row it judges.
    scope: Object.freeze({ ...(base.scope ?? {}) }),

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
      confirm: (msg, opts) => ui.confirm(msg, opts),
      prompt: (msg, opts) => ui.prompt(msg, opts),
      pick: (items, opts) => ui.pick(items, opts),
      sheet: async <T,>(opts: { title?: string; items: UiItem<T>[] }) => (ui.sheet ? ui.sheet(checkItems(opts)) : null),
      menu: async <T,>(opts: { title?: string; items: UiItem<T>[] }) => (ui.menu ? ui.menu(checkItems(opts)) : null),
      form: async <T,>(opts: { title: string; fields: Record<string, Field>; initial?: Partial<T>; submit?: string }) => {
        // Checked like an entity's fields, and before anything renders: a typo in a form is the app's
        // bug, and it should read as one rather than as a form that silently shows nothing.
        const issues = checkFormFields(opts?.fields, Object.keys(app.definition.entities));
        if (issues.length) throw new Error(issues.join("\n"));
        return ((await ui.form?.({ ...opts, initial: opts.initial as Record<string, unknown> | undefined })) ?? null) as T | null;
      },
      progress: (label) => ui.progress?.(label) ?? { update: () => {}, done: () => {} },
    },

    // `camera` says where a map OPENS; this is the only thing that can move one afterwards, which is
    // why a "centre on me" button could not be written by an app before it existed.
    //
    // The page is resolved when the method is called, never held: a view is a thing on screen, and
    // an app that kept a handle would be holding a reference to something that has since been
    // unmounted. Nobody listening is `false` — a page that is not open cannot be moved, and that is
    // an answer rather than a crash in the middle of someone's action.
    views: {
      map: (pageId: string) => ({
        flyTo: (to) => views?.call?.(pageId, "map.flyTo", to) ?? Promise.resolve(false),
        fit: () => views?.call?.(pageId, "map.fit") ?? Promise.resolve(false),
      }),
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
