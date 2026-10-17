// Zod validation of the *declarative* parts only (CLAUDE.md hard rule #4). Functions are
// typed by TS and pass through untouched — we never try to validate arbitrary code. Two
// phases:
//   1. `structureSchema.parse` — shape of fields / view layout / migrations / meta.
//   2. `checkReferences`      — referential integrity (entity + field cross-refs), references.ts.
//   3. `checkWords`           — the languages of the app's words (#302), words.ts.
//
// On success we return the *original* definition (with live function closures intact); the
// parsed output is only used to surface errors.

import { LINK_LIMITS, LINK_PARAM_NAME } from "./links.js";
import { z } from "zod";
import { ENUM_COLORS, FIELD_TYPES } from "./types/fields.js";
import { isWordsSchema, zLanguage, zWords, zWordsNonEmpty } from "./words-schema.js";

/** A value that must be a function (logic — not validated further). */
const zFn = z.custom<(...a: unknown[]) => unknown>(
  (v) => typeof v === "function",
  { message: "expected a function" },
);

/** A binding: a field-key string or a function. */
const zBinding = z.union([z.string(), zFn]);

/** Recursive field schema. `list.of` recurses; `default` may be a value or function. */
export const fieldSchema: z.ZodType<unknown> = z.lazy(() => {
  const common = {
    label: zWords.optional(),
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    help: zWords.optional(),
    placeholder: zWords.optional(),
    width: z.enum(["full", "half"]).optional(),
    default: z.any().optional(),
  };

  const text = z.object({ type: z.literal("text"), multiline: z.boolean().optional(), ...common });
  const richtext = z.object({ type: z.literal("richtext"), ...common });
  const number = z.object({
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    unit: zWords.optional(),
    integer: z.boolean().optional(),
    ...common,
  });
  const boolean = z.object({ type: z.literal("boolean"), ...common });
  // Whole minor units (KA-26): the amount is an integer of cents, and `min`/`max` are too.
  const money = z.object({
    type: z.literal("money"),
    currency: z.string().length(3).optional(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
    ...common,
  });
  const enumField = z.object({
    type: z.literal("enum"),
    options: z.array(z.string()).min(1),
    colors: z.record(z.string(), z.enum(ENUM_COLORS)).optional(),
    // The words for each option, keyed like `colors`. The option itself is what records store, so it
    // never changes by language; only what the person reads does (#302).
    labels: z.record(z.string(), zWords).optional(),
    control: z.enum(["segmented", "picker"]).optional(),
    ...common,
  });
  const tags = z.object({ type: z.literal("tags"), options: z.array(z.string()).optional(), labels: z.record(z.string(), zWords).optional(), ...common });
  const datetime = z.object({ type: z.literal("datetime"), precision: z.enum(["day", "minute"]).optional(), ...common });
  const duration = z.object({
    type: z.literal("duration"),
    unit: z.enum(["ms", "s", "min", "h", "d"]).optional(),
    ...common,
  });
  const url = z.object({ type: z.literal("url"), ...common });
  const geo = z.object({ type: z.literal("geo"), ...common });
  const media = z.object({
    type: z.literal("media"),
    accept: z.enum(["image", "video", "audio", "any"]).optional(),
    multiple: z.boolean().optional(),
    full: z.boolean().optional(),
    ...common,
  });
  const file = z.object({
    type: z.literal("file"),
    accept: z.string().optional(),
    folder: z.string().optional(),
    ...common,
  });
  const relation = z.object({
    type: z.literal("relation"),
    to: z.string().min(1),
    many: z.boolean().optional(),
    ...common,
  });
  // No `to`: a member is a person in this app's SPACE, not a row in an entity the app maintains.
  // That is the whole reason it is not a relation (KA-19).
  const member = z.object({
    type: z.literal("member"),
    many: z.boolean().optional(),
    ...common,
  });
  // `of` is a flat map of NAMED sub-fields. Two wrong shapes are common enough — and produce error
  // messages misleading enough — to be worth naming explicitly: without this, `of: "boolean"` reports
  // `of.type: Expected object, received string` and `of: { type: "object", fields }` reports
  // `of.fields.type: Invalid discriminator value…`, because Zod is parsing `type`/`fields` as
  // sub-field NAMES. Both descriptions send the reader (or the repair loop) after the wrong thing.
  // Recognise the two wrong shapes FIRST, so `of` keeps its `Record<string, Field>` output type
  // (checkFieldRelations walks it) while still reporting them accurately.
  const ofSchema = z.preprocess((val, ctx) => {
    if (typeof val === "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a list's `of` must be a map of named sub-fields, not a type name — a list of bare scalars is " +
          'not supported; wrap it, e.g. of: { value: { type: "boolean" } }, or use a `tags` field for strings',
      });
      return {}; // issue already recorded; an empty map keeps the inner parse from adding noise
    }
    if (val && typeof val === "object") {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.includes("type") && keys.includes("fields")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'a list\'s `of` is a flat map of named sub-fields — drop the { type: "object", fields } wrapper ' +
            'and put the sub-fields directly in `of`, e.g. of: { name: { type: "text" }, qty: { type: "number" } }',
        });
        return {};
      }
    }
    return val;
  }, z.record(fieldSchema));

  const list = z.object({
    type: z.literal("list"),
    of: ofSchema,
    ordered: z.boolean().optional(),
    lines: z.array(z.string().min(1)).optional(),
    ...common,
  });

  return z.discriminatedUnion("type", [
    text,
    richtext,
    number,
    boolean,
    money,
    enumField,
    tags,
    datetime,
    duration,
    url,
    geo,
    media,
    file,
    relation,
    member,
    list,
  ]);
});

