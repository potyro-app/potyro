// A fold over a whole set — an aggregate's rows, a page's figures — is app code that may read OTHER
// kinds of record with `ctx.query`: Split's balances are its expenses AND its payments. Re-running it
// only when the page's own entity changes left it stale after a write to the others ("Settle" took
// the payment, and Tom still owed you). So a fold also listens to every other entity of the app.

import { useEffect, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";

/** How long a burst of writes (a sync arriving) is gathered into one re-run. */
const GATHER_MS = 40;

/** A number that changes after any write to an entity of the app other than `own`. */
export function useWriteTick(runtime: PotyroRuntime, own: string | undefined): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((n) => n + 1);
      }, GATHER_MS);
    };
    const offs = Object.keys(runtime.definition.entities)
      .filter((e) => e !== own)
      .map((e) => runtime.core.store.subscribe(e, bump));
    return () => {
      if (timer) clearTimeout(timer);
      for (const off of offs) off();
    };
  }, [runtime, own]);
  return tick;
}
