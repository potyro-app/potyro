import { actionInfo, actionInputProblem, appLanguages, FieldValueError, isWordsMap, localize, pickLanguage, resolveView, VIEW_WORDS, word } from "potyro";
// RuntimeCore — the framework-agnostic engine (docs/05 "Runtime"). It owns the read path
// (resolve via ctx → JS filter via host → JS sort via host), the write/action path, reminder
// reconciliation, and binding resolution. React hooks (hooks.ts) wrap this. Everything goes
// through the Host so trusted (direct) and untrusted (isolate) execution are uniform.

import type { AppDefinition, Ctx, Id, Language, Localized, PotyroRecord, Person, Resolved, Space, Value, View } from "potyro";
import type { BindingRef, Host, LoadedApp, MakeCtxBase, NavBridge, UiBridge } from "@potyro/host";
import { formatLocaleFor, GuestBook } from "@potyro/host";
import type { Capabilities } from "@potyro/capabilities";
import type { Store } from "@potyro/store";
import { asyncSort } from "./async-sort.js";

/** Sentinel a bundler/isolate loader uses to mark a function-valued binding it can't serialize. */
export const FN_SENTINEL = "__potyro_fn__";

/** kv key holding the set of currently-scheduled reminder notification ids (for idempotent reconcile). */
const REMINDER_KV_KEY = "reminders.scheduled";

export interface RuntimeDeps {
  app: LoadedApp;
  host: Host;
  store: Store;
  caps: Capabilities;
  ui: UiBridge;
  nav: NavBridge;
  /** Fixed evaluation time (tests); omit for real now(). */
  now?: Date;
  /**
   * Who this device is, and the space this app's data lives in (KA-18).
   *
   * Both optional here: the runtime does not *own* identity, it carries it from the composition
   * root to `ctx`. Omitted, the host supplies a local stand-in, so a `MemoryStore` test still gets
   * a `ctx.me` without minting an account.
   */
  me?: Person;
  /**
   * The space, or a function returning it.
   *
   * A plain value is a SNAPSHOT: `ctx` is rebuilt for every evaluation pass, but a captured `space`
   * is not, so an app opened before someone joined listed only the people who were there then —
   * forever, until reload. Passing a function lets each pass read the current membership. Both forms
   * are accepted because tests and fakes have nothing to keep fresh.
   */
  space?: Space | (() => Space | undefined);
  /** The initial app-wide selection (`ctx.scope`), by entity. Changed later through `setScope`. */
  scope?: Record<string, Resolved | undefined>;
  /**
   * The person's languages, in order (#302): their explicit choice alone, or the device's list
   * (`navigator.languages`). The app is shown in the first one it carries (`pickLanguage`), and
   * dates and numbers are formatted in the first one's region when it is that language. Changed
   * later through `setLanguages`. Absent = English.
   */
  languages?: readonly string[];
}

/** Which of the app's languages it is shown in (docs/05 `Runtime.language`). */
export interface RuntimeLanguage {
  current: Language | undefined;
  default: Language | undefined;
  available: Language[];
}

/** A page ref may name a layout item (`today#1`, #105); `resolveView` knows the difference. */
const viewOf = (def: Localized<AppDefinition>, pageRef: string): Localized<View> => resolveView(def, pageRef) as Localized<View>;

/** The ctx calls that write: each one is tracked until it lands, so leaving can wait for it. */
const WRITES = new Set<PropertyKey>(["create", "patch", "delete", "increment", "transaction"]);

/**
 * The longest `settle` waits. Long enough for any write a person makes — a worker round trip is well
 * under a millisecond — and short enough that one that never returns cannot hold the app open.
 */
const SETTLE_LIMIT_MS = 5_000;