const fieldGroupSchema = z.object({
  title: zWords.optional(),
  fields: z.array(z.string().min(1)).min(1, "a group needs at least one field"),
  collapsed: z.boolean().optional(),
  collapsible: z.boolean().optional(),
});

// `run` may be the isolate's placeholder for a function the host cannot see (a definition read out
// of the sandbox carries "__potyro_fn__" there); everywhere else it must be a real function.
const actionDefSchema = z
  .object({
    run: z.union([zFn, z.literal("__potyro_fn__")]),
    label: zWordsNonEmpty.optional(),
    icon: z.string().min(1).max(8).optional(),
    description: z.string().optional(),
    input: z.record(fieldSchema).optional(),
  })
  .strict();

// A computed that says what it is called (#310). `value` takes the sandbox's placeholder for the same
// reason an action's `run` does.
const computedDefSchema = z
  .object({
    value: z.union([zFn, z.literal("__potyro_fn__")]),
    label: zWords.optional(),
    labels: z.record(z.string(), zWords).optional(),
    format: zWordsNonEmpty.optional(),
  })
  .strict();

const entitySchema = z.object({
  label: zWords.optional(),
  icon: z.string().optional(),
  displayField: z.string().optional(),
  fields: z.record(fieldSchema),
  groups: z.array(fieldGroupSchema).optional(),
  computed: z.record(z.union([zFn, computedDefSchema])).optional(),
  actions: z.record(z.union([zFn, actionDefSchema])).optional(),
  editableBy: z.enum(["anyone", "creator", "app"]).optional(),
});

const quickActionSchema = z.object({
  id: z.string().min(1),
  label: zWordsNonEmpty,
  icon: z.string().optional(),
  entity: z.string().min(1),
  mode: z.enum(["auto", "form", "menu", "instant"]).optional(),
  open: z.boolean().optional(),
  openPage: z.string().optional(),
  prefill: z.record(z.any()).optional(),
});

const onOpenSchema = z.object({
  page: z.string(),
  param: z.record(z.string()).optional(),
});

const listDisplaySchema = z.object({
  primary: zBinding.optional(),
  secondary: zBinding.optional(),
  media: z.string().optional(),
  badges: z.array(z.string()).optional(),
  lead: z.enum(["monogram", "icon", "none"]).optional(),
  icon: zBinding.optional(),
});

const filterChipSchema = z.object({
  label: zWords,
  param: z.string(),
  from: z.string().optional(),
  multi: z.boolean().optional(),
  type: z.enum(["boolean", "geo", "text", "number"]).optional(),
  placeholder: zWords.optional(),
});

