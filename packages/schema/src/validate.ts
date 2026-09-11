// Zod validation of the *declarative* parts only (CLAUDE.md hard rule #4). Functions are
// typed by TS and pass through untouched — we never try to validate arbitrary code. Two
// phases:
//   1. `structureSchema.parse` — shape of fields / view layout / migrations / meta.
//   2. `checkReferences`      — referential integrity (entity + field cross-refs).
//
// On success we return the *original* definition (with live function closures intact); the
// parsed output is only used to surface errors.

import { z } from "zod";
import { FIELD_TYPES } from "./types/fields.js";
import type { AppDefinition, EntityDef } from "./types/app.js";
import type { Field } from "./types/fields.js";

/** A value that must be a function (logic — not validated further). */
const zFn = z.custom<(...a: unknown[]) => unknown>(
  (v) => typeof v === "function",
  { message: "expected a function" },
);

/** A binding: a field-key string or a function. */
const zBinding = z.union([z.string(), zFn]);

/** Recursive field schema. `list.of` recurses; `default` may be a value or function. */
const fieldSchema: z.ZodType<unknown> = z.lazy(() => {
  const common = {
    label: z.string().optional(),
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    default: z.any().optional(),
  };

  const text = z.object({ type: z.literal("text"), multiline: z.boolean().optional(), ...common });
  const richtext = z.object({ type: z.literal("richtext"), ...common });
  const number = z.object({
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    integer: z.boolean().optional(),
    ...common,
  });
  const boolean = z.object({ type: z.literal("boolean"), ...common });
  const enumField = z.object({
    type: z.literal("enum"),
    options: z.array(z.string()).min(1),
    ...common,
  });
  const tags = z.object({ type: z.literal("tags"), options: z.array(z.string()).optional(), ...common });
  const datetime = z.object({ type: z.literal("datetime"), ...common });
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
    ...common,
  });

  return z.discriminatedUnion("type", [
    text,
    richtext,
    number,
    boolean,
    enumField,
    tags,
    datetime,
    duration,
    url,
    geo,
    media,
    relation,
    member,
    list,
  ]);
});

const entitySchema = z.object({
  label: z.string().optional(),
  icon: z.string().optional(),
  displayField: z.string().optional(),
  fields: z.record(fieldSchema),
  computed: z.record(zFn).optional(),
  actions: z.record(zFn).optional(),
});

const quickActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
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
});

const filterChipSchema = z.object({
  label: z.string(),
  param: z.string(),
  from: z.string().optional(),
  multi: z.boolean().optional(),
  type: z.enum(["boolean", "geo"]).optional(),
});

/** `Dynamic<string>` (#133): a literal, or a function of ctx the host evaluates. */
const zDynamicString = z.union([z.string(), zFn]);

