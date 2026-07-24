// Field types — the declarative, closed set (docs/03 "Field types").
//
// `text · richtext · number · boolean · enum · tags · datetime · duration · url · geo ·
//  media · relation · list`. There is intentionally no `computed` field *type* — computed is
// a function block on the entity, which cleanly separates shape (data) from logic (code).

import type { Ctx } from "./ctx.js";

/** `default` may be a literal value or a function of `ctx` (docs/03). */
export type DefaultValue = unknown | ((ctx: Ctx) => unknown);

/** Common options shared by every field variant. */
export interface FieldCommon {
  label?: string;
  required?: boolean;
  hidden?: boolean;
  /** Literal default, or `(ctx) => value`. Not validated (may be a function). */
  default?: DefaultValue;
}

export interface TextField extends FieldCommon {
  type: "text";
  multiline?: boolean;
}

export interface RichTextField extends FieldCommon {
  type: "richtext";
}

export interface NumberField extends FieldCommon {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
}

export interface BooleanField extends FieldCommon {
  type: "boolean";
}

export interface EnumField extends FieldCommon {
  type: "enum";
  options: string[];
}

export interface TagsField extends FieldCommon {
  type: "tags";
  options?: string[];
}

export interface DateTimeField extends FieldCommon {
  type: "datetime";
}

export interface DurationField extends FieldCommon {
  type: "duration";
  /** Base unit the stored number represents. */
  unit?: "ms" | "s" | "min" | "h" | "d";
}

export interface UrlField extends FieldCommon {
  type: "url";
}

export interface GeoField extends FieldCommon {
  type: "geo";
}

export interface MediaField extends FieldCommon {
  type: "media";
  accept?: "image" | "video" | "audio" | "any";
  multiple?: boolean;
}

export interface RelationField extends FieldCommon {
  type: "relation";
  /** Target entity key. */
  to: string;
  many?: boolean;
}

/** A list of homogeneous nested rows. Each row is a mini field set (`of`). */
export interface ListField extends FieldCommon {
  type: "list";
  of: Record<string, Field>;
  ordered?: boolean;
}

/** The discriminated union of all field variants. */
export type Field =
  | TextField
  | RichTextField
  | NumberField
  | BooleanField
  | EnumField
  | TagsField
  | DateTimeField
  | DurationField
  | UrlField
  | GeoField
  | MediaField
  | RelationField
  | ListField;

/** All valid field type discriminants. */
export const FIELD_TYPES = [
  "text",
  "richtext",
  "number",
  "boolean",
  "enum",
  "tags",
  "datetime",
  "duration",
  "url",
  "geo",
  "media",
  "relation",
  "list",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
