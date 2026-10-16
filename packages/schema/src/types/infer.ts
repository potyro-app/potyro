// Type inference: map declarative field definitions to the resolved TS record type that logic
// functions receive (docs/04: "infers types so your computed/action/filter functions get
// fully typed record and ctx"). Relations are resolved one level deep; computed values are
// accessible (typed `any` — the intentional loose part, since computed return types would be
// mutually recursive to infer precisely). Field values ARE precisely typed, which is what
// gives array fields (`ingredients`, `steps`, …) real `.map`/`.reduce`/`.every` signatures so
// their callback params are contextually typed rather than implicit-any.

import type { Field } from "./fields.js";
import type { AiLeaf, Ctx } from "./ctx.js";
import type { FileRef, Geo, Id, MediaRef, Value } from "./core.js";

/** Identity + timestamps present on every record. */
export interface RecordBase {
  id: Id;
  createdAt: string;
  updatedAt: string;
}

/** The authored shape of an entity, used as the inference source. */
export interface EntityShape {
  label?: string;
  displayField?: string;
  fields: Record<string, Field>;
  editableBy?: "anyone" | "creator" | "app";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computed?: Record<string, ((...args: any[]) => any) | { value: (...args: any[]) => any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions?: Record<string, (...args: any[]) => any>;
}

export type EntitiesShape = Record<string, EntityShape>;

/** Resolve one field definition to its runtime value type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldValue<Fld, E extends EntitiesShape> = Fld extends { type: "text" }
  ? string
  : Fld extends { type: "richtext" }
    ? string
    : Fld extends { type: "url" }
      ? string
      : Fld extends { type: "enum" }
        ? string
        : Fld extends { type: "money" }
          ? number
        : Fld extends { type: "number" }
          ? number
          : Fld extends { type: "duration" }
            ? number
            : Fld extends { type: "boolean" }
              ? boolean
              : Fld extends { type: "tags" }
                ? string[]
                : Fld extends { type: "datetime" }
                  ? Date
                  : Fld extends { type: "geo" }
                    ? Geo
                    : Fld extends { type: "media"; multiple: true }
                      ? MediaRef[]
                      : Fld extends { type: "media" }
                        ? MediaRef
                        : Fld extends { type: "file" }
                          ? FileRef
                        : Fld extends { type: "relation"; to: infer To; many: true }
                          ? To extends keyof E
                            ? ResolvedFields<E[To], E>[]
                            : unknown[]
                          : Fld extends { type: "relation"; to: infer To }
                            ? To extends keyof E
                              ? ResolvedFields<E[To], E>
                              : unknown
                            : Fld extends { type: "list"; of: infer Of }
                              ? Of extends Record<string, Field>
                                ? Array<{ [K in keyof Of]: FieldValue<Of[K], E> }>
                                : unknown[]
                              : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                any;

/** An entity's fields resolved to a record (no computed — used for relation targets). */
export type ResolvedFields<Ent extends EntityShape, E extends EntitiesShape> = RecordBase & {
  [K in keyof Ent["fields"]]: FieldValue<Ent["fields"][K], E>;
};

/** Computed keys are accessible but loosely typed (see file header). */
type ComputedKeys<Ent extends EntityShape> = Ent["computed"] extends object
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { [K in keyof Ent["computed"]]: any }
  : Record<never, never>;

/**
 * The full record handed to logic functions: base + precisely-typed fields (relations
 * resolved one level) + computed keys (loose). This is the `Resolved<E>` of docs/04.
 */
export type LogicRecord<Ent extends EntityShape, E extends EntitiesShape> = ResolvedFields<Ent, E> & ComputedKeys<Ent>;

/** Resolve the record type for an entity referenced by *name*. */
export type RecordFor<En, E extends EntitiesShape> = En extends keyof E ? LogicRecord<E[En], E> : Value & object;

// ─────────────────────────────────────────────────────────────────────────────
// Function-signature helpers parameterized by the resolved record type R.
// ─────────────────────────────────────────────────────────────────────────────

export type ComputedIn<R> = (record: R, ctx: Ctx) => Value | Promise<Value>;
export type ActionIn<R> = (record: R, ctx: Ctx, input?: unknown) => void | Promise<void>;
export type FilterIn<R> = (record: R, ctx: Ctx) => boolean;
export type SortIn<R> = (a: R, b: R) => number;
export type BindingIn<R, T = Value> = string | ((record: R, ctx: Ctx) => T);
export type ReminderWhenIn<R> = (record: R, ctx: Ctx) => Date | null;

// ---- `ctx.caps.ai.extract` (docs/23) ----

type AiLeafValue<L> = L extends "text" ? string : L extends "number" ? number : L extends "boolean" ? boolean : L extends "date" ? string : never;

/** What `extract` gives back for a shape: `"number?"` is `number | null`, `[{ name: "text" }]` is `{ name: string }[]`. */
export type AiValue<S> = S extends `${infer L}?`
  ? AiLeafValue<L> | null
  : S extends AiLeaf
    ? AiLeafValue<S>
    : S extends { readonly oneOf: readonly (infer O)[]; readonly optional: true }
      ? O | null
      : S extends { readonly oneOf: readonly (infer O)[] }
        ? O
        : S extends readonly [infer E]
          ? AiValue<E>[]
          : S extends object
            ? { -readonly [K in keyof S]: AiValue<S[K]> }
            : never;
