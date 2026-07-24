// React hooks over RuntimeCore. Each subscribes to the relevant entity so the JS query re-runs
// on any write (docs/02 read path step 5). Params/spec changes also re-run.

import { useEffect, useRef, useState } from "react";
import type { Id, Resolved } from "karta";
import type { RuntimeCore } from "./core.js";

export interface QueryState {
  rows: Resolved[];
  loading: boolean;
}

export interface RecordState {
  record: Resolved | null;
  loading: boolean;
}

export function usePageQuery(core: RuntimeCore, pageId: string, params?: Record<string, unknown>): QueryState {
  const [state, setState] = useState<QueryState>({ rows: [], loading: true });
  const paramsKey = JSON.stringify(params ?? null);

  useEffect(() => {
    let alive = true;
    const run = (): void => {
      void core.queryPage(pageId, params).then(({ rows }) => {
        if (alive) setState({ rows, loading: false });
      });
    };
    run();
    const unsub = core.store.subscribe(core.entityForPage(pageId), run);
    return () => {
      alive = false;
      unsub();
    };
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
    let alive = true;
    const run = (): void => {
      void core.queryEntity(entity, specRef.current).then((rows) => {
        if (alive) setState({ rows, loading: false });
      });
    };
    run();
    const unsub = core.store.subscribe(entity, run);
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, entity]);

  return state;
}

export function useRecord(core: RuntimeCore, entity: string, id: Id): RecordState {
  const [state, setState] = useState<RecordState>({ record: null, loading: true });

  useEffect(() => {
    let alive = true;
    const run = (): void => {
      void core.getRecord(entity, id).then((record) => {
        if (alive) setState({ record, loading: false });
      });
    };
    run();
    const unsub = core.store.subscribe(entity, run);
    return () => {
      alive = false;
      unsub();
    };
  }, [core, entity, id]);

  return state;
}
