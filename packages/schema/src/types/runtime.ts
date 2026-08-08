// App-facing runtime contracts (Runtime + ViewProps). These live in `schema` — not in the
// runtime package — because they are part of the contract app code is typed against, and
// keeping them here avoids a schema<->runtime type cycle. The runtime package *implements*
// `Runtime`; view components *consume* `ViewProps`.

import type { ReactElement } from "react";
import type { Ctx } from "./ctx.js";
import type { Id, KartaRecord, Resolved } from "./core.js";
import type { AppDefinition } from "./app.js";

/** Stop receiving updates. */
export type Unsubscribe = () => void;

/** What views consume (docs/05 "Runtime API"). Views call this — never Store/Host/Caps. */
export interface Runtime {
  definition: AppDefinition;
  /** Full host surface (trust-scoped). */
  ctx: Ctx;

  // ---- data access ----
  //
  // `watchQuery`/`watchRecord` are the CONTRACT: a subscription any framework can adapt. The `use*`
  // forms below are React sugar over exactly these, kept because most views are React today — but a
  // view written in something else is not shut out, which is what stops the view framework being an
  // architectural decision.
  watchQuery(
    entity: string,
    spec: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number } | undefined,
    cb: (state: { rows: Resolved[]; loading: boolean }) => void,
  ): Unsubscribe;
  watchRecord(entity: string, id: Id, cb: (state: { record: Resolved | null; loading: boolean }) => void): Unsubscribe;

  useQuery(
    entity: string,
    spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number },
  ): { rows: Resolved[]; loading: boolean };
  useRecord(entity: string, id: Id): { record: Resolved | null; loading: boolean };
  runAction(entity: string, key: string, id: Id, input?: unknown): Promise<void>;
  create(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord>;
  patch(entity: string, id: Id, data: Partial<KartaRecord>): Promise<void>;
  remove(entity: string, id: Id): Promise<void>;
  reconcileReminders(): Promise<void>;
}

/**
 * What a custom (or built-in) view component receives (docs/05 "View contract"). It reaches the full
 * `ctx` via `props.runtime.ctx`.
 */
export interface ViewProps<Opts = unknown> {
  runtime: Runtime;
  entity: string;
  /** The view's declarative bindings (functions already resolved by the runtime). */
  options: Opts;
  param?: Record<string, string>;
  navigate: (pageId: string, param?: Record<string, string>) => void;
}

/** A full custom-view React component (docs/04). */
export type CustomViewComponent = (props: ViewProps) => ReactElement;

/** The framework-neutral form: fill `el`, return a teardown. */
export type CustomViewMount = (el: HTMLElement, props: ViewProps) => () => void;
