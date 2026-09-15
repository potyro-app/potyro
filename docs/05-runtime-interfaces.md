# 05 · Runtime Interfaces (TypeScript contracts)

The seams. `Store` and `Capabilities` are exactly what `ctx` (docs/04) surfaces to app code.
The `Host` is new: it owns loading + execution + trust. Changing any of these is a
cross-cutting event (see CLAUDE.md).

## Shared value types

```ts
export type Id = string;                       // ULID
export type Value = string | number | boolean | Date | null | Value[] | { [k: string]: Value };
export interface Record { id: Id; createdAt: string; updatedAt: string; [field: string]: unknown; }
export interface Resolved extends Record { /* relations resolved 1-level; computed accessible */ }
export interface MediaRef { key: string; mime: string; w?: number; h?: number; }
export interface Geo { lat: number; lng: number; label?: string; }
```

## Store (packages/store)

Persistence seam. `SqliteStore` (OPFS + JSON1) is primary; `MemoryStore` for tests; CRDT-backed
later. **Filtering/sorting is done by the runtime in JS over fetched rows** (personal scale) —
so the Store's query surface is deliberately simple: fetch by entity with optional cheap
indexable narrowing, not an expression engine.

```ts
export interface Store {
  open(appId: string): Promise<void>;
  close(): Promise<void>;

  // reads — return raw records; runtime resolves relations + computed + JS filters
  all(entity: string, narrow?: { ids?: Id[]; limit?: number; offset?: number }): Promise<Record[]>;
  get(entity: string, id: Id): Promise<Record | null>;

  // optional indexable fast-path (later optimization; default impl may ignore)
  byIndex?(entity: string, field: string, value: Value): Promise<Record[]>;

  // writes
  insert(entity: string, data: Partial<Record>): Promise<Record>;
  update(entity: string, id: Id, patch: Partial<Record>): Promise<Record>;
  delete(entity: string, id: Id): Promise<void>;
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // reactivity — notify on entity change; runtime re-runs JS queries
  subscribe(entity: string, cb: () => void): Unsubscribe;

  // blobs (media), kv (ctx.storage), migration support
  putBlob(b: Blob): Promise<MediaRef>;  getBlob(r: MediaRef): Promise<Blob | null>;
  kvGet(k: string): Promise<string | null>;  kvSet(k: string, v: string): Promise<void>;  kvDelete(k: string): Promise<void>;
  subscribeKv?(cb: () => void): Unsubscribe;  // synced stores: a peer changed kv (KA-22 live version gate)
  // what the app declared: field types (KA-38 set merge) and who may edit what (KA-21 creatorOnly,
  // enforced by a synced store from its signed log — another member's edit to such a row does not take)
  describe?(schema: StoreSchema, rules?: { creatorOnly?: readonly string[] }): void;
  storedSchemaVersion(): Promise<number>;  runMigrations(plan: MigrationPlan): Promise<void>;
}
export type Unsubscribe = () => void;
```

Note the big simplification vs earlier drafts: **no `QuerySpec` with a `where` string, no
SQL-pushdown/residual planner.** Queries are JS predicates the runtime applies after `all()`.
The optional `byIndex` exists only as a future fast-path for hot fields; correctness never
depends on it. A CRDT `Store` implements the same interface; `subscribe` becomes its live feed.

## Capabilities (packages/capabilities)

Native-feature seam; backs `ctx.caps`. Each may be `null` when a target lacks it (runtime
degrades) or when an untrusted app wasn't granted it (host omits it — see Host below).

```ts
export interface Capabilities {
  camera: CameraCap | null;
  notifications: NotificationCap | null;
  geolocation: GeoCap | null;
  haptics: HapticsCap | null;              // vibration; null where unsupported
  filesystem: FileCap;                     // always present
  network: NetworkCap;                     // always present at platform level; gated per app by host
}
export interface CameraCap { capture(o?: { source?: "camera"|"library" }): Promise<Blob>; }
export interface NotificationCap {
  schedule(n: { id: string; at: string; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>; list(): Promise<{ id: string; at: string }[]>;
  supportsExactScheduling: boolean;
}
export interface GeoCap { current(): Promise<Geo>; }
export interface FileCap { pick(): Promise<Blob>; save(name: string, data: Blob): Promise<void>; }
export interface NetworkCap { fetch(input: string, init?: RequestInit): Promise<Response>; }
export interface HapticsCap { vibrate(pattern?: number | number[]): Promise<void>; }  // Web Vibration-style
```

Implementations: `WebCapabilities`, `CapacitorCapabilities`, `FakeCapabilities` (tests).

## Host (packages/host) — loading, execution, trust  **[central, new]**

Turns an app module into something the runtime can call, choosing the runner by provenance and
building the mediated `ctx`.