/** `Dynamic<Words>` (#133, #302): words, or a function of ctx the host evaluates. */
const zDynamicWords = z.union([zWords, zFn]);

const listView = z.object({
  type: z.literal("list"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: listDisplaySchema.optional(),
  rowActions: z.array(z.string()).optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicWords.optional(),
  param: z.string().optional(),
  filters: z.array(filterChipSchema).optional(),
  group: zBinding.optional(),
  collapsible: z.boolean().optional(),
  money: z.union([z.string(), z.literal(false)]).optional(),
});

const galleryView = z.object({
  type: z.literal("gallery"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  filters: z.array(filterChipSchema).optional(),
  display: listDisplaySchema.optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicWords.optional(),
  group: zBinding.optional(),
  collapsible: z.boolean().optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
  caption: z.enum(["below", "over"]).optional(),
});

const tableView = z.object({
  type: z.literal("table"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: z.object({ columns: z.array(z.string()) }).optional(),
  group: zBinding.optional(),
  collapsible: z.boolean().optional(),
});

const detailActionSchema = z.union([
  z.string(),
  z.object({
    label: zWords,
    navigate: z.object({ page: z.string(), param: z.record(z.string()).optional() }),
  }),
]);

/** A page's ground: a named treatment of the app's colour, or a picture from the app's files. */
const backdropSchema = z.union([z.enum(["plain", "wash", "dots", "grain"]), z.object({ image: z.string().min(1) }).strict()]);

const detailView = z.object({
  type: z.literal("detail"),
  entity: z.string(),
  param: z.string().optional(),
  sections: z
    .array(
      z
        .object({
          title: zWords.optional(),
          fields: z.array(z.string()).optional(),
          related: z
            .object({
              entity: z.string().min(1),
              via: z.string().min(1),
              view: z.enum(["list", "timeline", "chart"]).optional(),
              display: listDisplaySchema.optional(),
              date: z.string().optional(),
              value: z.string().optional(),
              by: z.enum(["day", "week", "month"]).optional(),
              limit: z.number().int().positive().optional(),
              onOpen: onOpenSchema.optional(),
            })
            .strict()
            .optional(),
          collapsible: z.boolean().optional(),
          collapsed: z.boolean().optional(),
        })
        .refine((s) => s.fields !== undefined || s.related !== undefined, { message: "a section needs `fields` or `related`" })
        .refine((s) => !s.related || s.related.view === undefined || s.related.view === "list" || s.related.date !== undefined, {
          message: "a related timeline or chart needs `date`",
        }),
    )
    .optional(),
  actions: z.array(detailActionSchema).optional(),
  media: z.union([z.string(), z.literal(false)]).optional(),
  cover: z.enum(["banner", "full", "background", "band", "none"]).optional(),
  facts: z.array(z.string()).optional(),
  primaryAction: detailActionSchema.optional(),
});

const calendarView = z.object({
  type: z.literal("calendar"),
  entity: z.string(),
  date: zBinding,
  title: zBinding.optional(),
  color: zBinding.optional(),
  filter: zFn.optional(),
});

/**
 * How a map frames itself when opened.
 *
 * `"remember"` (the default) reopens where the user last left it, framing the markers only on a
 * first-ever open. `"fit"` always frames the current markers. A literal `{ center, zoom }` opens at a
 * fixed spot — for a map that is about one place, not about wherever you happen to be.
 */
const cameraSchema = z.union([
  z.literal("remember"),
  z.literal("fit"),
  z.object({ center: z.tuple([z.number(), z.number()]), zoom: z.number() }),
  // `Dynamic<MapCamera>`: a function of ctx, evaluated by the host (#133 — the first dynamic option).
  zFn,
]);

const mapView = z.object({
  type: z.literal("map"),
  entity: z.string(),
  geo: z.string(),
  title: zBinding.optional(),
  color: zBinding.optional(),
  filter: zFn.optional(),
  filters: z.array(filterChipSchema).optional(),
  onOpen: onOpenSchema.optional(),
  camera: cameraSchema.optional(),
  // The "centre on me" button, on by default. `camera` cannot stand in for it — that is read when
  // the view opens, and this is the one thing that moves a map afterwards.
  locate: z.boolean().optional(),
  display: listDisplaySchema.optional(),
});

const stepsView = z.object({
  type: z.literal("steps"),
  entity: z.string(),
  param: z.string().optional(),
  list: z.string(),
  text: zBinding.optional(),
  /** Action key to run once every step is ticked — without it, finishing does nothing. */
  onFinish: z.string().optional(),
});

const boardView = z.object({
  type: z.literal("board"),
  entity: z.string(),
  column: z.string().min(1),
  columns: z.array(z.string()).min(1).optional(),
  display: listDisplaySchema.optional(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  onOpen: onOpenSchema.optional(),
  allowMove: z.boolean().optional(),
});

const checklistView = z.object({
  type: z.literal("checklist"),
  entity: z.string(),
  done: z.string().min(1),
  doneValue: z.string().optional(),
  text: zBinding.optional(),
  detail: zBinding.optional(),
  group: zBinding.optional(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  filters: z.array(filterChipSchema).optional(),
  hideDone: z.union([z.boolean(), z.literal("collapse")]).optional(),
  doneLabel: zWords.optional(),
  strike: z.boolean().optional(),
  donePlacement: z.enum(["sink", "stay"]).optional(),
  quickAdd: z
    .union([z.boolean(), z.object({ suggest: z.boolean().optional(), remember: z.array(z.string()).optional(), defaults: zFn.optional(), usuals: zFn.optional() }).strict()])
    .optional(),
  icon: zBinding.optional(),
  layout: z.enum(["rows", "tiles"]).optional(),
  editText: z.boolean().optional(),
  reorder: z.string().min(1).optional(),
  groupOrder: z.string().min(1).optional(),
  rowActions: z.array(z.string()).optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicWords.optional(),
});

const timelineView = z.object({
  type: z.literal("timeline"),
  entity: z.string(),
  date: zBinding,
  display: listDisplaySchema.optional(),
  color: z.string().optional(),
  groupBy: z.enum(["day", "week", "month"]).optional(),
  newest: z.enum(["first", "last"]).optional(),
  filter: zFn.optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicWords.optional(),
});

// A stats tile is a summary figure with a unit and a comparison; the one-of rules are the summary's.
const statItemSchema = z
  .object({
    label: zWordsNonEmpty,
    field: z.string().optional(),
    op: z.enum(["sum", "count", "avg", "max"]).optional(),
    value: zFn.optional(),
    unit: zWords.optional(),
    compare: z.object({ value: zFn, label: zWordsNonEmpty, as: z.enum(["difference", "percent"]).optional() }).strict().optional(),
  })
  .strict()
  .refine((v) => (v.value === undefined) !== (v.op === undefined), {
    message: 'a stat needs exactly one of `op` or `value: (rows, ctx) => …`',
  })
  .refine((v) => v.op === undefined || v.op === "count" || typeof v.field === "string", {
    message: 'a stat using "sum", "avg" or "max" needs a `field` to aggregate',
  });

const statsView = z.object({
  type: z.literal("stats"),
  entity: z.string(),
  filter: zFn.optional(),
  items: z.array(statItemSchema).min(1, "a stats view needs at least one item"),
});

// `series` is typed, not validated (rule 4); its presence is required, as `rows` is for aggregate.
const chartView = z.object({
  type: z.literal("chart"),
  entity: z.string(),
  filter: zFn.optional(),
  series: zFn,
  title: zDynamicWords.optional(),
  subtitle: zDynamicWords.optional(),
  emptyText: zDynamicWords.optional(),
});

// `rows` is a function, so it is typed rather than validated (CLAUDE.md rule 4) — but its PRESENCE
// is required, because an aggregate page without a fold has nothing to show and would render an
// empty screen that looks like a data problem rather than a missing declaration.
const aggregateView = z.object({
  type: z.literal("aggregate"),
  entity: z.string(),
  param: z.string().optional(),
  rows: zFn,
  title: zDynamicWords.optional(),
  emptyText: zDynamicWords.optional(),
});

const customView = z.object({
  type: z.literal("custom"),
  entity: z.string(),
  param: z.string().optional(),
  // Exactly one of these is required; the check lives on `pageSchema` because a discriminated union
  // only accepts plain objects, and `.refine()` would turn this into a ZodEffects.
  render: zFn.optional(),
  mount: zFn.optional(),
  onFinish: z.string().optional(),
});

/**
 * Views are STRICT: an unknown key is an error, not something quietly ignored.
 *
 * This is what makes VIEW_FIELDS honest. A silently-swallowed `zoomLevel: 12` is the exact shape of
 * the failure this boundary exists to stop — a generated view field that looks like it does
 * something, validates, and does nothing. Rejecting it turns an invented field into feedback the
 * agent actually receives (Edit mode's repair round replays validation errors).
 */
const viewSchema = z.discriminatedUnion("type", [
  listView.strict(),
  galleryView.strict(),
  tableView.strict(),
  detailView.strict(),
  calendarView.strict(),
  mapView.strict(),
  stepsView.strict(),
  checklistView.strict(),
  boardView.strict(),
  timelineView.strict(),
  statsView.strict(),
  chartView.strict(),
  aggregateView.strict(),
  customView.strict(),
]);

/**
 * The declarable surface of each built-in view — what an app module can actually *say* about a view,
 * derived from the schemas above rather than written out a second time.
 *
 * This is the boundary between "fixable by editing the app" and "the host's behaviour". The
 * Edit-mode agent is handed the entry for the view it was pointed at, so it can tell the user a
 * request is out of reach instead of inventing an app-level change that cannot work. Deriving it
 * here is the point: a hand-maintained copy would drift from what is actually enforced, and the
 * agent would confidently reason from a surface that no longer exists.
 *
 * Optional fields are suffixed `?`, matching how they read in the docs.
 */
/**
 * What a PAGE can declare, as opposed to its view. Same purpose as `VIEW_FIELDS`: the Edit-mode
 * agent is told the real boundary, and `summary` lives here rather than on the eight view types.
 */
export const PAGE_FIELDS: readonly string[] = Object.freeze(["title", "description?", "icon?", "hidden?", "summary?", "actions?", "primaryAction?", "background?", "layout?", "link?"]);

export const VIEW_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    viewSchema.options.map((option) => {
      const shape = option.shape as Record<string, z.ZodTypeAny>;
      const kind = (shape.type as z.ZodLiteral<string>).value;
      const fields = Object.keys(shape)
        .filter((k) => k !== "type")
        .map((k) => (shape[k]!.isOptional() ? `${k}?` : k));
      return [kind, Object.freeze(fields)];
    }),
  ),
);

/** A slot's schema says "words" (#302): the words schema itself, or a union with it (`Dynamic<Words>`). */
function takesWords(schema: z.ZodTypeAny): boolean {
  const inner = schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodTypeAny) : schema;
  if (isWordsSchema(inner)) return true;
  return inner instanceof z.ZodUnion && (inner.options as z.ZodTypeAny[]).some((o) => isWordsSchema(o));
}

/**
 * The options of each view that hold words (`emptyText`, a chart's `title`…), derived from the view
 * schemas like `VIEW_FIELDS`. The runtime resolves a `Dynamic<Words>` option's map through it — and
 * only these: a `camera` is an object too, and is not words.
 */
export const VIEW_WORDS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    viewSchema.options.map((option) => {
      const shape = option.shape as Record<string, z.ZodTypeAny>;
      const kind = (shape.type as z.ZodLiteral<string>).value;
      return [kind, Object.freeze(Object.keys(shape).filter((k) => takesWords(shape[k]!)))];
    }),
  ),
);