const listView = z.object({
  type: z.literal("list"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: listDisplaySchema.optional(),
  rowActions: z.array(z.string()).optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicString.optional(),
  param: z.string().optional(),
  filters: z.array(filterChipSchema).optional(),
});

const galleryView = z.object({
  type: z.literal("gallery"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: listDisplaySchema.optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: zDynamicString.optional(),
});

const tableView = z.object({
  type: z.literal("table"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: z.object({ columns: z.array(z.string()) }).optional(),
});

const detailActionSchema = z.union([
  z.string(),
  z.object({
    label: z.string(),
    navigate: z.object({ page: z.string(), param: z.record(z.string()).optional() }),
  }),
]);

const detailView = z.object({
  type: z.literal("detail"),
  entity: z.string(),
  param: z.string().optional(),
  sections: z.array(z.object({ title: z.string().optional(), fields: z.array(z.string()) })).optional(),
  actions: z.array(detailActionSchema).optional(),
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

// `rows` is a function, so it is typed rather than validated (CLAUDE.md rule 4) — but its PRESENCE
// is required, because an aggregate page without a fold has nothing to show and would render an
// empty screen that looks like a data problem rather than a missing declaration.
const aggregateView = z.object({
  type: z.literal("aggregate"),
  entity: z.string(),
  param: z.string().optional(),
  rows: zFn,
  title: zDynamicString.optional(),
  emptyText: zDynamicString.optional(),
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
export const PAGE_FIELDS: readonly string[] = Object.freeze(["title", "hidden?", "summary?"]);

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
    label: z.string().min(1),
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
const pageSchema = z
  .object({
    id: z.string().min(1),
    title: zDynamicString,
    hidden: z.boolean().optional(),
    summary: z.array(summaryValueSchema).optional(),
    view: viewSchema,
  })
  .strict()
  .superRefine((page, ctx) => {
    const view = page.view as { type?: string; render?: unknown; mount?: unknown };
    if (view.type !== "custom") return;
    if ((view.render === undefined) === (view.mount === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view"],
        message: "a custom view needs exactly one of `render` (a React element) or `mount` (el, props) => cleanup",
      });
    }
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

const networkPermissionSchema = z.union([z.boolean(), z.object({ hosts: z.array(z.string()).optional() })]);

const permissionSchema = z.object({
  // Declared, not yet enforced — the consent prompt is KA-23. See PermissionManifest.
  sync: z.boolean().optional(),
  camera: z.boolean().optional(),
  filesystem: z.boolean().optional(),
  notifications: z.boolean().optional(),
  geo: z.boolean().optional(),
  haptics: z.boolean().optional(),
  network: networkPermissionSchema.optional(),
});


export const structureSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  version: z.string().regex(SEMVER, "version must be semver (e.g. 1.0.0)"),
  schemaVersion: z.number().int().min(1),
  theme: z.object({ accent: z.string().optional() }).optional(),
  permissions: permissionSchema.optional(),
  nav: z.enum(["grid", "tabs"]).optional(),
  scope: z.object({ entity: z.string().min(1), label: z.string().optional(), required: z.boolean().optional() }).optional(),
  quickActions: z.array(quickActionSchema).optional(),
  entities: z.record(entitySchema),
  pages: z.array(pageSchema),
  reminders: z.array(reminderSchema).optional(),
  migrations: z.array(migrationSchema).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Referential integrity (phase 2)
// ─────────────────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid app definition:\n  - ${issues.join("\n  - ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Top-level field keys + computed keys available on an entity for binding references. */
function boundKeys(entity: EntityDef): Set<string> {
  const keys = new Set<string>(Object.keys(entity.fields));
  for (const k of Object.keys(entity.computed ?? {})) keys.add(k);
  // Identity/timestamp fields are always addressable.
  keys.add("id");
  keys.add("createdAt");
  keys.add("updatedAt");
  return keys;
}

function checkFieldRelations(
  entityName: string,
  fields: Record<string, Field>,
  entityNames: Set<string>,
  issues: string[],
  path = "",
): void {
  for (const [key, field] of Object.entries(fields)) {
    const here = path ? `${path}.${key}` : key;
    if (field.type === "relation") {
      if (!entityNames.has(field.to)) {
        issues.push(`entity "${entityName}" field "${here}" is a relation to unknown entity "${field.to}"`);
      }
    } else if (field.type === "list") {
      checkFieldRelations(entityName, field.of, entityNames, issues, here);
    }
  }
}

/** Referential integrity across the whole definition. */
export function checkReferences(def: AppDefinition): string[] {
  const issues: string[] = [];
  const entityNames = new Set(Object.keys(def.entities));

  // relations point at real entities
  for (const [name, entity] of Object.entries(def.entities)) {
    checkFieldRelations(name, entity.fields, entityNames, issues);
  }

  const ensureEntity = (entity: string, where: string): EntityDef | null => {
    const e = def.entities[entity];
    if (!e) issues.push(`${where} references unknown entity "${entity}"`);
    return e ?? null;
  };

  const ensureKey = (entity: EntityDef, entityName: string, key: string, where: string): void => {
    if (!boundKeys(entity).has(key)) {
      issues.push(`${where} references unknown field/computed "${key}" on entity "${entityName}"`);
    }
  };

  // pages / views
  for (const page of def.pages) {
    const v = page.view;
    const where = `page "${page.id}" view`;
    const entity = ensureEntity(v.entity, where);
    if (!entity) continue;

    const checkBinding = (b: unknown, label: string): void => {
      if (typeof b === "string") ensureKey(entity, v.entity, b, `${where} ${label}`);
    };

    switch (v.type) {
      case "list":
      case "gallery": {
        if (v.display) {
          checkBinding(v.display.primary, "display.primary");
          checkBinding(v.display.secondary, "display.secondary");
          if (v.display.media) ensureKey(entity, v.entity, v.display.media, `${where} display.media`);
          for (const b of v.display.badges ?? []) ensureKey(entity, v.entity, b, `${where} display.badges`);
        }
        break;
      }
      case "table": {
        for (const c of v.display?.columns ?? []) ensureKey(entity, v.entity, c, `${where} display.columns`);
        break;
      }
      case "detail": {
        for (const s of v.sections ?? []) {
          for (const fld of s.fields) ensureKey(entity, v.entity, fld, `${where} section "${s.title ?? ""}"`);
        }
        break;
      }
      case "calendar": {
        checkBinding(v.date, "date");
        checkBinding(v.title, "title");
        checkBinding(v.color, "color");
        break;
      }
      case "map": {
        ensureKey(entity, v.entity, v.geo, `${where} geo`);
        checkBinding(v.title, "title");
        checkBinding(v.color, "color");
        break;
      }
      case "steps": {
        ensureKey(entity, v.entity, v.list, `${where} list`);
        break;
      }
      case "custom":
        break;
    }
  }

  // reminders
  for (const r of def.reminders ?? []) {
    ensureEntity(r.entity, `reminder "${r.id}"`);
  }

  // the scope names a real entity
  if (def.scope) ensureEntity(def.scope.entity, "scope");

  // quick actions target a real entity (and its prefill keys are real fields)
  for (const qa of def.quickActions ?? []) {
    const e = ensureEntity(qa.entity, `quickAction "${qa.id}"`);
    if (e) for (const key of Object.keys(qa.prefill ?? {})) ensureKey(e, qa.entity, key, `quickAction "${qa.id}" prefill`);
  }

  return issues;
}
