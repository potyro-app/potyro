// App-facing runtime contracts (Runtime + ViewProps). These live in `schema` — not in the
// runtime package — because they are part of the contract app code is typed against, and
// keeping them here avoids a schema<->runtime type cycle. The runtime package *implements*
// `Runtime`; view components *consume* `ViewProps`.

import type { ReactElement } from "react";
import type { Ctx } from "./ctx.js";
import type { Id, KartaRecord, Resolved } from "./core.js";
import type { AppDefinition } from "./app.js";

/** What views consume (docs/05 "Runtime API"). Views call this — never Store/Host/Caps. */
export interface Runtime {
  definition: AppDefinition;
  /** Full host surface (trust-scoped). */
  ctx: Ctx;
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
 * What a custom (or built-in) view component receives (docs/05 "View contract"). A custom
 * view is a normal React component; it reaches the full `ctx` via `props.runtime.ctx`.
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
