# 04 · App Module API — `defineApp` and the `ctx` surface

This is the real API of the system. "Full control" is delivered here: app functions receive
`ctx`, and `ctx` exposes everything the host can do. Enriching Karta means enriching `ctx` —
never adding language features to a DSL (there is no DSL).

## `defineApp(def): App`

A typed builder. It (a) infers types so your `computed`/`action`/`filter` functions get fully
typed `record` and `ctx`, (b) normalizes defaults, and (c) in dev runs a Zod check over the
**declarative** parts only. It does not and must not constrain function bodies.

```ts
export default defineApp({ id, name, version, schemaVersion, permissions, entities, pages, reminders, migrations });
```

## Function signatures

```ts
type Computed<E>   = (record: Resolved<E>, ctx: Ctx) => Value | Promise<Value>;
type ActionFn<E>   = (record: Resolved<E>, ctx: Ctx, input?: unknown) => void | Promise<void>;
type FilterFn<E>   = (record: Resolved<E>, ctx: Ctx) => boolean;
type SortFn<E>     = (a: Resolved<E>, b: Resolved<E>) => number;
type BindingFn<E,T>= (record: Resolved<E>, ctx: Ctx) => T;
type ReminderWhen<E> = (record: Resolved<E>, ctx: Ctx) => Date | null;
type CustomView    = (props: ViewProps) => JSX.Element;   // full React component
```

`Resolved<E>` = the record with its `relation` fields resolved one level deep and its
`computed` values available as properties (computed are lazily evaluated + memoized when
accessed). Deeper traversal or cross-entity queries use `ctx.query`.

## `ctx` — the host API surface (complete)

```ts
interface Ctx {
  // ---- data (all reads return Resolved records) ----
  query<E>(entity: string, spec?: {
    filter?: (r: Resolved<E>) => boolean;   // JS predicate, run in-memory
    sort?:   (a: Resolved<E>, b: Resolved<E>) => number;
    limit?: number; offset?: number;
  }): Promise<Resolved<E>[]>;
  get<E>(entity: string, id: string): Promise<Resolved<E> | null>;
  create<E>(entity: string, data: Partial<E>): Promise<Resolved<E>>;
  patch<E>(entity: string, id: string, data: Partial<E>): Promise<Resolved<E>>;
  delete(entity: string, id: string): Promise<void>;
  transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>;

  // ---- time (injected once per evaluation pass for determinism) ----
  now(): Date;
  today(): Date;

  // ---- runtime inputs (view filter params, custom-view args) ----
  params: Readonly<Record<string, unknown>>;

  // ---- app-scoped key/value storage (separate from entity records) ----
  storage: { get<T>(k: string): Promise<T | null>; set(k: string, v: unknown): Promise<void>;
             delete(k: string): Promise<void>; keys(prefix?: string): Promise<string[]>; };

  // ---- native capabilities (may be denied/scoped for untrusted apps) ----
  caps: {
    camera?:        { capture(opts?: { source?: "camera"|"library" }): Promise<Blob>; };
    notifications?: { schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;
                      cancel(id: string): Promise<void>; supportsExactScheduling: boolean; };
    geo?:           { current(): Promise<{ lat: number; lng: number }>; };
    haptics?:       { vibrate(pattern?: number | number[]): Promise<void>; };  // non-sensitive
    filesystem?:    { pick(): Promise<Blob>; save(name: string, data: Blob): Promise<void>; };
    network?:       { fetch(input: string, init?: RequestInit): Promise<Response>; };  // gated
  };

  // ---- media helpers ----
  media: { put(bytes: Blob): Promise<MediaRef>; url(ref: MediaRef): Promise<string>; };

  // ---- UI affordances provided by the shell ----
  ui: { toast(msg: string): void;
        confirm(msg: string): Promise<boolean>;
        prompt(msg: string, opts?: { default?: string }): Promise<string | null>;
        pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>; };

  // ---- navigation (in view/action contexts) ----
  navigate(pageId: string, params?: Record<string, string>): void;

  // ---- diagnostics ----
  log(...args: unknown[]): void;
}
```

### How `ctx` differs by trust

`ctx` is constructed by the **host** (docs/07). Its data/time/storage/ui/nav members are always
present. Its `caps` members are:

- **Trusted app (your own):** all real, unmediated. `ctx.caps.network.fetch` hits the network,
  `filesystem` is the real FS, etc. No prompts.
- **Untrusted app (shared/imported):** each cap in the app's `permissions` manifest is either
  denied (member is `undefined`) or granted after a **one-time user consent prompt**, and when
  granted is a **mediated** wrapper (e.g. `network` may be domain-scoped, `filesystem` limited
  to an app-private area). App code sees the same interface; the authority behind it differs.

