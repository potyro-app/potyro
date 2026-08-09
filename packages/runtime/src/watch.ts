// Framework-free data access: run a query, re-run it whenever the entity changes, hand the result to
// a callback, return an unsubscribe.
//
// This is the primitive the React hooks were three copies of. It matters beyond tidiness: `useQuery`
// and `useRecord` are part of the APP-FACING contract (docs/05), so until now an app's custom view
// could only consume data by calling React hooks. That made React a load-bearing part of the public
// API rather than an implementation choice. A subscription is something any framework can adapt —
// React via `useSyncExternalStore`, Svelte via a store, plain JS by just calling it — so the choice
// of view framework stops being architectural.
//
// The reactive machinery underneath was never React's: `Store.subscribe(entity, cb)` has been there
// all along.

import type { Id, Resolved } from "karta";
import type { RuntimeCore } from "./core.js";

export type Unsubscribe = () => void;

export interface QueryState {
  rows: Resolved[];
  loading: boolean;
}

export interface RecordState {
  record: Resolved | null;
  loading: boolean;
}

/**
 * Shared shape: emit once now, re-emit on every write to `entity`, stop on unsubscribe.
 *
 * `read` is re-invoked rather than closed over, so a caller can change its query parameters between
 * runs (the page-query watcher does this) without re-subscribing.
 */
function watch<T>(
  core: RuntimeCore,
  entity: string,
  read: () => Promise<T>,
  emit: (value: T) => void,
): Unsubscribe {
  let alive = true;
  const run = (): void => {
    void read().then((value) => {
      // A late-arriving result after unsubscribe would push state into a torn-down consumer.
      if (alive) emit(value);
    });
  };
  run();
  // Both sources: writes to this entity, and anything else that changes what a view would render —
  // membership, for one. A watcher listening only to the store misses the second and shows stale
  // output until an unrelated write happens along.
  const unsubStore = core.store.subscribe(entity, run);
  const unsubInvalidate = core.onInvalidate(run);
  return () => {
    alive = false;
    unsubStore();
    unsubInvalidate();
  };
}

/** Watch a page's rows — the view's own filter/sort/params applied. */
export function watchPageQuery(
  core: RuntimeCore,
  pageId: string,
  params: (() => Record<string, unknown> | undefined) | Record<string, unknown> | undefined,
  cb: (state: QueryState) => void,
): Unsubscribe {
  const read = typeof params === "function" ? params : () => params;
  return watch(
    core,
    core.entityForPage(pageId),
    () => core.queryPage(pageId, read()).then(({ rows }) => ({ rows, loading: false })),
    cb,
  );
}

/** Watch an entity with an ad-hoc filter/sort. */
export function watchEntityQuery(
  core: RuntimeCore,
  entity: string,
  spec: (() => { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number } | undefined) | undefined,
  cb: (state: QueryState) => void,
): Unsubscribe {
  return watch(core, entity, () => core.queryEntity(entity, spec?.()).then((rows) => ({ rows, loading: false })), cb);
}

/** Watch one record. */
export function watchRecord(
  core: RuntimeCore,
  entity: string,
  id: Id,
  cb: (state: RecordState) => void,
): Unsubscribe {
  return watch(core, entity, () => core.getRecord(entity, id).then((record) => ({ record, loading: false })), cb);
}
