// Host seam (docs/05 "Host") — loading + execution + trust. The host turns an app module into
// something the runtime can call, choosing the runner by provenance (direct for trusted,
// QuickJS-WASM isolate for untrusted) and building the mediated `ctx`.

import type {
  AppDefinition,
  Ctx,
  CustomViewComponent,
  CustomViewMount,
  Id,
  PotyroApp,
  PermissionManifest,
  Person,
  Space,
  Resolved,
  Value,
  Field,
  Language,
  Localized,
  UiItem,
  UiProgress,
  ViewProps,
} from "potyro";
import type { Capabilities } from "@potyro/capabilities";
import type { Store } from "@potyro/store";

export type Provenance = "trusted" | "untrusted";

/** Where an app came from. Determines the runner (docs/07). */
export type AppSource =
  /** An already-imported module (trusted dev path: Vite imports the `.app.ts`). */
  | { kind: "module"; app: PotyroApp; provenance?: Provenance }
  /** A self-contained bundled JS string (untrusted-by-default: shared/imported). */
  | { kind: "bundle"; code: string; provenance?: Provenance }
  /** A URL to fetch a bundle from (untrusted-by-default). */
  | { kind: "url"; url: string; provenance?: Provenance };

/** Identifies a function *binding* so untrusted calls can be marshalled by reference. */
export type BindingRef =
  | { kind: "view"; page: string; path: "display.primary" | "display.secondary" | "display.icon" | "date" | "title" | "color" | "text" | "detail" | "group" | "geo" | "icon" }
  | { kind: "reminder"; id: string; path: "title" | "body" };

/** A `UiItem` with its words already in the person's language — what the shell renders. */
export type ShownUiItem<T> = Omit<UiItem<T>, "label" | "detail"> & { label: string; detail?: string };

/**
 * What the shell provides to build `ctx.ui`. Every string here is already in the language the app
 * is shown in: `ctx` resolves an app's `Words` before the shell sees them (#302).
 */
export interface UiBridge {
  toast(msg: string): void;
  confirm(msg: string, opts?: { detail?: string; ok?: string; cancel?: string; destructive?: boolean }): Promise<boolean>;
  /** `detail`, `ok`, `cancel`, `placeholder`: the shell's own questions (a home device's address, docs/28); an app's prompt passes `default` only. */
  prompt(msg: string, opts?: { default?: string; detail?: string; ok?: string; cancel?: string; placeholder?: string }): Promise<string | null>;
  pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>;
  // #112. Optional so a headless bridge (validation, tests) need not render anything: `ctx` answers
  // a missing one as dismissed (`null`) and a missing progress as a bar nobody sees.
  sheet?<T>(opts: { title?: string; items: ShownUiItem<T>[] }): Promise<T | null>;
  menu?<T>(opts: { title?: string; items: ShownUiItem<T>[] }): Promise<T | null>;
  form?(opts: { title: string; fields: Record<string, Localized<Field>>; initial?: Record<string, unknown>; submit?: string }): Promise<Record<string, unknown> | null>;
  progress?(label: string): UiProgress;
  /**
   * `ctx.ui.share`: a headless bridge leaves it out, and `ctx` answers it as not shared (`false`).
   * With `app`, the shell makes the link to this app's page itself (docs/24 §11).
   */
  share?(opts: ShownShare): Promise<boolean>;
}

/** What `ctx.ui.share` hands the shell, checked (`checkShare`, `checkShareFiles`): words in the app's language, an http(s) `url` or an `app` link, and files. */
export interface ShownShare {
  text?: string;
  url?: string;
  title?: string;
  /** A link to this app: one of its pages, with the params that page declares (`link.params`). */
  app?: { page: string; params: Record<string, string> };
  /** Files, resolved from the app's own store and named (at most 10, 25 MB together). */
  files?: File[];
}

