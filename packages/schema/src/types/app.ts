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

export interface MapView {
  type: "map";
  entity: string;
  geo: string;
  title?: Binding;
  color?: Binding;
  filter?: FilterFn;
  filters?: FilterChip[];
}

export interface StepsView {
  type: "steps";
  entity: string;
  param?: string;
  /** Field key of the ordered list to walk. */
  list: string;
  text?: Binding;
}

export interface CustomView {
  type: "custom";
  entity: string;
  param?: string;
  render: (props: ViewProps) => ReactElement;
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

export interface Page {
  id: string;
  title: string;
  hidden?: boolean;
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
  mode?: "auto" | "form" | "menu";
  open?: boolean;
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