export class RuntimeCore {
  /** Writes started and not yet landed (or failed). */
  private readonly inFlight = new Set<Promise<unknown>>();
  /** Set by `close()`: the app is being put away. */
  closed = false;
  readonly app: LoadedApp;
  readonly host: Host;
  readonly store: Store;
  private readonly caps: Capabilities;
  private readonly ui: UiBridge;
  private readonly nav: NavBridge;
  private readonly now?: Date;
  private readonly me?: Person;
  private readonly space?: Space | (() => Space | undefined);
  private scope: Record<string, Resolved | undefined>;
  /** The person's languages, and what they make of this app (#302). */
  private prefs: readonly string[];
  private shownIn: Language | undefined;
  private formatLocale: string;
  private readonly languageListeners = new Set<() => void>();
  /**
   * The app's guests (docs/04 §Guests): read from the store once, kept for every pass, and a change
   * from anyone re-renders like a membership change does.
   */
  readonly guests: GuestBook;

  constructor(deps: RuntimeDeps) {
    this.app = deps.app;
    this.host = deps.host;
    this.store = deps.store;
    this.caps = deps.caps;
    this.ui = deps.ui;
    this.nav = deps.nav;
    this.now = deps.now;
    this.me = deps.me;
    this.space = deps.space;
    this.scope = { ...(deps.scope ?? {}) };
    this.prefs = deps.languages ?? [];
    this.shownIn = pickLanguage(this.prefs, this.app.definition);
    this.formatLocale = formatLocaleFor(this.prefs[0], this.shownIn);
    this.guests = new GuestBook(this.store, () => ({ me: this.me, space: typeof this.space === "function" ? this.space() : this.space }));
    this.guests.onChange(() => this.invalidate());
  }

  /** Which language the app is shown in, its own, and every one it carries. */
  get language(): RuntimeLanguage {
    const def = this.app.definition;
    return { current: this.shownIn, default: def.language, available: appLanguages(def) };
  }

  /**
   * The person's languages changed (You → Language, or the device's). The definition is localized
   * again, every live watcher re-runs — computed text that reads `ctx.locale` is worked out anew —
   * and scheduled reminders are re-titled. Returns whether the app's language changed.
   */
  setLanguages(prefs: readonly string[]): boolean {
    const shownIn = pickLanguage(prefs, this.app.definition);
    const formatLocale = formatLocaleFor(prefs[0], shownIn);
    this.prefs = [...prefs];
    if (shownIn === this.shownIn && formatLocale === this.formatLocale) return false;
    this.shownIn = shownIn;
    this.formatLocale = formatLocale;
    this.invalidate();
    for (const cb of this.languageListeners) cb();
    void this.reconcileReminders().catch((e: unknown) => console.warn("[potyro] reminders after a language change:", e));
    return true;
  }

  /** Hear a language change (the shell re-renders the app's chrome). Returns the unsubscribe. */
  onLanguageChange(cb: () => void): () => void {
    this.languageListeners.add(cb);
    return () => this.languageListeners.delete(cb);
  }

  /** A `Dynamic<Words>` option's value as a string; any other option's as it is. */
  private shownOption(value: Value, isWords: boolean): Value {
    return isWords && isWordsMap(value) ? word(value as Record<string, string>, this.shownIn, this.app.definition) : value;
  }

  /** The current app-wide selection, by entity. */
  getScope(): Readonly<Record<string, Resolved | undefined>> {
    return this.scope;
  }

  /**
   * Select (or clear, with `null`) the app-wide record for an entity, then re-run every live watcher:
   * a filter reading `ctx.scope` now answers differently for the same rows, and no record changed,
   * so nothing else would refresh the screen. The shell owns persistence; this owns the value.
   */
  setScope(entity: string, record: Resolved | null): void {
    const next = { ...this.scope };
    if (record) next[entity] = record;
    else delete next[entity];
    this.scope = next;
    this.invalidate();
  }

  /** A `Dynamic<T>` view option, resolved through the host (see `LoadedApp.callViewOption`). */
  async viewOption(pageId: string, key: string, params?: Record<string, unknown>): Promise<Value> {
    const value = await this.app.callViewOption(pageId, key, this.ctxFor(params));
    // A literal map, or a function that returned one (`Dynamic<Words>`), reads in the person's language.
    return this.shownOption(value, this.viewOptionTakesWords(pageId, key));
  }

