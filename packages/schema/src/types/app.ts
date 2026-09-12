// The `AppDefinition` shape: declarative structure (data) + co-located logic (functions).
// docs/03 is the source of truth for this file.

import type { ReactElement } from "react";
import type { Ctx } from "./ctx.js";
import type { KartaRecord, Resolved, Value } from "./core.js";
import type { Field } from "./fields.js";
import type { ViewProps } from "./runtime.js";

// ─────────────────────────────────────────────────────────────────────────────
// Logic function signatures (docs/04). The record param is `Resolved` — the permissive
// "no ceiling" record. Logic is typed by TS but not statically constrained by field shape;
// that is by design (see core.ts `Resolved`).
// ─────────────────────────────────────────────────────────────────────────────

export type Computed = (record: Resolved, ctx: Ctx) => Value | Promise<Value>;
export type ActionFn = (record: Resolved, ctx: Ctx, input?: unknown) => void | Promise<void>;
export type FilterFn = (record: Resolved, ctx: Ctx) => boolean;
/** Orders two rows. `ctx` (#133) lets a sort read the selection, the page's chips or the user's
 *  position: `(a, b, ctx) => distance(a, ctx.params.me) - distance(b, ctx.params.me)`. */
export type SortFn = (a: Resolved, b: Resolved, ctx: Ctx) => number;
export type BindingFn<T = Value> = (record: Resolved, ctx: Ctx) => T;
export type ReminderWhen = (record: Resolved, ctx: Ctx) => Date | null;

/** A view binding is either a field-key string or a function computing the value. */
export type Binding<T = Value> = string | BindingFn<T>;

// ─────────────────────────────────────────────────────────────────────────────
// Entities
// ─────────────────────────────────────────────────────────────────────────────

/** A titled run of fields (#100). The form and the detail page both read it: the form shows the
 *  editable fields of each group under its title, the detail page every listed field or computed. */
export interface FieldGroup {
  title?: string;
  /** Field keys, or computed keys (those show on the detail page only). */
  fields: string[];
  /** Start folded. The first group is never folded, whatever this says. */
  collapsed?: boolean;
}