This is the entire safety model. The language is full JS; `caps` is where power is governed.

## `ViewProps` (what a custom view receives)

```ts
interface ViewProps {
  runtime: Runtime;                 // useQuery/useRecord/runAction + ctx access
  entity: string;
  param: Record<string, string>;    // e.g. { recipeId }
  navigate: (pageId: string, params?: Record<string, string>) => void;
}
```

A custom view is a normal React component. It can call `props.runtime.ctx` for the full `ctx`,
render anything, keep local state, and use hooks. There is no ceiling — if a screen needs
bespoke logic, it's just a component.

## Design rules for `ctx`

- **Everything the host can do reaches app code only through `ctx`.** No app function imports
  `Store`/`Capabilities` directly.
- **`ctx` members are stable, minimal, and composable.** Add a member only when app code
  genuinely needs a host power it can't compose from existing members.
- **Async by default** for anything touching storage/caps; the runtime awaits.
- **Deterministic time**: `now()` is fixed per evaluation pass so computed values are stable
  within a render.

## The Edit-mode boundary (what an AI edit can and cannot reach)

"Fix with AI" rewrites the app module and nothing else. So a complaint about how a **built-in view
behaves** — when it loads, how it frames itself, what it does between renders — is not the app's to
fix, no matter how the request is phrased.

That has to be sayable. If the only legal reply to an edit request is updated source, an
unreachable request comes back as a confident change to whichever function looked closest; the
comment it writes to justify itself becomes the *input* to the next attempt, and one wrong guess
survives round after round.

So the contract (`buildModifyMessage` / `parseModifyReply` in `packages/generator`) has two legal
replies:

1. **Updated source**, in one ```ts block — the request was reachable.
2. **`NOT-IN-APP: <what host behaviour is responsible, and what would have to change there>`** — it
   was not. No code.

Supporting this:

- The prompt carries the **declarable surface of the view the user pointed at**, taken from
  `VIEW_FIELDS` (derived from the Zod schemas, so it cannot drift from what is enforced).
- The prompt carries **what was already tried** on this app and **what was already diagnosed**, so a
  repeated complaint escalates instead of producing a third rewrite of the same function.
- **Reasoning goes in the version's `rationale`, not in source comments.** A causal claim in a
  comment is unverifiable and is read as fact by the next edit.
- A diagnosis records **no version** (nothing changed) and is stored separately
  (`app-diagnoses.ts`), shown in the History panel and fed back into later prompts.

A diagnosis is also the best backlog signal there is: it names something an app wanted to express
and could not. Per CLAUDE.md, the answer to a real gap is a wider declarative surface or a cleaner
`ctx` — not a permanent "no". `map`'s `camera` field exists because of exactly such a gap.

## Direct structural edits (no model in the loop)

A label, a field's order, whether a field appears in the form, a page's name — these are
**declarative data**, so they need no intelligence, and routing them through the agent is where the
cost/risk is worst: a minute of waiting and a whole-file rewrite to change six characters.

`app-source.ts` edits them directly. The load-bearing decision:

> **Parse for positions; splice text; never reprint.**

Parse-mutate-print reformats the whole file and mangles comments. The source here is versioned and
diffed, so a label change that reflows 300 lines makes History useless. `@babel/parser` is used
*only* to find byte ranges and `magic-string` splices them, so everything outside the edited range is
byte-identical by construction rather than by a printer's best effort. Both are lazy-loaded (~85 kB
gz together), like MapLibre.

The panel's controls are rendered from what `inspect()` could actually **locate**, never from the
schema — so a control exists only when there is a real byte range behind it, and the panel cannot
offer a change it is unable to make. An app that builds its fields from a helper, a spread, or a
computed key has no literal to edit; `inspect` says so, naming the reason, and the change routes to
the agent instead. Same honesty as the `NOT-IN-APP` boundary above.

Two hazards worth knowing about:

- **`hidden` is not "remove".** It only affects the create/edit form. A field still named in a view's
  `display` or a detail `section` keeps showing there, so the control says "hide from the form".
- **Reordering can rename your records.** `displayFieldFor` falls back to the *first* field, so
  moving a field to the top would silently change what every list row and relation picker shows.
  The editor pins `displayField` explicitly before a reorder that would change it.

Direct edits are still validated and still written to history — as `adjusted` rather than `edited`,
because reviewing a whole-file agent rewrite and reviewing a one-line structural change are very
different jobs.
