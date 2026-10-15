// `ctx` — the host API surface (docs/04). This is *the* contract: every host power reaches
// app code only through `ctx`. Growing the system means growing this interface, never adding
// language features to a DSL (there is no DSL).
//
// `ctx` is constructed by the host (WP2). Its data/time/storage/ui/nav members are always
// present; its `caps` members are real+unmediated for trusted apps and mediated (or absent)
// for untrusted apps. App code sees the same interface either way — authority is what differs.

import type { FileInfo, FileRef, Geo, Id, MediaRef, Resolved, Value } from "./core.js";
import type { Field } from "./fields.js";
import type { Language, Words } from "./words.js";
import type { AiValue } from "./infer.js";

/** Query spec for `ctx.query` — JS predicates run in-memory over resolved rows. */
export interface QuerySpec {
  filter?: (r: Resolved) => boolean;
  sort?: (a: Resolved, b: Resolved) => number;
  limit?: number;
  offset?: number;
}

export interface CameraCapability {
  capture(opts?: { source?: "camera" | "library" }): Promise<Blob>;
}

export interface NotificationCapability {
  schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>;
  supportsExactScheduling: boolean;
}

export interface GeoCapability {
  current(): Promise<{ lat: number; lng: number }>;
}

export interface FileCapability {
  pick(): Promise<Blob>;
  save(name: string, data: Blob): Promise<void>;
}

