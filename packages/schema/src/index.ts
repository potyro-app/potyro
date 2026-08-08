// `karta` — the public authoring package (WP1, the gate). App modules import from here.

export { defineApp, isKartaApp } from "./defineApp.js";
export { f } from "./fields.js";
export { structureSchema, checkReferences, ValidationError, VIEW_FIELDS, PAGE_FIELDS } from "./validate.js";

// ---- shared value types ----
export type { Id, Value, KartaRecord, Resolved, MediaRef, Geo } from "./types/core.js";

// ---- field types ----
export type {
  Field,
  FieldType,
  FieldCommon,
  DefaultValue,
  TextField,
  RichTextField,
  NumberField,
  BooleanField,
  EnumField,
  TagsField,
  DateTimeField,
  DurationField,
  UrlField,
  GeoField,
  MediaField,
  RelationField,
  MemberField,
  ListField,
} from "./types/fields.js";
export { FIELD_TYPES } from "./types/fields.js";

// ---- ctx surface ----
export type {
  Ctx,
  Caps,
  Person,
  Member,
  Space,
  SpaceRole,
  QuerySpec,
  CtxStorage,
  CtxUi,
  CtxMedia,
  CameraCapability,
  NotificationCapability,
  GeoCapability,
  HapticsCapability,
  FileCapability,
  NetworkCapability,
} from "./types/ctx.js";

// ---- app definition ----
export type {
  AppDefinition,
  KartaApp,
  EntityDef,
  Page,
  View,
  ViewType,
  ListView,
  GalleryView,
  TableView,
  DetailView,
  CalendarView,
  MapView,
  MapCamera,
  SummaryValue,
  SummaryOp,
  StepsView,
  AggregateView,
  AggregateRow,
  CustomView,
  ListDisplay,
  DetailSection,
  DetailAction,
  FilterChip,
  OnOpen,
  Reminder,
  Migration,
  MigrationStep,
  PermissionManifest,
  NetworkPermission,
  Theme,
  Computed,
  ActionFn,
  FilterFn,
  SortFn,
  BindingFn,
  Binding,
  ReminderWhen,
} from "./types/app.js";
export { VIEW_TYPES } from "./types/app.js";

// ---- runtime contracts (implemented by @karta/runtime, consumed by @karta/views) ----
export type { Runtime, ViewProps, CustomViewComponent, CustomViewMount, Unsubscribe } from "./types/runtime.js";

// ---- opt-in precise-typing helpers (author may supply an explicit entity shape) ----
export type {
  RecordBase,
  EntityShape,
  EntitiesShape,
  ResolvedFields,
  LogicRecord,
  RecordFor,
} from "./types/infer.js";
