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
  /** One line under the control on the form: what to put here, or why it matters (#100). */
  help?: string;
  /** Example text in the empty control (text, url, number). */
  placeholder?: string;
  /** `"half"` lets two short neighbours share a row on a wide form; they stack on a phone. */
  width?: "full" | "half";
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
  /** `"day"` (the default): a date, no time — the picker offers days and the value reads as one.
   *  `"minute"`: the field keeps the time too (a session start, an appointment). Most fields want
   *  the day; ask for the minute only when the hour matters (#103). */
  precision?: "day" | "minute";
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

/**
 * A person in this app's space (KA-19) — assignee, owner, borrower, participant.
 *
 * Deliberately NOT a `relation` to a `person` entity. Membership lives in space metadata,
 * maintained by the invite and key machinery, not in rows the app can write; modelling it as a
 * relation would let any app forge a member, and would give every shared app the chore of keeping
 * a people table in step with who is actually in the space. As a distinct type the runtime can
 * render a real person chip and validate values against `ctx.space.members`.
 *
 * Stored as an account id (or an array of them with `many`). Resolves to a `Person`, so
 * `e.paidBy.name` works. Solo degrades to the single local identity rather than to nothing.
 */
export interface MemberField extends FieldCommon {
  type: "member";
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
  | MemberField
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
  "member",
  "list",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