/**
 * One figure shown above a page's view — a monthly total, a head count, a running average.
 *
 * Two forms, mirroring how `filters` (declarative chips) and `filter` (a function) already coexist:
 * `{ field, op }` covers the common case and is the only form the structural editor can edit and the
 * only one that ports to another framework; `value` is a function for everything else. `op: "count"`
 * needs no field — it counts rows.
 */
const summaryValueSchema = z
  .object({
    label: zWordsNonEmpty,
    field: z.string().optional(),
    op: z.enum(["sum", "count", "avg", "max"]).optional(),
    value: zFn.optional(),
  })
  .strict()
  .refine((v) => (v.value === undefined) !== (v.op === undefined), {
    message: 'a summary needs exactly one of `op` or `value: (rows, ctx) => …`',
  })
  .refine((v) => v.op === undefined || v.op === "count" || typeof v.field === "string", {
    message: 'a summary using "sum", "avg" or "max" needs a `field` to aggregate',
  })
  .refine((v) => v.value === undefined || v.field === undefined, {
    message: "a summary with a `value` function shouldn't also name a `field`",
  });

// Strict for the same reason views are: a misspelled `summaries:` that is silently ignored looks
// exactly like a feature that doesn't work.
const layoutItemSchema = z
  .object({
    view: viewSchema,
    title: zWords.optional(),
    span: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    collapsible: z.boolean().optional(),
  })
  .strict();