/** What the shell provides to build `ctx.navigate`. */
export interface NavBridge {
  navigate(pageId: string, params?: Record<string, string>): void;
}

/**
 * What the shell provides to build `ctx.views` — a way to reach a view that is mounted right now.
 *
 * One verb-and-payload call rather than a method per control: the views that can be driven will grow
 * (a list's scroll position, a form's focus), and each one should be a case in the view's own
 * handler, not another function threaded through the host, the isolate harness and its op table.
 *
 * `false` means nobody was listening — that page's view is not on screen — which is an answer, not
 * an error. Optional so a headless bridge (validation, tests) need not stand up any views.
 */
export interface ViewBridge {
  call?(pageId: string, verb: string, arg?: unknown): Promise<boolean>;
}

/** Inputs to build a `ctx` (docs/02 composition root). */
export interface MakeCtxBase {
  store: Store;
  caps: Capabilities;
  ui: UiBridge;
  nav: NavBridge;
  views?: ViewBridge;
  params?: Record<string, unknown>;
  /** Fixed evaluation time; defaults to now. Injected once so computed values are stable. */
  now?: Date;
  /**
   * Who this device is (KA-18). Supplied by the composition root from `@potyro/identity`.
   *
   * Defaulted rather than required so a `MemoryStore` test or a fake host need not stand up an
   * identity to build a `ctx` — `ctx.me` is always *present*, which is the contract app code
   * depends on, and the composition root is what makes it the real person.
   */
  me?: Person;
  /** The space this app's data lives in, when it is synced. Absent = solo (ADR D3). */
  space?: Space;
  /** The app-wide selected record(s) by entity (`ctx.scope`, see `ScopeDef`). Absent = `{}`. */
  scope?: Record<string, Resolved | undefined>;
  /**
   * The language the app's words are shown in (#302): `pickLanguage(person's languages, app)`, from
   * the runtime. Absent for an app that declares no language; `ctx.locale` is then the person's.
   */
  language?: Language;
  /** The BCP 47 tag `ctx.format` formats in (`formatLocaleFor`). Absent = the words' language, or "en". */
  formatLocale?: string;
}

/**
 * A loaded app: its declarative definition + provenance + permissions, plus the ability to
 * invoke its functions in the correct runner (direct or isolate).
 */
export interface LoadedApp {
  definition: AppDefinition;
  provenance: Provenance;
  permissions: PermissionManifest;