  private viewOptionTakesWords(pageId: string, key: string): boolean {
    try {
      return VIEW_WORDS[viewOf(this.definition, pageId).type]?.includes(key) ?? false;
    } catch {
      return false; // no such page: the host has already answered null
    }
  }

  /** A `Dynamic<T>` page option (`title`), resolved through the host. */
  async pageOption(pageId: string, key: string, params?: Record<string, unknown>): Promise<Value> {
    return this.shownOption(await this.app.callPageOption(pageId, key, this.ctxFor(params)), key === "title");
  }

  /**
   * Things that change what a view would render WITHOUT changing any record.
   *
   * `Store.subscribe` covers writes, which is most of it — but not all. Membership is the case that
   * exposed the gap: someone joins, so `ctx.space.members` changes, and a view that renders the
   * people in a space (or defaults a field to "everyone") is now showing something stale. No record
   * was touched, so no entity subscriber fired, and the screen stayed wrong until an unrelated write
   * happened to refresh it.
   *
   * Deliberately a general signal rather than a membership-specific one: `ctx` has several parts a
   * view can read that no record write covers.
   */
  private readonly invalidators = new Set<() => void>();

  /** Re-run every live watcher. Called by whoever owns the thing that changed. */
  /**
   * Views that are mounted right now and can be told to do something (`ctx.views`).
   *
   * A SET per page, not one handler: a layout page (#105) shows several views at once, and two of
   * them may be maps. The call goes to each until one takes it, which also means a view that does
   * not know a verb simply declines rather than having to know about the others.
   */
  private readonly viewControls = new Map<string, Set<(verb: string, arg?: unknown) => boolean | Promise<boolean>>>();

  /** A mounted view offers itself. The returned function takes it back out — call it on unmount. */
  registerViewControl(pageId: string, handle: (verb: string, arg?: unknown) => boolean | Promise<boolean>): () => void {
    const set = this.viewControls.get(pageId) ?? new Set();
    set.add(handle);
    this.viewControls.set(pageId, set);
    return () => {
      set.delete(handle);
      if (set.size === 0) this.viewControls.delete(pageId);
    };
  }

  /** `false` when that page has no view on screen to take it — an answer, not an error. */
  async callView(pageId: string, verb: string, arg?: unknown): Promise<boolean> {
    for (const handle of this.viewControls.get(pageId) ?? []) {
      if (await handle(verb, arg)) return true;
    }
    return false;
  }

  invalidate(): void {
    for (const cb of this.invalidators) cb();
  }

  onInvalidate(cb: () => void): () => void {
    this.invalidators.add(cb);
    return () => this.invalidators.delete(cb);
  }

  /** The definition in the language the app is shown in: every `Words` slot is its string (#302). */
  get definition(): Localized<AppDefinition> {
    return localize(this.app.definition, this.shownIn);
  }

  /** Build a fresh ctx (deterministic time per pass) with optional view params. */
  ctxFor(params?: Record<string, unknown>): Ctx {
    const base: MakeCtxBase = {
      store: this.store,
      caps: this.caps,
      ui: this.ui,
      nav: this.nav,
      views: { call: (pageId, verb, arg) => this.callView(pageId, verb, arg) },
      params,
      now: this.now,
      me: this.me,
      // Resolved per pass, never captured — see `RuntimeDeps.space`.
      space: typeof this.space === "function" ? this.space() : this.space,
      guests: this.guests,
      scope: this.scope,
      language: this.shownIn,
      formatLocale: this.formatLocale,
    };
    const ctx = this.host.makeCtx(this.app, base);
    // Every write through this ctx is tracked — the views', a custom view's, an action's. A Proxy
    // rather than a copy, so the parts of ctx that are getters (the space) stay live.
    return new Proxy(ctx, {
      get: (target, key, receiver) => {
        const value = Reflect.get(target, key, receiver);
        if (!WRITES.has(key) || typeof value !== "function") return value;
        return (...args: unknown[]) => this.track((value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      },
    });
  }

  /** The app is being put away (see `PotyroRuntime.close`). */
  close(): void {
    this.closed = true;
    this.guests.dispose();
  }

  /** Remember `work` until it settles. Returns it unchanged, rejection included. */
  track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work);
    const done = (): void => void this.inFlight.delete(work);
    work.then(done, done);
    return work;
  }

