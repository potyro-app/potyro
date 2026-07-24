// Optional field-builder sugar (`f`). Purely a convenience — the declarative field objects
// can always be written as plain literals (the examples do). Every builder just returns a
// correctly-typed `Field` variant.

import type {
  BooleanField,
  DateTimeField,
  DurationField,
  EnumField,
  Field,
  GeoField,
  ListField,
  MediaField,
  NumberField,
  RelationField,
  RichTextField,
  TagsField,
  TextField,
  UrlField,
} from "./types/fields.js";

type Omit1<T, K extends keyof T> = Omit<T, K>;

export const f = {
  text: (o: Omit1<TextField, "type"> = {}): TextField => ({ type: "text", ...o }),
  richtext: (o: Omit1<RichTextField, "type"> = {}): RichTextField => ({ type: "richtext", ...o }),
  number: (o: Omit1<NumberField, "type"> = {}): NumberField => ({ type: "number", ...o }),
  boolean: (o: Omit1<BooleanField, "type"> = {}): BooleanField => ({ type: "boolean", ...o }),
  enum: (options: string[], o: Omit1<EnumField, "type" | "options"> = {}): EnumField => ({ type: "enum", options, ...o }),
  tags: (o: Omit1<TagsField, "type"> = {}): TagsField => ({ type: "tags", ...o }),
  datetime: (o: Omit1<DateTimeField, "type"> = {}): DateTimeField => ({ type: "datetime", ...o }),
  duration: (o: Omit1<DurationField, "type"> = {}): DurationField => ({ type: "duration", ...o }),
  url: (o: Omit1<UrlField, "type"> = {}): UrlField => ({ type: "url", ...o }),
  geo: (o: Omit1<GeoField, "type"> = {}): GeoField => ({ type: "geo", ...o }),
  media: (o: Omit1<MediaField, "type"> = {}): MediaField => ({ type: "media", ...o }),
  relation: (to: string, o: Omit1<RelationField, "type" | "to"> = {}): RelationField => ({ type: "relation", to, ...o }),
  list: (of: Record<string, Field>, o: Omit1<ListField, "type" | "of"> = {}): ListField => ({ type: "list", of, ...o }),
} as const;