const layoutSchema = z
  .object({
    type: z.enum(["stack", "grid", "split", "tabs"]),
    items: z.array(layoutItemSchema).min(1, "a layout needs at least one item"),
  })
  .strict()
  .superRefine((layout, ctx) => {
    if (layout.type === "split" && layout.items.length !== 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "a split layout has exactly two items: the list on the left, the detail on the right" });
    }
    if (layout.type === "split" && layout.items.length === 2 && (layout.items[1]!.view as { type?: string }).type !== "detail") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", 1, "view"], message: "a split layout's second item is the detail view the rows fill" });
    }
    if (layout.type === "tabs") {
      layout.items.forEach((item, i) => {
        if (!item.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", i, "title"], message: "a tabs layout names each item — its title is the tab" });
      });
    }
  });

/** A custom view needs exactly one way to render. Checked for the page's view and every layout item. */
function customViewIssue(view: unknown): string | null {
  const v = view as { type?: string; render?: unknown; mount?: unknown };
  if (v.type !== "custom") return null;
  return (v.render === undefined) === (v.mount === undefined)
    ? "a custom view needs exactly one of `render` (a React element) or `mount` (el, props) => cleanup"
    : null;
}

/** A button in the page's chrome: its own label, and a real function to run (hard rule #1). */
const pageActionSchema = z.object({
  label: zWordsNonEmpty,
  icon: z.string().min(1).max(8).optional(),
  run: zFn,
  when: zFn.optional(),
});