  /**
   * Wait until every write this runtime started has landed or failed.
   *
   * A tick is a patch, and a patch is several store calls in turn: read, check the values fit,
   * write. Putting the app away between them closed the store under the write, and the tick was gone
   * on the next open. The shell awaits this before closing the store. Never throws — a write that
   * failed has already told whoever started it — and gives up after SETTLE_LIMIT_MS.
   */
  async settle(limitMs = SETTLE_LIMIT_MS): Promise<void> {
    const deadline = Date.now() + limitMs;
    // A loop, because a write that lands can start another (an action's second patch).
    while (this.inFlight.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0) return;
      await Promise.race([Promise.allSettled([...this.inFlight]), new Promise((r) => setTimeout(r, left))]);
    }
  }

  /**
   * Run a page's button. Errors surface the way an action's do — the shell shows them; a button that
   * did nothing and said nothing is the worst of both.
   */
  async runPageAction(pageId: string, index: number, params?: Record<string, unknown>): Promise<void> {
    // The whole action, not only its ctx writes: an untrusted app writes from inside its isolate.
    await this.track(this.app.callPageAction(pageId, index, this.ctxFor(params)));
    this.invalidate();
  }

  entityForPage(pageId: string): string {
    const view = viewOf(this.definition, pageId) as { entity: string };
    return view.entity;
  }

  /**
   * Resolve a page's rows: fetch + resolve (relations/computed) via ctx, then apply the view's
   * JS filter and sort through the host (uniform across trust). Always goes through the host so
   * an untrusted app's predicates run in its isolate.
   */
  async queryPage(pageId: string, params?: Record<string, unknown>): Promise<{ rows: Resolved[]; ctx: Ctx }> {
    const entity = this.entityForPage(pageId);
    const ctx = this.ctxFor(params);
    const resolved = await ctx.query(entity);
    const keep = await Promise.all(resolved.map((r) => this.app.callFilter(pageId, r, ctx)));
    const filtered = resolved.filter((_, i) => keep[i]);
    const sorted = await asyncSort(filtered, (a, b) => this.app.callSort(pageId, a, b, ctx));
    return { rows: sorted, ctx };
  }

  /** Query an entity with explicit JS predicates (used by custom views; trusted closures). */
  async queryEntity(
    entity: string,
    spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number },
    params?: Record<string, unknown>,
  ): Promise<Resolved[]> {
    const ctx = this.ctxFor(params);
    return ctx.query(entity, spec);
  }

  async getRecord(entity: string, id: Id, params?: Record<string, unknown>): Promise<Resolved | null> {
    return this.ctxFor(params).get(entity, id);
  }

  async runAction(entity: string, key: string, id: Id, input?: unknown, params?: Record<string, unknown>): Promise<void> {
    // An action that declares its input (#213) gets it checked here, whoever runs it; a button that
    // brings none gets a form of those fields, titled with the action's label. The form is asked
    // BEFORE tracking starts: an open form writes nothing, and must not hold up leaving the app.
    const info = actionInfo(this.definition.entities[entity], key);
    let given = input;
    if (info?.input) {
      if (given === undefined) {
        const filled = await this.ctxFor(params).ui.form({ title: info.label, submit: info.label, fields: info.input });
        if (filled == null) return;
        given = filled;
      }
      const problem = actionInputProblem(info.input, given);
      if (problem) throw new FieldValueError(problem);
    }
    // Tracked from here, not from when the action begins: the record is read first, and leaving
    // during that read must still wait. The whole action, too — an untrusted app writes from inside
    // its isolate, where no ctx of ours sees it.
    return this.track(
      (async () => {
        const ctx = this.ctxFor(params);
        const record = await ctx.get(entity, id);
        if (!record) throw new Error(`runAction: ${entity}/${id} not found`);
        await this.app.callAction(entity, key, record, ctx, given);
      })(),
    );
  }

  async create(entity: string, data: Partial<PotyroRecord>): Promise<PotyroRecord> {
    return this.ctxFor().create(entity, data as Record<string, unknown>);
  }

  async patch(entity: string, id: Id, data: Partial<PotyroRecord>): Promise<void> {
    await this.ctxFor().patch(entity, id, data as Record<string, unknown>);
  }

  async remove(entity: string, id: Id): Promise<void> {
    await this.ctxFor().delete(entity, id);
  }

  /** Raw binding value from the (trust-visible) definition, for string-vs-function decisions. */
  private rawBinding(ref: BindingRef): unknown {
    const def = this.definition;
    if (ref.kind === "reminder") {
      const rem = (def.reminders ?? []).find((r) => r.id === ref.id);
      return rem?.[ref.path];
    }
    const view = viewOf(def, ref.page) as unknown as Record<string, unknown>;
    if (ref.path.startsWith("display.")) {
      const key = ref.path.slice("display.".length);
      return (view.display as Record<string, unknown> | undefined)?.[key];
    }
    return view[ref.path];
  }

  /** Resolve a view/reminder binding to a value: field-key strings read the record; functions
   *  (or isolate sentinels) are called through the host. */
  async resolveBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value> {
    const raw = this.rawBinding(ref);
    if (typeof raw === "string" && raw !== FN_SENTINEL) {
      return (record[raw] ?? null) as Value;
    }
    if (raw == null) return null;
    return this.app.callBinding(ref, record, ctx);
  }

  /**
   * Reconcile reminders against the notification cap, idempotently: schedule every future reminder
   * and cancel any previously-scheduled one that is now stale (record deleted, or `when` became
   * null/past). The live id set is tracked in kv so a stale notification can be cancelled even
   * across reloads. No notification cap (web today) → no-op: the app degrades to its in-app "due"
   * surface (docs/03, M2). Exact offline scheduling arrives with the native target (KA-03).
   */
  async reconcileReminders(params?: Record<string, unknown>): Promise<void> {
    const ctx = this.ctxFor(params);
    const notif = ctx.caps.notifications;
    if (!notif) return;

    const previous = ((await ctx.storage.get(REMINDER_KV_KEY)) as string[] | null) ?? [];
    const desired = new Map<string, { id: string; at: Date; title: string; body?: string }>();

    for (const rem of this.definition.reminders ?? []) {
      const rows = await ctx.query(rem.entity);
      for (const r of rows) {
        const when = await this.app.reminderWhen(rem.id, r, ctx);
        if (!when || when.getTime() <= ctx.now().getTime()) continue; // only future reminders
        const id = `${rem.id}:${r.id}`;
        const title = await this.resolveBinding({ kind: "reminder", id: rem.id, path: "title" }, r, ctx);
        const body = rem.body ? await this.resolveBinding({ kind: "reminder", id: rem.id, path: "body" }, r, ctx) : undefined;
        desired.set(id, { id, at: when, title: String(title ?? ""), body: body == null ? undefined : String(body) });
      }
    }

    // Cancel notifications that should no longer exist, then (re)schedule the live set — both keyed
    // by `${reminderId}:${recordId}`, so scheduling is idempotent.
    for (const id of previous) {
      if (!desired.has(id)) await notif.cancel(id);
    }
    for (const n of desired.values()) await notif.schedule(n);

    await ctx.storage.set(REMINDER_KV_KEY, [...desired.keys()]);
  }
}
