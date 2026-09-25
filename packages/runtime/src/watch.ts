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
  /** Set when the read failed: a view says so rather than loading forever. */
  error?: string;
}

export interface RecordState {
  record: Resolved | null;
  loading: boolean;
  error?: string;
}

/**
 * A read that failed, as a state a view can show. It used to be swallowed — the view never left
 * "Loading…" and nothing reached the console (the PPL Log report) — so it is logged here, loudly,
 * and handed on as `error`.
 */
function failed(what: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[karta] ${what} could not load:`, e);
  return message;
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
  // ONE read at a time, and at most one more waiting behind it.
  //
  // A change used to start its own read, immediately. That is fine when changes arrive one at a
  // time, and ruinous when they arrive in a burst — which is precisely what opening a synced list
  // is: every record the relay hands back notifies separately, so a 90-item list asked for ~2,200
  // full re-reads, each of them re-reading all 90 records, before it could settle. It also let an
  // older read finish last and leave the view showing fewer rows than it had, permanently.
  //
  // Collapsing the burst fixes both: a read in flight is enough, whatever else arrives while it
  // runs is covered by the single catch-up read that follows it, and results can no longer overtake
  // each other because only one is ever outstanding.
  let reading = false;
  let again = false;
  const run = (): void => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    const settle = (): void => {
      reading = false;
      if (!alive || !again) return;
      again = false;
      run();
    };
    void read().then(
      (value) => {
        // A late result after unsubscribe would push state into a torn-down consumer.
        if (alive) emit(value);
        settle();
      },
      // A failed read must not wedge the watcher shut: whatever it was reading may be readable by
      // the time the next change arrives.
      settle,
    );
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
    () =>
      core.queryPage(pageId, read()).then(
        ({ rows }): QueryState => ({ rows, loading: false }),
        (e: unknown): QueryState => ({ rows: [], loading: false, error: failed(`page "${pageId}"`, e) }),
      ),
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
  return watch(
    core,
    entity,
    () =>
      core.queryEntity(entity, spec?.()).then(
        (rows): QueryState => ({ rows, loading: false }),
        (e: unknown): QueryState => ({ rows: [], loading: false, error: failed(`"${entity}" records`, e) }),
      ),
    cb,
  );
}

/** Watch one record. */
export function watchRecord(
  core: RuntimeCore,
  entity: string,
  id: Id,
  cb: (state: RecordState) => void,
): Unsubscribe {
  return watch(
    core,
    entity,
    () =>
      core.getRecord(entity, id).then(
        (record): RecordState => ({ record, loading: false }),
        (e: unknown): RecordState => ({ record: null, loading: false, error: failed(`${entity} ${id}`, e) }),
      ),
    cb,
  );
}
