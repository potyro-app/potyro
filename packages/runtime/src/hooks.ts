// React adapters over the framework-free watchers in `watch.ts`.
//
// These used to BE the data layer — three near-identical copies of "query, subscribe, re-query". The
// logic now lives in `watch.ts`, which any framework can consume; this file is the React binding and
// nothing more. That is the point: `useQuery`/`useRecord` remain available as convenience, but the
// contract app code is typed against is `watchQuery`/`watchRecord`, so a view written in something
// other than React is not shut out.

import { useEffect, useRef, useState } from "react";
import type { Id, Resolved } from "potyro";
import type { RuntimeCore } from "./core.js";
import { watchEntityQuery, watchPageQuery, watchRecord, type QueryState, type RecordState } from "./watch.js";

export type { QueryState, RecordState };

export function usePageQuery(core: RuntimeCore, pageId: string, params?: Record<string, unknown>): QueryState {
  const [state, setState] = useState<QueryState>({ rows: [], loading: true });
  // Params are read at query time rather than baked into the subscription, so a params change
  // re-queries without tearing down and rebuilding the store subscription.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const paramsKey = JSON.stringify(params ?? null);

  useEffect(() => {
    return watchPageQuery(core, pageId, () => paramsRef.current, setState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, pageId, paramsKey]);

  return state;
}

export function useEntityQuery(
  core: RuntimeCore,
  entity: string,
  spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number },
): QueryState {
  const [state, setState] = useState<QueryState>({ rows: [], loading: true });
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    return watchEntityQuery(core, entity, () => specRef.current, setState);
  }, [core, entity]);

  return state;
}

export function useRecord(core: RuntimeCore, entity: string, id: Id): RecordState {
  const [state, setState] = useState<RecordState>({ record: null, loading: true });

  useEffect(() => {
    return watchRecord(core, entity, id, setState);
  }, [core, entity, id]);

  return state;
}
