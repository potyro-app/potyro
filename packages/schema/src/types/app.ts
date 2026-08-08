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
export type SortFn = (a: Resolved, b: Resolved) => number;
export type BindingFn<T = Value> = (record: Resolved, ctx: Ctx) => T;
export type ReminderWhen = (record: Resolved, ctx: Ctx) => Date | null;

/** A view binding is either a field-key string or a function computing the value. */
export type Binding<T = Value> = string | BindingFn<T>;

// ─────────────────────────────────────────────────────────────────────────────
// Entities
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityDef {
  label?: string;
  /** Optional glyph/emoji for launcher tiles + quick-action buttons (e.g. "🏋"). */
  icon?: string;
  displayField?: string;
  fields: Record<string, Field>;
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
  emptyText?: string;
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
  emptyText?: string;
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
  camera?: MapCamera;
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
  | CustomView;

export const VIEW_TYPES = [
  "list",
  "gallery",
  "table",
  "detail",
  "calendar",
  "map",
  "steps",
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
  title: string;
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

export interface AppDefinition {
  id: string;
  name: string;
  version: string;
  schemaVersion: number;
  theme?: Theme;
  permissions?: PermissionManifest;
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