export interface EntityDef {
  label?: string;
  /** Optional glyph/emoji for launcher tiles + quick-action buttons (e.g. "🏋"). */
  icon?: string;
  displayField?: string;
  fields: Record<string, Field>;
  /** How the form and the detail page arrange the fields. Fields left out of every group follow the
   *  last group, untitled, in declaration order. */
  groups?: FieldGroup[];
  computed?: Record<string, Computed>;
  actions?: Record<string, ActionFn>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages & views (docs/03). Any binding, filter, or sort may be a function.
// ─────────────────────────────────────────────────────────────────────────────

/** Where tapping a row navigates. `param` maps target-param → source field key. */
export interface OnOpen {
  page: string;
  param?: Record<string, string>;
}

export interface ListDisplay {
  primary?: Binding;
  secondary?: Binding;
  media?: string;
  badges?: string[];
}

export interface ListView {
  type: "list";
  entity: string;
  filter?: FilterFn;
  sort?: SortFn;
  display?: ListDisplay;
  rowActions?: string[];
  onOpen?: OnOpen;
  /** Shown when the page has no rows. A function of ctx may say why: `(ctx) => \`No places in ${ctx.scope.trip?.city} yet\``. */
  emptyText?: Dynamic<string>;
  param?: string;
  filters?: FilterChip[];
}

export interface GalleryView {
  type: "gallery";
  entity: string;
  filter?: FilterFn;
  sort?: SortFn;
  display?: ListDisplay;
  onOpen?: OnOpen;
  emptyText?: Dynamic<string>;
}

export interface TableView {
  type: "table";
  entity: string;
  filter?: FilterFn;
  sort?: SortFn;
  display?: { columns: string[] };
}

/** An action reference in a detail view: an action key, or an inline navigate button. */
export type DetailAction =
  | string
  | { label: string; navigate: { page: string; param?: Record<string, string> } };

export interface DetailSection {
  title?: string;
  fields: string[];
}

export interface DetailView {
  type: "detail";
  entity: string;
  param?: string;
  /** Overrides the entity's `groups` for this page only. Without it the page shows the groups. */
  sections?: DetailSection[];
  actions?: DetailAction[];
}

export interface CalendarView {
  type: "calendar";
  entity: string;
  date: Binding;
  title?: Binding;
  color?: Binding;
  filter?: FilterFn;
}

/** A filter chip surfaced in a map/list view chrome; writes into `ctx.params[param]`.
 *  - `type: "boolean"` → a toggle (param = true | undefined).
 *  - `type: "geo"` → a "use my location" button (param = { lat, lng } from `ctx.caps.geo`).
 *  - `from` naming an ENTITY → record chips: one chip per record of that entity (its `displayField`),
 *    param = the selected record ids (string[]). This is how a list or map is narrowed to "the
 *    trip / the project / the person" chosen by the user.
 *  - otherwise `from` names an enum/tags field whose options become selectable chips (single, or
 *    multi when `multi` is set). */
export interface FilterChip {
  label: string;
  param: string;
  from?: string;
  multi?: boolean;
  type?: "boolean" | "geo";
}

/**
 * How a map frames itself when opened. `"remember"` (the default) reopens where the user left it and
 * frames the markers only on a first-ever open; `"fit"` always frames the current markers; a literal
 * `{ center, zoom }` always opens at one fixed spot. `center` is `[lng, lat]`.
 */
export type MapCamera = "remember" | "fit" | { center: [number, number]; zoom: number };

/**
 * A view option that may be a literal or a function of `ctx`, evaluated by the host each time the
 * view opens (and again when `ctx.scope` changes). The function form is what lets an option depend
 * on the selected record: `camera: (ctx) => ({ center: [lng, lat], zoom: 11 })` from
 * `ctx.scope.trip?.location`. Runs untrusted like `filter` does — a value in, a value out.
 */
export type Dynamic<T> = T | ((ctx: Ctx) => T | Promise<T>);

export interface MapView {
  type: "map";
  entity: string;
  geo: string;
  title?: Binding;
  color?: Binding;
  filter?: FilterFn;
  filters?: FilterChip[];
  /** Where tapping a marker goes. Without it a marker only shows its `title` in a popup. */
  onOpen?: OnOpen;
  camera?: Dynamic<MapCamera>;
}

export interface StepsView {
  type: "steps";
  entity: string;
  param?: string;
  /** Field key of the ordered list to walk. */
  list: string;
  /** How to render one step. A field key of the list's sub-fields, or a function over the step. */
  text?: Binding;
  /** Action key to run once every step is ticked. Without it, finishing does nothing. */
  onFinish?: string;
}

/**
 * A list of things you tick (#106): groceries, packing, chores, habits. Rows in, patches out —
 * tapping a row's check flips its `done` field through `ctx.patch`, so it renders untrusted like
 * every declarative view. `steps` ticks *within* one record; this ticks *across* records.
 */
export interface ChecklistView {
  type: "checklist";
  entity: string;
  /** The boolean field a tick flips — or an enum field, with `doneValue` naming the done option. */
  done: string;
  /** For an enum `done`: the option that means done. Un-ticking restores the enum's first other option. */
  doneValue?: string;
  /** The row's label. Default: the entity's display field. */
  text?: Binding;
  /** A quieter second line. */
  detail?: Binding;
  /** Rows sharing a value sit under one heading ("Produce", "Dairy"). */
  group?: Binding;
  filter?: FilterFn;
  sort?: SortFn;
  filters?: FilterChip[];
  /** `true`: done rows disappear. `"collapse"`: they fold into a "Done (n)" section. Default: listed under "Done". */
  hideDone?: boolean | "collapse";
  /** An input at the bottom: type, Enter, next — creates a record with the text as its display field. */
  quickAdd?: boolean;
  rowActions?: string[];
  /** Where the row's chevron goes. Without it a row has no detail. */
  onOpen?: OnOpen;
  emptyText?: Dynamic<string>;
}

/**
 * One row of a derived table — a balance, a settle-up transfer, a remaining quantity.
 *
 * Deliberately display-ready plain data, not markup. That is the whole design of the aggregate view
 * (KA-24): the isolate bridge is a single string-in/string-out JSON function, so a *value*-returning
 * function crosses it natively, exactly as `computed`/`filter`/`summary` already do. A React
 * component would need a serializable-VDOM and event-callback protocol that does not exist — so a
 * declarative aggregate runs with the architecture's grain, and a custom view runs against it.
 */
export interface AggregateRow {
  /** Stable identity for the row. Falls back to `label` when omitted. */
  id?: string;
  /** The row's subject — "Ana → Bruno", "Milk". */
  label: string;
  /** The number or amount, rendered at the end of the row. Pre-formatted if you want it exact. */
  value?: string | number;
  /** A quieter second line. */
  detail?: string;
  /**
   * Semantic colouring — "you are owed" vs "you owe". Colour is never the only signal: the value
   * text carries the sign too, so this stays readable in monochrome and to a screen reader.
   */
  tone?: "positive" | "negative" | "neutral";
  /** Optional section heading; consecutive rows sharing one are grouped under it. */
  group?: string;
}

/**
 * A screen computed from the WHOLE set rather than from each record (KA-24).
 *
 * The gap this closes: `computed` is per-record and every other built-in renders rows, so "who owes
 * whom" and "what's still to buy" — the *main screen* of most shared apps — had nowhere to live but
 * a custom view. Custom views are trusted-only, so a shared app's whole point rendered blank for
 * precisely the people sharing exists to serve.
 *
 * `rows` receives the page's filtered, resolved rows and returns display-ready rows. It is ordinary
 * TypeScript — the fold, the rounding, the debt simplification — so this is not a retreat into a
 * DSL; only the *rendering* is declarative.
 */
export interface AggregateView {
  type: "aggregate";
  entity: string;
  param?: string;
  /** Fold the page's rows into what should be displayed. */
  rows: (rows: Resolved[], ctx: Ctx) => AggregateRow[] | Promise<AggregateRow[]>;
  /** Heading above the derived table. */
  title?: Dynamic<string>;
  /** Shown when the fold returns nothing — "Nobody owes anybody." */
  emptyText?: Dynamic<string>;
}

export interface CustomView {
  type: "custom";
  entity: string;
  param?: string;
  /**
   * React form: return an element. Convenient, and what most views use.
   *
   * Declare `mount` instead to write the view in anything else — this one names React in the app
   * contract, which is what made the host's framework an architectural decision rather than a
   * changeable one.
   */
  render?: (props: ViewProps) => ReactElement;
  /**
   * Framework-neutral form: put your UI inside `el`, return a teardown.
   *
   * ```ts
   * mount: (el, props) => { const app = mount(Thing, { target: el, props }); return () => unmount(app); }
   * ```
   *
   * The host only ever hands over a container, exactly as it does for MapLibre — so the view and the
   * shell need not agree on a framework.
   */
  mount?: (el: HTMLElement, props: ViewProps) => () => void;
  onFinish?: string;
}

export type View =
  | ListView
  | GalleryView
  | TableView
  | DetailView
  | CalendarView
  | MapView
  | StepsView
  | ChecklistView
  | AggregateView
  | CustomView;

export const VIEW_TYPES = [
  "list",
  "gallery",
  "table",
  "detail",
  "calendar",
  "map",
  "steps",
  "checklist",
  "aggregate",
  "custom",
] as const;

export type ViewType = (typeof VIEW_TYPES)[number];

/** How a summary figure is aggregated. `count` needs no field; the rest aggregate one. */
export type SummaryOp = "sum" | "count" | "avg" | "max";

/**
 * One figure shown above a page's view.
 *
 * Give either `op` (with a `field`, unless counting) or a `value` function — the same
 * declarative-or-function pairing as `filters`/`filter`. The declarative form is the one the
 * structural editor can edit and the one that ports to another framework, so prefer it when the
 * figure is a plain aggregate; push per-record arithmetic into a `computed` field to keep it there.
 */
export interface SummaryValue {
  label: string;
  /** The field (or computed) to aggregate. Not used with `value`, not needed for `count`. */
  field?: string;
  op?: SummaryOp;
  /** Full control: receives the page's filtered, resolved rows. */
  value?: (rows: Resolved[], ctx: Ctx) => unknown;
}

export interface Page {
  id: string;
  /** The tab label. A function of ctx can name the selection: `(ctx) => \`Places in ${ctx.scope.trip?.city ?? "…"}\``. */
  title: Dynamic<string>;
  /** One emoji or short glyph for the page's tab (#111). Without it the tab shows the entity's icon. */
  icon?: string;
  hidden?: boolean;
  /** Figures shown above the view, computed over the page's filtered rows. */
  summary?: SummaryValue[];
  view: View;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reminders (docs/03)
// ─────────────────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  entity: string;
  when: ReminderWhen;
  title: Binding;
  body?: Binding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migrations (docs/06) — declarative ops with a code escape hatch.
// ─────────────────────────────────────────────────────────────────────────────

export type MigrationStep =
  | { op: "addField"; entity: string; field: string; default?: unknown }
  | { op: "dropField"; entity: string; field: string }
  | { op: "renameField"; entity: string; from: string; to: string }
  | { op: "changeType"; entity: string; field: string; to: string; via: (value: unknown) => unknown }
  | { op: "renameEntity"; from: string; to: string }
  | { op: "setDefaultForExisting"; entity: string; field: string; value: unknown }
  | { op: "addRelation"; entity: string; field: string; to: string; many?: boolean }
  | { transform: (record: KartaRecord, ctx: Ctx) => KartaRecord };

export interface Migration {
  from: string;
  to: string;
  steps: MigrationStep[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level app definition
// ─────────────────────────────────────────────────────────────────────────────

/** Network permission: on/off, or scoped to an allow-list of hosts. */
export type NetworkPermission = boolean | { hosts?: string[] };

export interface PermissionManifest {
  /**
   * This app writes to a document that leaves the device (ADR D8).
   *
   * **Declared, not yet enforced.** The manifest is the app's own statement of intent; the consent
   * prompt and the gating that make it *mean* something are KA-23. Recorded here because it is part
   * of the surface app code is authored against — but nothing today refuses sync to an app that
   * omits it, and no code should be written as though it does.
   */
  sync?: boolean;
  camera?: boolean;
  filesystem?: boolean;
  notifications?: boolean;
  geo?: boolean;
  haptics?: boolean;
  network?: NetworkPermission;
}

export interface Theme {
  accent?: string;
}

/**
 * A prominent create-flow trigger (e.g. "Start a session"). Declarative: the shell owns the flow —
 * pick a single required enum inline ("menu") or open the create form ("form"); "auto" chooses menu
 * when the entity has exactly one required enum and no other required fields, else form. When
 * `open` (default true), the new record's detail is opened after creating.
 */
export interface QuickAction {
  id: string;
  label: string;
  icon?: string;
  entity: string;
  /** `instant` creates the record straight from field defaults + `prefill` with NO form — the point
   *  of a quick action when every field has a default (e.g. "Start workout" mid-gym). */
  mode?: "auto" | "form" | "menu" | "instant";
  open?: boolean;
  /** Page to land on after creating. Defaults to the entity's detail page, then its list. Use this
   *  to jump straight into a custom view (a runner/tracker) instead of a settings screen. */
  openPage?: string;
  prefill?: Record<string, unknown>;
}

/**
 * The one record everything else in the app belongs to — the current trip, project, season, child.
 *
 * Declaring it gives the app a header chip that shows the selected record and a picker to switch it,
 * and gives every filter, binding, computed, action and function-valued view option a synchronous
 * `ctx.scope.<entity>` to read (a `Resolved` record or `undefined`). Nothing is filtered for you:
 * a page narrows itself with `filter: (e, ctx) => e.trip?.id === ctx.scope.trip?.id`, so a page can
 * still show everything. A relation field pointing at this entity defaults to the current scope on
 * create. The selection is per device and survives reloads. Contrast `ctx.params`, which is per page.
 */
export interface ScopeDef {
  /** The entity whose records are selectable. */
  entity: string;
  /** Chip label; defaults to the entity's label. */
  label?: string;
  /** When true the app asks for a selection before showing its pages, and keeps asking until one exists. */
  required?: boolean;
}

export interface AppDefinition {
  id: string;
  name: string;
  /** One emoji or short glyph for the app's launcher tile (e.g. "🏋"). Without it the tile shows a
   *  monogram of the name in a colour derived from the app, which cannot collide by accident. */
  icon?: string;
  version: string;
  schemaVersion: number;
  theme?: Theme;
  permissions?: PermissionManifest;
  /** An app-wide selected record ("current trip") that every function can read as `ctx.scope`. */
  scope?: ScopeDef;
  /** How the app presents its object types: a grid home or a tab bar. Default: grid when there are
   *  several entities, tabs when few. */
  nav?: "grid" | "tabs";
  /** Prominent create triggers shown in the action bar / grid home. When omitted, the shell
   *  auto-derives a "New <Entity>" per top-level entity. */
  quickActions?: QuickAction[];
  entities: Record<string, EntityDef>;
  pages: Page[];
  reminders?: Reminder[];
  migrations?: Migration[];
}

/**
 * The result of `defineApp`. It *is* the (normalized) definition — carrying all field data
 * and live function closures — plus a brand so the host can recognize it. The host reads
 * `.definition` off a loaded module; a `KartaApp` satisfies that by being its own definition.
 */
export interface KartaApp extends AppDefinition {
  readonly __kartaApp: true;
}
