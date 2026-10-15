// `potyro` — the public authoring package (WP1, the gate). App modules import from here.

export { defineApp, isPotyroApp } from "./defineApp.js";
export { f } from "./fields.js";
export { humanizeKey } from "./humanize.js";
export { actionInfo, actionInputProblem, actionRun, type ActionInfo } from "./actions.js";
export { computedInfo, computedRun, type ComputedInfo } from "./computed.js";
export { formatMoney, parseMoney, splitEvenly, splitByShares, shareOf, minorDigits } from "./money.js";
export { fieldValueProblem, recordValueProblem, sanitiseListRows, FieldValueError, type ValueCheck } from "./values.js";
export { structureSchema, checkReferences, checkFormFields, describeIssue, ValidationError, VIEW_FIELDS, VIEW_WORDS, PAGE_FIELDS } from "./validate.js";

// ---- an app's words in the person's language (#302, docs/20) ----
export type { Language, Words, WordsMap } from "./types/words.js";
export type { Localized } from "./types/localized.js";
export { zWords, zWordsNonEmpty, zLanguage, LANGUAGE_TAG, isWordsMap, plainWords } from "./words-schema.js";
export {
  walkWords,
  wordSlots,
  wordsPathText,
  appLanguages,
  pickLanguage,
  word,
  localize,
  localizeFields,
  checkWords,
  wordGaps,
  type WordsPath,
  type WordsVisitor,
  type WordsGap,
} from "./words.js";

// ---- shared value types ----
export type { Id, Value, PotyroRecord, Resolved, MediaRef, Geo, FileInfo, FileRef, FileOrigin } from "./types/core.js";

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
  MoneyField,
  EnumField,
  EnumColor,
  TagsField,
  DateTimeField,
  DurationField,
  UrlField,
  GeoField,
  MediaField,
  FileField,
  RelationField,
  MemberField,
  ListField,
} from "./types/fields.js";
export { FIELD_TYPES, ENUM_COLORS } from "./types/fields.js";

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
  UiItem,
  UiProgress,
  CtxMedia,
  CtxFiles,
  CtxFormat,
  FormatDateOptions,
  FormatNumberOptions,
  CameraCapability,
  LiveCamera,
  LiveCameraOptions,
  LiveCameraStop,
  LiveCameraFailure,
  LiveFrameInfo,
  NotificationCapability,
  GeoCapability,
  HapticsCapability,
  FileCapability,
  NetworkCapability,
  AiCapability,
  AiShape,
  AiLeaf,
  AiImage,
  AiExtractRequest,
} from "./types/ctx.js";
export type { Face, FaceEye, FaceExpressions, FaceOptions, FacePoint, FacesFailure } from "./types/faces.js";
export type { TileContent } from "./types/tile.js";

// ---- app definition ----
export type {
  AppDefinition,
  PotyroApp,
  EntityDef,
  FieldGroup,
  LayoutItem,
  PageLayout,
  PageInput,
  AppInput,
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
  Dynamic,
  ScopeDef,
  SourceDef,
  SummaryValue,
  SummaryOp,
  StepsView,
  ChecklistView,
  BoardView,
  TimelineView,
  StatsView,
  StatItem,
  ChartView,
  ChartPoint,
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
  ComputedDef,
  ActionFn,
  ActionDef,
  FilterFn,
  SortFn,
  BindingFn,
  Binding,
  ReminderWhen,
} from "./types/app.js";
export { VIEW_TYPES } from "./types/app.js";

// ---- runtime contracts (implemented by @potyro/runtime, consumed by @potyro/views) ----
export type { Runtime, ViewProps, CustomViewComponent, CustomViewMount, Unsubscribe } from "./types/runtime.js";

// ---- opt-in precise-typing helpers (author may supply an explicit entity shape) ----
export type {
  RecordBase,
  EntityShape,
  EntitiesShape,
  ResolvedFields,
  LogicRecord,
  RecordFor,
  AiValue,
} from "./types/infer.js";

export { LAYOUT_TYPES } from "./types/app.js";
export { resolveView, basePageId, layoutItemId } from "./layout.js";

// ---- names from before the rename (#114) ----
// Apps written while the product was still the codename import these. They keep working forever:
// an app module is a saved source on someone's device, not something we can rewrite.
export { isPotyroApp as isKartaApp } from "./defineApp.js";
export type { PotyroRecord as KartaRecord } from "./types/core.js";
export type { PotyroApp as KartaApp } from "./types/app.js";
