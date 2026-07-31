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

const listView = z.object({
  type: z.literal("list"),
  entity: z.string(),
  filter: zFn.optional(),
  sort: zFn.optional(),
  display: listDisplaySchema.optional(),
  rowActions: z.array(z.string()).optional(),
  onOpen: onOpenSchema.optional(),
  emptyText: z.string().optional(),
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
  emptyText: z.string().optional(),
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

const mapView = z.object({
  type: z.literal("map"),
  entity: z.string(),
  geo: z.string(),
  title: zBinding.optional(),
  color: zBinding.optional(),
  filter: zFn.optional(),
  filters: z.array(filterChipSchema).optional(),
  onOpen: onOpenSchema.optional(),
});

const stepsView = z.object({
  type: z.literal("steps"),
  entity: z.string(),
  param: z.string().optional(),
  list: z.string(),
  text: zBinding.optional(),
});

const customView = z.object({
  type: z.literal("custom"),
  entity: z.string(),
  param: z.string().optional(),
  render: zFn,
  onFinish: z.string().optional(),
});

const viewSchema = z.discriminatedUnion("type", [
  listView,
  galleryView,
  tableView,
  detailView,
  calendarView,
  mapView,
  stepsView,
  customView,
]);

const pageSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  hidden: z.boolean().optional(),
  view: viewSchema,
});

const reminderSchema = z.object({
  id: z.string().min(1),
  entity: z.string(),
  when: zFn,
  title: zBinding,
  body: zBinding.optional(),
});

const migrationStepSchema = z.union([
  z.object({ op: z.literal("addField"), entity: z.string(), field: z.string(), default: z.any().optional() }),
  z.object({ op: z.literal("dropField"), entity: z.string(), field: z.string() }),
  z.object({ op: z.literal("renameField"), entity: z.string(), from: z.string(), to: z.string() }),
  z.object({ op: z.literal("changeType"), entity: z.string(), field: z.string(), to: z.string(), via: zFn }),
  z.object({ op: z.literal("renameEntity"), from: z.string(), to: z.string() }),
  z.object({ op: z.literal("setDefaultForExisting"), entity: z.string(), field: z.string(), value: z.any() }),
  z.object({ op: z.literal("addRelation"), entity: z.string(), field: z.string(), to: z.string(), many: z.boolean().optional() }),
  z.object({ transform: zFn }),
]);

const migrationSchema = z.object({
  from: z.string(),
  to: z.string(),
  steps: z.array(migrationStepSchema),
});

const networkPermissionSchema = z.union([z.boolean(), z.object({ hosts: z.array(z.string()).optional() })]);

const permissionSchema = z.object({
  camera: z.boolean().optional(),
  filesystem: z.boolean().optional(),
  notifications: z.boolean().optional(),
  geo: z.boolean().optional(),
  haptics: z.boolean().optional(),
  network: networkPermissionSchema.optional(),
});

const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

export const structureSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  version: z.string().regex(SEMVER, "version must be semver (e.g. 1.0.0)"),
  schemaVersion: z.number().int().min(1),
  theme: z.object({ accent: z.string().optional() }).optional(),
  permissions: permissionSchema.optional(),
  nav: z.enum(["grid", "tabs"]).optional(),
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

  // quick actions target a real entity (and its prefill keys are real fields)
  for (const qa of def.quickActions ?? []) {
    const e = ensureEntity(qa.entity, `quickAction "${qa.id}"`);
    if (e) for (const key of Object.keys(qa.prefill ?? {})) ensureKey(e, qa.entity, key, `quickAction "${qa.id}" prefill`);
  }

  return issues;
}