export interface NetworkCapability {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** Haptic feedback (docs/04). `pattern` follows the Web Vibration API. */
export interface HapticsCapability {
  vibrate(pattern?: number | number[]): Promise<void>;
}

/** `ctx.caps.ai.extract`'s answer shape (docs/23): a leaf ("number?" may be null; a date is "YYYY-MM-DD"), one of a list, `[shape]`, or `{ key: shape }`. */
export type AiLeaf = "text" | "number" | "boolean" | "date";
export type AiShape = AiLeaf | `${AiLeaf}?` | { readonly oneOf: readonly string[]; readonly optional?: boolean } | readonly [AiShape] | { readonly [key: string]: AiShape };

/** A picture: a camera Blob, bytes, a `file` field's value or a path in `ctx.files`, a `media` field's value. */
export type AiImage = Blob | Uint8Array | FileRef | MediaRef | string;

export interface AiExtractRequest<S extends AiShape> {
  schema: S;
  /** What this is and what to take from it: "A shop receipt. One item per line bought." */
  instructions?: string;
  image?: AiImage | readonly AiImage[];
  text?: string;
}

/**
 * AI for the app's own work (docs/23). Sends only what the call names; the answer is checked against
 * `schema` and typed from it. Needs `permissions: { ai: true }`. Throws words for the person.
 */
export interface AiCapability {
  extract<const S extends AiShape>(req: AiExtractRequest<S>): Promise<AiValue<S>>;
  ask(prompt: string, opts?: { image?: AiImage | readonly AiImage[]; instructions?: string }): Promise<string>;
}

/**
 * Native capabilities as app code sees them. Each member is optional: for an untrusted app it
 * is `undefined` unless the permission was declared *and* granted, and when present it may be
 * a mediated (scoped/rate-limited) wrapper. Trusted apps get all of them, unmediated.
 */
export interface Caps {
  camera?: CameraCapability;
  notifications?: NotificationCapability;
  geo?: GeoCapability;
  haptics?: HapticsCapability;
  filesystem?: FileCapability;
  network?: NetworkCapability;
  /** AI for the app's own work (docs/23). Needs `permissions: { ai: true }`. */
  ai?: AiCapability;
}

/**
 * A person — you, or someone you share a space with (KA-18, ADR D2 amended).
 *
 * `id` is a cojson account id, stable for life. It is the *provable* identity: cojson signs every
 * transaction with the account that made it, which is what lets `createdBy` mean something in a
 * shared ledger. An id an app could write into a field would be forgeable by any member.
 */
export interface Person {
  id: Id;
  name: string;
}

/** What a member may do in a space (ADR D3). */
export type SpaceRole = "admin" | "writer" | "reader";

export interface Member extends Person {
  role: SpaceRole;
}

/**
 * The space this app's data lives in — present only when the app is synced (ADR D3).
 *
 * Absent for a solo app, which is the default. App code should read `ctx.space?.members ?? [ctx.me]`
 * rather than branching on whether sync exists: solo is "a space with one member", not a different
 * world.
 */
export interface Space {
  id: Id;
  members: readonly Member[];
  /** This device's own role in the space. */
  role: SpaceRole;
  /**
   * Mint an invite link. Host-mediated: the shell owns the UI and the admin check, because an app
   * that could silently mint invites could silently hand its data to someone.
   */
  invite(): Promise<string>;
}

/** App-scoped key/value storage, separate from entity records. */
export interface CtxStorage {
  get<T = unknown>(k: string): Promise<T | null>;
  set(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** UI affordances provided by the shell (docs/04). */
/** One choice in `ui.sheet` / `ui.menu`. A destructive item is shown last, in red. */
export interface UiItem<T = string> {
  id: T;
  label: Words;
  detail?: Words;
  icon?: string;
  destructive?: boolean;
}

/** A running `ui.progress` bar. */
export interface UiProgress {
  /** `fraction` from 0 to 1; `detail` replaces the count on the right ("24 of 40"). */
  update(fraction: number, detail?: string): void;
  done(): void;
}

/** Takes `Words` wherever it takes words. */
export interface CtxUi {
  toast(msg: Words): void;
  /**
   * `ok` names the button ("Delete"); `destructive` makes it red; `detail` is a quieter second line.
   *
   * `cancel` names the other button — worth naming whenever both answers are real choices ("Delete
   * them" / "Move them up") rather than an action and a way out of it.
   */
  confirm(msg: Words, opts?: { detail?: Words; ok?: Words; cancel?: Words; destructive?: boolean }): Promise<boolean>;
  prompt(msg: Words, opts?: { default?: string }): Promise<string | null>;
  pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>;
  /** A short list of choices: a bottom sheet on a phone, a small dialog on a wide screen. Null when dismissed. */
  sheet<T = string>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
  /** The same, hanging under the button that ran the action on a wide screen (a sheet on a phone). */
  menu<T = string>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
  /** Several values at once, with the record form's controls. Relations come back as ids; null when cancelled. */
  form<T = Record<string, unknown>>(opts: { title: Words; fields: Record<string, Field>; initial?: Partial<T>; submit?: Words }): Promise<T | null>;
  /** A progress bar for a long action. */
  progress(label: Words): UiProgress;
  /**
   * Hand words and/or a link to the person to send on: the device's share sheet where there is one,
   * and a dialog that shows what will be sent with a Copy button everywhere. The person chooses where
   * it goes, so it needs no permission. `true` once it was copied or handed to the share sheet,
   * `false` when they closed it without either. `url` must be http(s).
   *
   * ```ts
   * await ctx.ui.share({ title: { en: "Share your result" }, text: "Daily #12 4/6\n🟩🟨⬛⬛🟩" });
   * ```
   */
  share(opts: { text?: Words; url?: string; title?: Words }): Promise<boolean>;
}

/**
 * A map that is on screen right now.
 *
 * Every method answers whether it happened: `false` when that page is not the one open (its view is
 * not mounted, so there is nothing to move) — never a crash, and never silence.
 */
export interface MapViewControl {
  /** Move the map. `zoom` is left alone when omitted, so this pans without throwing away the scale. */
  flyTo(to: { center: [number, number]; zoom?: number }): Promise<boolean>;
  /** Frame everything currently pinned — the "show me all of it" button. */
  fit(): Promise<boolean>;
}

/**
 * Reach a view that is open and change what it is showing.
 *
 * A map opens on its `camera`, read ONCE when the view opens — the right default, and a dead end for
 * everything afterwards. This is how an app moves one later. Addressed by PAGE id and resolved when
 * called, never held. Pair it with the page's `actions` to get a button that does something:
 *
 * ```ts
 * // { id: "map", actions: [{ label: "Centre on me", run: async (ctx) => {
 * //     const here = await ctx.caps.geo!.current();
 * //     await ctx.views.map("map").flyTo({ center: [here.lng, here.lat], zoom: 15 });
 * // } }], view: { type: "map", entity: "place", geo: "where" } }
 * ```
 */
export interface CtxViews {
  map(pageId: string): MapViewControl;
}

/**
 * The app's own folder (#252). Name a file by path (`"notes/a.md"`) or by a `file` field's value.
 * Reading a missing path throws; `null` means the bytes have not reached this device yet.
 */
export interface CtxFiles {
  /** All files, or those under `folder`. */
  list(folder?: string): Promise<FileInfo[]>;
  stat(file: string | FileRef): Promise<FileInfo | null>;
  text(file: string | FileRef): Promise<string | null>;
  json<T = unknown>(file: string | FileRef): Promise<T | null>;
  bytes(file: string | FileRef): Promise<Uint8Array | null>;
  /** For `<img>`, `<audio>`, `<video>`, a link. */
  url(file: string | FileRef): Promise<string | null>;
  /** Create or replace (keeps the id). */
  write(path: string, data: string | Uint8Array | Blob, opts?: { mime?: string }): Promise<FileInfo>;
  rename(file: string | FileRef, to: string): Promise<FileInfo>;
  remove(file: string | FileRef): Promise<void>;
  /** The person picks files; they land under `folder`. `[]` if they cancel. No permission needed. */
  import(opts?: { folder?: string; accept?: string; multiple?: boolean }): Promise<FileInfo[]>;
  /** Save a copy outside the app. */
  export(file: string | FileRef): Promise<void>;
}

/** The options `ctx.format.date` takes; no others. */
export interface FormatDateOptions {
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "short" | "medium";
  weekday?: "long" | "short";
  day?: "numeric" | "2-digit";
  month?: "long" | "short" | "numeric";
  year?: "numeric" | "2-digit";
  hour?: "numeric" | "2-digit";
  minute?: "2-digit";
}

export interface FormatNumberOptions {
  style?: "decimal" | "percent" | "unit";
  /** With `style: "unit"`: "kilogram", "kilometer-per-hour", "day". */
  unit?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  signDisplay?: "auto" | "always" | "exceptZero";
}

/**
 * Formats for the person, the same in the sealed box. Only for text the app composes: return a Date
 * or a number where a view formats it (a `datetime` field, `AggregateRow.value`).
 */
export interface CtxFormat {
  /** The tag these format in: "pl-PL". */
  locale: string;
  date(d: Date | string | number, opts?: FormatDateOptions): string;
  number(n: number, opts?: FormatNumberOptions): string;
  /** Whole minor units: `money(4200, "EUR")` → "42,00 €". */
  money(minor: number, currency?: string): string;
  /** From `ctx.now()`: "in 3 days". */
  relative(d: Date | string | number, opts?: { unit?: "minute" | "hour" | "day" | "week" | "month" | "year"; numeric?: "auto" | "always" }): string;
  list(items: string[], opts?: { type?: "conjunction" | "disjunction" }): string;
}

/** Media helpers (docs/04). */
export interface CtxMedia {
  put(bytes: Blob): Promise<MediaRef>;
  url(ref: MediaRef): Promise<string>;
}

/**
 * The complete host API surface handed to app functions. See docs/04 for the design rules:
 * members are stable, minimal, composable, async-by-default for anything touching
 * storage/caps, and `now()` is fixed per evaluation pass for deterministic computed values.
 */
export interface Ctx {
  // ---- data (all reads return Resolved records) ----
  query(entity: string, spec?: QuerySpec): Promise<Resolved[]>;
  get(entity: string, id: Id): Promise<Resolved | null>;
  create(entity: string, data: Record<string, unknown>): Promise<Resolved>;
  patch(entity: string, id: Id, data: Record<string, unknown>): Promise<Resolved>;
  /**
   * Add to a number — use this instead of `patch` for anything people count.
   *
   * `patch(id, { n: record.n + 1 })` reads on one device and writes on another: two people pressing
   * at the same moment both read 0, both write 1, and one press is gone with nothing to show for it.
   * Stating the CHANGE rather than the result lets the store add them up, because it is the only
   * party that can see both devices.
   *
   * Nothing else about the field changes — `record.n` is still one number, and a field written with
   * `patch` before is the starting point rather than something to migrate.
   */
  increment(entity: string, id: Id, field: string, delta: number): Promise<Resolved>;
  delete(entity: string, id: Id): Promise<void>;
  transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>;

  // ---- time (injected once per evaluation pass for determinism) ----
  now(): Date;
  today(): Date;

  // ---- identity (KA-18) ----
  /**
   * Who you are. **Always present**, including in a solo app that has never synced — so app code
   * never has to branch on whether identity or sync exists.
   */
  me: Person;
  /**
   * The space this app's data lives in, or `undefined` for a solo (local-only) app.
   *
   * Solo is a space with one member and no transport, so the honest reading of "everyone here" is
   * `ctx.space?.members ?? [ctx.me]`.
   */
  space?: Space;

  /**
   * Runtime inputs: the values of the current page's filter chips (`FilterChip.param`) and the
   * route params it was navigated to with (`navigate(pageId, params)` / `onOpen.param`).
   *
   * Scoped PER PAGE. A chip chosen on one page is not visible to another page's `filter`, so a
   * selection that should follow the user across pages cannot live here. (`ctx.storage` persists
   * across pages but is async, so a synchronous `filter` cannot read it either.)
   */
  params: Readonly<Record<string, unknown>>;

  /**
   * The app-wide selected record, when the app declares a top-level `scope` (see `ScopeDef`):
   * `ctx.scope.trip` is the current trip as a `Resolved` record, or `undefined` while none is
   * chosen. Synchronous and fixed per evaluation pass, so a `filter` can read it directly:
   * `(e, ctx) => e.trip?.id === ctx.scope.trip?.id`. Always present; `{}` for an app with no scope.
   * Per device — which trip *you* are looking at is not shared state.
   */
  scope: Readonly<Record<string, Resolved | undefined>>;

  // ---- the app's words and the person's formats (#302) ----
  /** The language the app's words are shown in: one of its `languages`. Fixed per pass. */
  locale: Language;
  /** Words for `ctx.locale`. With `vars`, an ICU message: `ctx.t({ en: "{n, plural, one {# plant} other {# plants}}", pl: "…" }, { n })`. */
  t(words: Words, vars?: Record<string, string | number | Date>): string;
  format: CtxFormat;

  // ---- app-scoped key/value storage ----
  storage: CtxStorage;

  // ---- native capabilities (may be denied/scoped for untrusted apps) ----
  caps: Caps;

  // ---- media helpers ----
  media: CtxMedia;

  // ---- the app's own folder (#252) ----
  files: CtxFiles;

  // ---- UI affordances provided by the shell ----
  ui: CtxUi;

  // ---- the views that are on screen (what `camera` cannot do, because it is read only at open) ----
  views: CtxViews;

  // ---- navigation (in view/action contexts) ----
  navigate(pageId: string, params?: Record<string, string>): void;

  // ---- diagnostics ----
  log(...args: unknown[]): void;
}

/** Re-export so consumers can name the value type without reaching into core. */
export type { Value, Geo };
