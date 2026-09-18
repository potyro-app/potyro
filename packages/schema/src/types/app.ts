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
  /** The heading folds it on the record page, remembered per device (#108). */
  collapsible?: boolean;
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
  /** Who may change or delete a record (KA-21). `"creator"`: only the person who added it — anyone
   *  else's edit does not take. Default `"anyone"`; means nothing in an app nobody else uses. */
  editableBy?: "anyone" | "creator";
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
  /** Rows under a heading per value: a field key (enum, tag, relation) or `(r) => …` (#108). */
  group?: Binding;
  /** Headings fold their groups, remembered per device. Needs `group`. */
  collapsible?: boolean;
  /** The `money` field shown down each row with the total underneath — the entity's first by
   *  default (KA-26). Name another, or `false` for none. */
  money?: string | false;
}

export interface GalleryView {
  type: "gallery";
  entity: string;
  filter?: FilterFn;
  sort?: SortFn;
  display?: ListDisplay;
  onOpen?: OnOpen;
  emptyText?: Dynamic<string>;
  /** Rows under a heading per value: a field key (enum, tag, relation) or `(r) => …` (#108). */
  group?: Binding;
  /** Headings fold their groups, remembered per device. Needs `group`. */
  collapsible?: boolean;
}

export interface TableView {
  type: "table";
  entity: string;
  filter?: FilterFn;
  sort?: SortFn;
  display?: { columns: string[] };
  /** Rows under a heading per value: a field key (enum, tag, relation) or `(r) => …` (#108). */
  group?: Binding;
  /** Headings fold their groups, remembered per device. Needs `group`. */
  collapsible?: boolean;
}

/** An action reference in a detail view: an action key, or an inline navigate button. */
export type DetailAction =
  | string
  | { label: string; navigate: { page: string; param?: Record<string, string> } };

export interface DetailSection {
  title?: string;
  fields: string[];
  /** The heading folds it, remembered per device (#108). */
  collapsible?: boolean;
  /** Start folded; implies `collapsible`. */
  collapsed?: boolean;
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
  /**
   * What a pin's popup shows besides its title — the same shape a list row uses: a photo, a second
   * line, tags. A name on its own rarely answers "is this the one I meant?"; the photo usually does.
   * The popup also offers the whole record, which opens OVER the map rather than navigating away
   * from it, so you never lose the place you were looking at.
   */
  display?: ListDisplay;
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
  /** Where a ticked row goes. `"sink"` (default) keeps it in its own group, at the bottom, so what is
   *  left to do stays together. `"stay"` leaves it exactly where it is. `hideDone` still wins. */
  donePlacement?: "sink" | "stay";
  /** An input at the bottom: type, Enter, next — creates a record with the text as its display field. */
  quickAdd?: boolean;
  /** Tap a row's text to rename it in place. Off by default: a row whose text is computed is not editable. */
  editText?: boolean;
  /** The number field holding a row's position; with it, rows can be dragged (within a group and into
   *  another one, which sets `group`). Without it, order is `sort`'s business and rows do not drag. */
  reorder?: string;
  /** When `group` names a RELATION field, the groups are records: their headings can be renamed,
   *  reordered and deleted from the list, and a new one added — `groupOrder` is the number field on
   *  that entity holding a group's position. */
  groupOrder?: string;
  rowActions?: string[];
  /** Where the row's chevron goes. Without it a row has no detail. */
  onOpen?: OnOpen;
  emptyText?: Dynamic<string>;
}

