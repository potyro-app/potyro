// Field types — the declarative, closed set (docs/03 "Field types").
//
// `text · richtext · number · boolean · enum · tags · datetime · duration · url · geo ·
//  media · relation · list`. There is intentionally no `computed` field *type* — computed is
// a function block on the entity, which cleanly separates shape (data) from logic (code).

import type { Ctx } from "./ctx.js";
import type { Words } from "./words.js";

/** `default` may be a literal value or a function of `ctx` (docs/03). */
export type DefaultValue = unknown | ((ctx: Ctx) => unknown);

/** Common options shared by every field variant. */
export interface FieldCommon {
  label?: Words;
  required?: boolean;
  hidden?: boolean;
  /** One line under the control on the form: what to put here, or why it matters (#100). */
  help?: Words;
  /** Example text in the empty control (text, url, number). */
  placeholder?: Words;
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
  unit?: Words;
  integer?: boolean;
}

export interface BooleanField extends FieldCommon {
  type: "boolean";
}

/** Money as WHOLE MINOR UNITS — `4200` is €42.00 (KA-26). Never a float; `currency` is ISO 4217 and
 *  sets the minor digits (a yen has none, so `5` is ¥5). Why, and how to split: docs/03. */
export interface MoneyField extends FieldCommon {
  type: "money";
  /** ISO 4217. Defaults to EUR when the app does not say. */
  currency?: string;
  min?: number;
  max?: number;
}

/** The colours an enum value may be given. A closed set, so a shared app cannot walk off the
 *  palette or land unreadable text on its own background (#98). */
export const ENUM_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"] as const;
export type EnumColor = (typeof ENUM_COLORS)[number];

export interface EnumField extends FieldCommon {
  type: "enum";
  options: string[];
  /** Colour per option, for values that mean something — `{ overdue: "red", done: "green" }`.
   *  Options left out keep the colour derived from their name, which is stable everywhere. */
  colors?: Record<string, EnumColor>;
  /** What each option reads as: `{ todo: { en: "To do", pl: "Do zrobienia" } }`. Records keep the option. */
  labels?: Record<string, Words>;
  /** Overrides the control the option count would choose: up to five options are a row of
   *  buttons, more open a searchable picker. */
  control?: "segmented" | "picker";
}

export interface TagsField extends FieldCommon {
  type: "tags";
  options?: string[];
  /** As for an enum. */
  labels?: Record<string, Words>;
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

/** A file in the app's own folder; the value is a `FileRef`. `accept` like `".md,.txt"`. */
export interface FileField extends FieldCommon {
  type: "file";
  accept?: string;
  /** where imported files land */
  folder?: string;
}

export interface MediaField extends FieldCommon {
  type: "media";
  accept?: "image" | "video" | "audio" | "any";
  multiple?: boolean;
  /**
   * Keep a photo exactly as the camera took it. Off by default: a phone camera makes a 4000-pixel,
   * four-megabyte JPEG, and an app holding a few dozen of those fills the device — and, in a shared
   * app, pushes every one of those megabytes to every person in it. Photos are stored at 2048
   * pixels on their longest edge instead, which is more than a screen shows and still prints small.
   *
   * Turn it on where the pixels ARE the point: a scanned document, a receipt to be read back later,
   * a photo meant to be cropped hard. Re-encoding also drops the file's EXIF data.
   */
  full?: boolean;
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
  /** Rows as lines of these parts: "350 g flour". */
  lines?: string[];
}

/** The discriminated union of all field variants. */
export type Field =
  | TextField
  | RichTextField
  | NumberField
  | BooleanField
  | MoneyField
  | EnumField
  | TagsField
  | DateTimeField
  | DurationField
  | UrlField
  | GeoField
  | MediaField
  | FileField
  | RelationField
  | MemberField
  | ListField;

/** All valid field type discriminants. */
export const FIELD_TYPES = [
  "text",
  "richtext",
  "number",
  "boolean",
  "money",
  "enum",
  "tags",
  "datetime",
  "duration",
  "url",
  "geo",
  "media",
  "file",
  "relation",
  "member",
  "list",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
