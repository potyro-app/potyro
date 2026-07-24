# 02 · Architecture

## Layered view

```
┌───────────────────────────────────────────────────────────────────┐
│  TARGET (build)   PWA build · Capacitor build — share one runtime   │
└───────────────▲───────────────────────────▲───────────────────────┘
        WebCapabilities              CapacitorCapabilities
                │                            │
┌───────────────┴────────────────────────────┴──────────────────────┐
│  SHELL (packages/shell)                                             │
│   app switcher · nav · import/export · TRUST PROMPTS · settings     │
└───────────────▲────────────────────────────────────────────────────┘
                │ renders pages via
┌───────────────┴────────────────────────────────────────────────────┐
│  VIEWS (packages/views)  list·table·detail·calendar·map·steps·CUSTOM│
│   consume Runtime API only; custom views delegate to app components  │
└───────────────▲────────────────────────────────────────────────────┘
                │ read/subscribe/act (Resolved records, computed done)
┌───────────────┴────────────────────────────────────────────────────┐
│  RUNTIME CORE (packages/runtime)                                    │
│   record model · relation resolution · computed runner · action     │
│   runner · reminder reconciler · JS-predicate query · ctx wiring    │
└──────▲───────────────▲───────────────────────▲─────────────────────┘
       │ Store iface    │ Host (load/run/trust) │ Capabilities iface
┌──────┴──────┐ ┌───────┴────────────┐  ┌───────┴──────────┐
│ STORE       │ │ HOST               │  │ CAPABILITIES     │
│ SqliteStore │ │ loader + bundler   │  │ web / capacitor  │
│ Memory      │ │ QuickJS-WASM isolate│ │ camera/notif/geo │
│ (CRDT later)│ │ ctx build + trust  │  │ /fs/network      │
└─────────────┘ └────────────────────┘  └──────────────────┘
        ▲                 ▲ runs app functions (direct or isolated)
   SCHEMA (packages/schema): defineApp() typing + Zod over declarative parts
        ▲
   APP MODULE (*.app.ts): declarative shape + TS logic functions
```

## What changed from a data-format design

There is **no expression DSL and no query planner**. The app is code; the **Host** runs that
code (directly for trusted apps, in a QuickJS-WASM isolate for untrusted ones) and hands it
`ctx`. Filtering/sorting are JS functions the runtime applies to in-memory rows — at
personal scale this is simpler and removes the old pushdown/residual complexity entirely.

## Read path

1. Shell mounts a **page** → names an entity + view + (declarative or functional) filter/sort.
2. Runtime asks `Store.all(entity)`, resolves relations, and evaluates the view's `filter`/
   `sort` **as JS** over the set (via `Host` for trusted-direct or isolate-marshalled calls).
3. Runtime resolves referenced `computed` values (via `Host.callComputed`, memoized).
4. Resolved rows → view component (built-in) or the app's custom React component.
5. `Store.subscribe(entity)` re-runs the JS query on change.

## Write / action path

1. A view invokes an **action** → `Runtime.runAction` → `Host.callAction(record, ctx)`.
2. The action function does its work through `ctx` (patch/create/caps/ui). For untrusted apps
   the call executes in the isolate and every `ctx.caps` touch is mediated.
3. Reminder reconciler recomputes affected `reminder.when(record, ctx)` and schedules via
   `ctx.caps.notifications` where available.

## Module boundaries (enforced)

- `views` imports only the Runtime API + schema types. Never Store/Host/Capabilities.
- `runtime` imports **interfaces** of Store/Host/Capabilities — never concrete impls.
- App functions reach host power **only** through `ctx`. They never import host internals.
- Concrete Store/Capabilities/Host wiring happens once at the target composition root.

## Composition root

```ts
const caps  = isNative ? new CapacitorCapabilities() : new WebCapabilities();
const store = await SqliteStore.open(appId);
const host  = createHost({ quickjs });                 // provides direct + isolate runners
const app   = await host.load(appSource);              // tags provenance, reads permissions
const ctx   = host.makeCtx(app, { store, caps, ui, nav });
const runtime = createRuntime({ app, host, store, ctx });
mountShell(runtime);
```

Swap to a CRDT store, or from web to native, by changing this root only. Promote an untrusted
app to trusted here too (re-`load` with elevated provenance).

## Why these boundaries

- **Full control:** app logic is unrestricted TS reaching everything via `ctx`.
- **Safety:** untrusted code is boxed in QuickJS-WASM with mediated caps; trusted code isn't
  taxed.
- **Testability:** runtime/views test against `MemoryStore` + `FakeCapabilities` + a
  `DirectHost` that runs functions in-process.
- **Evolvability:** CRDT/sync is a new Store; native is a new Capabilities + the same isolate.