/** Records in columns by an enum field; dragging a card, or its Move to, patches that field (#107). */
export interface BoardView {
  type: "board";
  entity: string;
  /** The enum field whose options are the columns. */
  column: string;
  /** Which options, in order. Default: all. */
  columns?: string[];
  display?: ListDisplay;
  filter?: FilterFn;
  sort?: SortFn;
  onOpen?: OnOpen;
  /** `false` makes the board read-only. */
  allowMove?: boolean;
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

/** Records on a rail by date, newest first, under sticky day, week or month headings (#110). */
export interface TimelineView {
  type: "timeline";
  entity: string;
  /** A date field, or a function returning a Date. */
  date: Binding;
  display?: ListDisplay;
  /** An enum field: each dot wears its option's colour. */
  color?: string;
  groupBy?: "day" | "week" | "month";
  newest?: "first" | "last";
  filter?: FilterFn;
  onOpen?: OnOpen;
  emptyText?: Dynamic<string>;
}

/** A stats tile (#109): a summary figure, optionally compared with the same figure for an earlier period. */
export interface StatItem extends SummaryValue {
  /** After the number: "kg", "min". A `field`'s own unit is used when this is left out. */
  unit?: string;
  /** `value` is the earlier figure; the tile reads "▲ 1 more than {label}" (or "6% less" with `as: "percent"`). */
  compare?: { value: (rows: Resolved[], ctx: Ctx) => unknown; label: string; as?: "difference" | "percent" };
}

/** Big numbers folded out of the page's rows (#109). */
export interface StatsView {
  type: "stats";
  entity: string;
  filter?: FilterFn;
  items: StatItem[];
}

/** One bar: its axis label, its value, and optionally the text to show for it ("5 sessions"). */
export interface ChartPoint {
  label: string;
  value: number;
  text?: string;
}

/** A bar chart of the points `series` folds out of the page's rows (#109). */
export interface ChartView {
  type: "chart";
  entity: string;
  filter?: FilterFn;
  series: (rows: Resolved[], ctx: Ctx) => ChartPoint[] | Promise<ChartPoint[]>;
  title?: Dynamic<string>;
  subtitle?: Dynamic<string>;
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
  | BoardView
  | TimelineView
  | StatsView
  | ChartView
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
  "board",
  "timeline",
  "stats",
  "chart",
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

/** One block of a page `layout` (#105): any view, with an optional title above it. */
export interface LayoutItem {
  view: View;
  title?: string;
  /** In a `grid`: columns out of three on a wide screen (two on a tablet, one on a phone). */
  span?: 1 | 2 | 3;
  /** In a `stack`: folds behind its title; the fold is remembered per device. */
  collapsible?: boolean;
}

/**
 * Several views on one page (#105). `stack`: a column, each item under its title. `grid`: bento
 * columns by `span`, stacking on a phone. `split`: two items — a list on the left whose rows fill
 * the right item (a `detail`) instead of navigating; on a phone the rows navigate as usual.
 * `tabs`: one item at a time, chosen by a segmented control from the items' titles.
 * Every item is an ordinary view, so a layout renders for an untrusted app exactly as its views do.
 */
export interface PageLayout {
  type: "stack" | "grid" | "split" | "tabs";
  items: LayoutItem[];
}

export const LAYOUT_TYPES = ["stack", "grid", "split", "tabs"] as const;

export interface Page {
  id: string;
  /** The tab label. A function of ctx can name the selection: `(ctx) => \`Places in ${ctx.scope.trip?.city ?? "…"}\``. */
  title: Dynamic<string>;
  /** One emoji or short glyph for the page's tab (#111). Without it the tab shows the entity's icon. */
  icon?: string;
  hidden?: boolean;
  /** Figures shown above the view, computed over the page's filtered rows. */
  summary?: SummaryValue[];
  /** The page's view — or, for a page with a `layout`, its first item's view (filled in by `defineApp`). */
  view: View;
  /** Several views on one page (#105). A page declares EITHER `view` OR `layout`. */
  layout?: PageLayout;
}

/** A page as an app declares it: `view` or `layout` (one of the two; `defineApp` fills `view` from a
 *  layout's first item). One object type rather than a union, so the functions inside a page's
 *  views keep their contextual types. */
export type PageInput = Omit<Page, "view"> & { view?: View };

/** What `defineApp` accepts: pages may carry a `view` or a `layout`. */
export type AppInput = Omit<AppDefinition, "pages"> & { pages: PageInput[] };

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
  /** This app writes to a document that leaves the device (ADR D8, KA-23). The shell asks before an
   *  app you did not write syncs; declaring it changes what that question says, not whether it is
   *  asked. Refusing leaves the app local-only. Full rules: docs/07. */
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