```ts
export type Provenance = "trusted" | "untrusted";

export interface LoadedApp {
  definition: AppDefinition;               // the declarative parts (entities/pages/…)
  provenance: Provenance;
  permissions: PermissionManifest;
  // invoke app-provided functions, in the correct runner (direct or isolate):
  callComputed(entity: string, key: string, record: Resolved, ctx: Ctx): Promise<Value>;
  callAction(entity: string, key: string, record: Resolved, ctx: Ctx, input?: unknown): Promise<void>;
  callFilter(viewId: string, record: Resolved, ctx: Ctx): Promise<boolean>;
  callBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value>;
  // Page summary aggregates (docs/03 `Page.summary`). The only call taking the whole row set:
  // `computed` is per-record, so a figure over the WHOLE set cannot be a per-record binding.
  // It is a host call because for an untrusted app the function never leaves the isolate —
  // the extracted definition carries the `__karta_fn__` sentinel where the function was.
  callSummary(pageId: string, index: number, rows: Resolved[], ctx: Ctx): Promise<Value>;
  // A function inside a page's view, over its rows, named by path (#109): "series" of a chart,
  // "items.2.value" / "items.2.compare.value" of a stats view. Own keys and indexes only.
  callFold(pageId: string, path: string, rows: Resolved[], ctx: Ctx): Promise<Value>;
  // A field's `default` when it is a function of ctx (KA-25) — evaluated where the function lives,
  // since an untrusted app's definition holds only the sentinel string where it was.
  callFieldDefault(entity: string, field: string, ctx: Ctx): Promise<Value>;
  reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null>;
  customView(viewId: string): CustomViewComponent | null;   // trusted only; see note
  dispose(): void;
}

export interface Host {
  load(source: AppSource): Promise<LoadedApp>;               // AppSource = module ref | bundle text | url
  // builds the ctx handed to app fns, applying trust mediation to caps:
  makeCtx(app: LoadedApp, base: { store: Store; caps: Capabilities; ui: UiBridge; nav: NavBridge; params?: Record<string, unknown> }): Ctx;
  promote(appId: string): Promise<void>;                     // untrusted → trusted (user action)
}
```

Runner behavior:
- **trusted** → module is imported directly; `call*` invoke the real functions; `customView`
  returns the real React component; `ctx.caps` are unmediated.
- **untrusted** → module bundle runs in a QuickJS-WASM isolate; `call*` marshal
  record+params in and a serialized value out under memory/time limits; `ctx.caps` are the
  mediated wrappers for granted permissions only.

Custom views from **untrusted** apps: rendering arbitrary DOM from untrusted code is a bigger
surface than pure functions. Policy — **custom views run only for trusted apps**; an untrusted app
falls back to its built-in views. This keeps the untrusted path to value-returning functions, which
the isolate marshals safely.

**That policy used to make shared apps useless, and no longer does (KA-24).** A shared app's main
screen is typically an *aggregate* — "who owes whom", "what's still to buy" — and `computed` is
per-record, so aggregates had no declarative home and had to be custom views. A friend's app
therefore arrived untrusted (correctly) and rendered its whole point as a blank rectangle, whose only
remedy was promoting a stranger's code to ambient authority: the capitulation the isolate exists to
prevent.

The **`aggregate` view type** closes that. Its `rows(rows, ctx)` fold is ordinary TypeScript — the
arithmetic is not restricted in any way — but it RETURNS DATA, so it crosses the isolate bridge
exactly as `computed`/`filter`/`sort`/`binding`/`summary` already do, and the screen renders
identically at both provenances. Only the *rendering* is declarative, never the thinking.

This was chosen over DOM-sandboxing on the evidence of the bridge itself: it is a single
string-in/string-out JSON function, so value-returning functions cross natively while a React
component would need a serializable-VDOM plus an event-callback protocol that does not exist.
A DOM-sandboxing strategy remains the long-term answer for genuinely bespoke UI — it is no longer
load-bearing for sharing.

## Runtime API (packages/runtime) — what views consume

```ts
export interface Runtime {
  definition: AppDefinition;
  ctx: Ctx;                                              // full host surface (trust-scoped)
  useQuery(entity: string, spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number }):
    { rows: Resolved[]; loading: boolean };
  useRecord(entity: string, id: Id): { record: Resolved | null; loading: boolean };
  runAction(entity: string, key: string, id: Id, input?: unknown): Promise<void>;
  create(entity: string, data: Partial<Record>): Promise<Record>;
  patch(entity: string, id: Id, data: Partial<Record>): Promise<void>;
  remove(entity: string, id: Id): Promise<void>;
  reconcileReminders(): Promise<void>;
}
```

Views call this; never Store/Capabilities/Host directly. Computed values on `Resolved` are
produced by the runtime via `host.callComputed` and memoized per query pass.

## View contract (packages/views)

```ts
export interface ViewProps<Opts = unknown> {
  runtime: Runtime;
  entity: string;
  options: Opts;                          // the view's declarative bindings (functions resolved by runtime)
  param?: Record<string, string>;
  navigate: (pageId: string, param?: Record<string, string>) => void;
}
export type ViewComponent = React.FC<ViewProps>;
export interface ViewRegistration { type: string; component: ViewComponent; requires?: FieldConstraint; }
```

The `custom` view type is registered like any other; its component simply delegates to the
app-provided `customView` (trusted apps only, per Host policy).