const pageSchema = z
  .object({
    id: z.string().min(1),
    title: zDynamicWords,
    description: zWords.optional(),
    icon: z.string().min(1).max(8).optional(),
    hidden: z.boolean().optional(),
    summary: z.array(summaryValueSchema).optional(),
    add: z.number().int().min(0).optional(),
    actions: z.array(pageActionSchema).optional(),
    primaryAction: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
    background: backdropSchema.optional(),
    view: viewSchema.optional(),
    layout: layoutSchema.optional(),
    fullscreen: z.boolean().optional(),
    // What a link may open the page with (docs/24 §11): plain names, so they read the same in a URL.
    link: z
      .object({ params: z.array(z.string().regex(LINK_PARAM_NAME, "a link param is a plain name: letters, digits and _")).max(LINK_LIMITS.params).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((page, ctx) => {
    // A page is one view or a layout of several — never both, never neither (#105).
    if ((page.view === undefined) === (page.layout === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["view"], message: "a page declares either `view` or `layout`" });
      return;
    }
    if (page.view) {
      const issue = customViewIssue(page.view);
      if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["view"], message: issue });
    }
    page.layout?.items.forEach((item, i) => {
      const issue = customViewIssue(item.view);
      if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["layout", "items", i, "view"], message: issue });
    });
  });

const reminderSchema = z.object({
  id: z.string().min(1),
  entity: z.string(),
  when: zFn,
  title: zBinding,
  body: zBinding.optional(),
});