  callComputed(entity: string, key: string, record: Resolved, ctx: Ctx): Promise<Value>;
  callAction(entity: string, key: string, record: Resolved, ctx: Ctx, input?: unknown): Promise<void>;
  callFilter(pageId: string, record: Resolved, ctx: Ctx): Promise<boolean>;
  callSort(pageId: string, a: Resolved, b: Resolved, ctx: Ctx): Promise<number>;
  callBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value>;
  /**
   * Resolve a `Dynamic<T>` view option (`camera`, `emptyText`, an aggregate's `title`): the literal
   * as declared, or the function called with `ctx`. Through the host for the same reason
   * `callBinding` is — for an untrusted app the function never leaves the isolate. `null` when the
   * option is absent.
   */
  callViewOption(pageId: string, key: string, ctx: Ctx): Promise<Value>;
  /** The same for a PAGE's own options (`title`). */
  callPageOption(pageId: string, key: string, ctx: Ctx): Promise<Value>;
  /**
   * Run a page's button (`Page.actions[index].run`).
   *
   * By index, because the function is the declaration — there is no key to name it by — and through
   * the host for the reason every app function goes through the host: an untrusted app's `run`
   * never leaves the isolate.
   */
  callPageAction(pageId: string, index: number, ctx: Ctx): Promise<void>;
  /**
   * Compute a page summary figure's `value` function over the page's filtered rows.
   *
   * Aggregates are the one shape that cannot be a per-record binding, so this is the only call that
   * takes the whole row set. It exists as a host call for the same reason `callBinding` does: for an
   * untrusted app the function never leaves the isolate, so the shell cannot invoke it directly —
   * its definition carries the `__potyro_fn__` sentinel where the function was. Routing both
   * provenances through here keeps trust out of the shell's arithmetic.
   */
  callSummary(pageId: string, index: number, rows: Resolved[], ctx: Ctx): Promise<Value>;
  /**
   * Fold a page's rows into display-ready aggregate rows (KA-24).
   *
   * Goes through the host for the same reason `callSummary` does: for an untrusted app the
   * definition carries a sentinel string where the function should be, so calling it in the shell
   * process throws. Routing it here is what lets a shared app render its own main screen.
   */
  callAggregate(pageId: string, rows: Resolved[], ctx: Ctx): Promise<Value>;
  /**
   * Call a function inside a page's view over the page's rows (#109): `path` names it from the view —
   * `"series"` of a chart, `"items.2.value"` or `"items.2.compare.value"` of a stats view. The same
   * one-payload call as `callAggregate`, generalised so a new fold-shaped option needs no new call.
   */
  callFold(pageId: string, path: string, rows: Resolved[], ctx: Ctx): Promise<Value>;
  /** A field's `default` when it is a function of ctx (KA-25), evaluated where the function lives. */
  callFieldDefault(entity: string, field: string, ctx: Ctx): Promise<Value>;
  /**
   * The app's live launcher tile (`AppDefinition.tile`, docs/04 §Tile): what it returns, as plain data,
   * or `null` when it declares none. Through the host like every app function: a sealed app's tile
   * runs in its box and only the data comes out. The shell checks the shape (`checkTileContent`).
   */
  callTile(ctx: Ctx): Promise<Value>;
  reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null>;
  /** Trusted apps only (docs/05 policy); untrusted returns null and falls back to built-ins. */
  customView(pageId: string): CustomViewComponent | null;
  /** The `mount` form of a custom view, when the app declared one instead of `render`. */
  customViewMount?(pageId: string): CustomViewMount | null;
  /**
   * A sealed app's custom view, drawn in its own sandboxed frame (#267, docs/05 "Custom views"):
   * present on the browser realm's apps when the page's view is custom, `null` otherwise. The view's
   * code runs in that frame, never in the shell's realm; what it asks of `ctx` goes through the same
   * mediated ctx as the app's logic.
   */
  sealedView?(pageRef: string): SealedView | null;

  dispose(): void;
}

/** Why a sealed view was taken down: it stopped answering, or it blocked the page's own thread. */
export interface SealedViewStop {
  reason: string;
}

export interface SealedViewEvents {
  /** The watchdog took the view down. The shell shows the app's plain version and a calm notice. */
  onStopped(stop: SealedViewStop): void;
  /** The view's code could not be mounted (it threw): a contained failure of that part (#271). */
  onFailed?(message: string): void;
  /** The view's `mount` returned, or its first render did. */
  onMounted?(): void;
}

/** One custom view of a sealed app, as the views see it (views/src/custom.tsx). */
export interface SealedView {
  /**
   * `"off"` when its screens froze or stopped answering on this device before — a tab that died with
   * one mounting, or the watchdog — so they are not mounted again until the person asks
   * (`retry`). An endless loop can freeze Potyro at most once per app.
   */
  state(): "ready" | "off";
  /** The person chose "Try its screen again". */
  retry(): void;
  /** Mount it into `el`, a place the shell sizes; `label` is the frame's accessible name (the page's title). Returns the teardown. */
  mount(el: HTMLElement, props: ViewProps, events: SealedViewEvents, label?: string): () => void;
}

export interface Host {
  load(source: AppSource): Promise<LoadedApp>;
  makeCtx(app: LoadedApp, base: MakeCtxBase): Ctx;
  /** Promote an untrusted app to trusted (explicit user action; docs/07). */
  promote(appId: string): Promise<void>;
}

export type { Id };