const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/**
 * The ops, discriminated on `op` so a wrong one says WHICH ones exist.
 *
 * A plain `z.union` reported every malformed step as `Invalid input` and nothing else — no path, no
 * hint, nothing to act on. That message reached a real user as
 * `migrations.0.steps.0: Invalid input`, and it also reached the repair model, which had no more to
 * go on than they did. A discriminated union answers with
 * `op: Invalid discriminator value. Expected 'addField' | 'dropField' | ...`, which is the whole
 * list of what is allowed — and for a recognised op it points at the missing key by name.
 *
 * Note there is no `addEntity`, and there does not need to be: a new entity has no records yet.
 * Models invent one anyway, which is exactly the case the message above now answers.
 */
const migrationOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addField"), entity: z.string(), field: z.string(), default: z.any().optional() }),
  z.object({ op: z.literal("dropField"), entity: z.string(), field: z.string() }),
  z.object({ op: z.literal("renameField"), entity: z.string(), from: z.string(), to: z.string() }),
  z.object({ op: z.literal("changeType"), entity: z.string(), field: z.string(), to: z.string(), via: zFn }),
  z.object({ op: z.literal("renameEntity"), from: z.string(), to: z.string() }),
  z.object({ op: z.literal("setDefaultForExisting"), entity: z.string(), field: z.string(), value: z.any() }),
  z.object({ op: z.literal("addRelation"), entity: z.string(), field: z.string(), to: z.string(), many: z.boolean().optional() }),
  z.object({ op: z.literal("addRecord"), entity: z.string(), id: z.string().min(1), values: z.record(z.any()) }),
]);

// Wrapping the discriminated union in a `z.union` with the `{ transform }` branch would throw its
// message away again — a union reports its own failure, not its members'. So the branch is chosen
// here, by hand, and the good message is passed through.
const migrationStepSchema = z.any().superRefine((v, ctx) => {
  if (v && typeof v === "object" && !Array.isArray(v) && "transform" in (v as object)) {
    if (typeof (v as { transform: unknown }).transform !== "function") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "transform must be a function" });
    }
    return;
  }
  // `type` instead of `op`, observed from a real edit. Understandable: every FIELD in this schema is
  // keyed by `type`, and a migration step is the one place that word is wrong. Saying so beats
  // reporting a missing `op` and leaving the reader to spot that the value they wrote is sitting
  // under the wrong key — which is the difference between a one-word fix and another round trip.
  const step = v as { op?: unknown; type?: unknown } | null;
  if (step && typeof step === "object" && step.op === undefined && typeof step.type === "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["op"],
      message: `a migration step names its operation with \`op\`, not \`type\` — write { op: "${step.type}", ... }`,
    });
    return;
  }
  const parsed = migrationOpSchema.safeParse(v);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: issue.path });
});

const migrationSchema = z.object({
  // The APP VERSION this migration moves data between — the `version` field, semver, not
  // `schemaVersion`. `migrateOnLoad` walks the chain by matching `from` against the version the
  // stored data was written under, so `{ from: "1", to: "2" }` is not merely the wrong style: it
  // matches nothing, runs never, and leaves the records it was written to rescue exactly as they
  // were. Silently. Requiring semver here turns that into an error someone can see.
  from: z.string().regex(SEMVER, "migration `from` must be the app version it migrates from (semver, e.g. 1.0.0)"),
  to: z.string().regex(SEMVER, "migration `to` must be the app version it migrates to (semver, e.g. 1.1.0)"),
  steps: z.array(migrationStepSchema),
});

const networkPermissionSchema = z.union([z.boolean(), z.object({ hosts: z.array(z.string()).optional(), rooms: z.boolean().optional() })]);

const permissionSchema = z.object({
  // Declared, not yet enforced — the consent prompt is KA-23. See PermissionManifest.
  sync: z.boolean().optional(),
  camera: z.boolean().optional(),
  filesystem: z.boolean().optional(),
  notifications: z.boolean().optional(),
  geo: z.boolean().optional(),
  haptics: z.boolean().optional(),
  network: networkPermissionSchema.optional(),
  ai: z.boolean().optional(),
  speech: z.boolean().optional(),
});


const httpsUrl = z
  .string()
  .url("must be a full URL")
  .refine((u) => u.startsWith("https://"), "must be an https URL");

// Strict: an unknown key is an error, not dropped. The one thing that must never be written here is
// a key (#213), and "apiKey: …" silently ignored would still be a key sitting in the app's source.
const sourceSchema = z
  .object({
    label: z.string().optional(),
    description: z.string().optional(),
    endpoint: httpsUrl,
    docs: httpsUrl.optional(),
    auth: z
      .union([
        z.object({ header: z.string().min(1), prefix: z.string().optional() }).strict(),
        z.object({ query: z.string().min(1) }).strict(),
      ])
      .optional(),
  })
  .strict();

export const structureSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
  name: zWordsNonEmpty,
  icon: z.string().min(1).max(8).optional(),
  version: z.string().regex(SEMVER, "version must be semver (e.g. 1.0.0)"),
  schemaVersion: z.number().int().min(1),
  // The language the app's words are written in, and every language it carries (#302). Checked
  // against the maps by `checkWords`, after this.
  language: zLanguage.optional(),
  languages: z.array(zLanguage).min(1).optional(),
  theme: z.object({ accent: z.string().optional(), background: backdropSchema.optional() }).optional(),
  // A function, or the sealed box's placeholder for one (a definition read out of it).
  tile: z.union([zFn, z.literal("__potyro_fn__")]).optional(),
  category: z.string().min(1).max(24).regex(/^[a-z][a-z0-9-]*$/, "a category is one lowercase word, like games").optional(),
  permissions: permissionSchema.optional(),
  nav: z.enum(["grid", "tabs"]).optional(),
  scope: z.object({ entity: z.string().min(1), label: zWords.optional(), required: z.boolean().optional() }).optional(),
  quickActions: z.array(quickActionSchema).optional(),
  entities: z.record(entitySchema),
  pages: z.array(pageSchema),
  reminders: z.array(reminderSchema).optional(),
  migrations: z.array(migrationSchema).optional(),
  sources: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_-]*$/, "a source name is a short key, like places"), sourceSchema).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Referential integrity (phase 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The fields of a `ctx.ui.form` (#112), checked like an entity's: the same schema, so a form field
 * that validates here renders with the same control it would in a record form. Returns the problems.
 */
export function checkFormFields(fields: unknown, entities: readonly string[]): string[] {
  if (fields == null || typeof fields !== "object" || Array.isArray(fields)) return ["ui.form needs `fields`: an object of field definitions"];
  const issues: string[] = [];
  for (const [key, field] of Object.entries(fields as Record<string, unknown>)) {
    const parsed = fieldSchema.safeParse(field);
    if (!parsed.success) {
      issues.push(`ui.form field "${key}": ${parsed.error.issues.map((i) => `${i.path.join(".") || "type"} ${i.message}`).join("; ")}`);
      continue;
    }
    const f = field as { type: string; to?: string };
    if (f.type === "relation" && f.to && !entities.includes(f.to)) issues.push(`ui.form field "${key}" relates to unknown entity "${f.to}"`);
  }
  return issues;
}

/**
 * One structure issue as a line: `path: message`. Zod's wrong-discriminator message names the legal
 * values but not the one it got, so the value is appended — `… got "lisst"` (#76). A repair round
 * forwards these words to the model, which must SEARCH for the line it wrote: naming the value lets
 * it anchor on that line instead of hunting for it from a path.
 */
export function describeIssue(issue: z.ZodIssue, input: unknown): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  if (issue.code === "invalid_union_discriminator") {
    let at: unknown = input;
    for (const key of issue.path) at = at != null && typeof at === "object" ? (at as Record<string | number, unknown>)[key] : undefined;
    if (at !== undefined) return `${path}: ${issue.message}, got ${JSON.stringify(at)}`;
  }
  return `${path}: ${issue.message}`;
}

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid app definition:\n  - ${issues.join("\n  - ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

// Phase 2 lives in references.ts; re-exported so callers keep one import.
export { checkReferences } from "./references.js";
