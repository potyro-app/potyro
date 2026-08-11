// Did this edit change the DATA MODEL, and if so did it say so?
//
// The failure this exists for, from a real user, on a real app:
//
//   "I want a todo list that is shared" → worked.
//   "I want items to belong to groups"  → the list stopped working.
//
// The agent had added a `group` entity, added a REQUIRED `group` relation to `item`, and replaced
// the item list with a groups list whose items are only reachable inside a group. Every todo they
// had already written was still in the database and no longer appeared anywhere. `schemaVersion`
// stayed at 1 and no `migrations` were emitted, so nothing ran to give the old records a group.
//
// Nothing caught it. The app parsed, validated, smoked and — for a brand new empty app — behaves
// perfectly. It is only wrong in the presence of data that already exists, which is the one thing
// none of the other gates has.
//
// This compares the declared shape before and after. It cannot know whether a migration is
// CORRECT; it can know that the model changed the shape and told nobody, which is the case that
// silently loses a person's work.

import { inspect } from "./app-source.js";
import { schemaVersionOf } from "./app-sync.js";

export interface SchemaDrift {
  /** Entities present after but not before. Their records do not exist yet — harmless on its own. */
  addedEntities: string[];
  /** Entities that disappeared. Records under them become unreachable. */
  removedEntities: string[];
  /** `entity.field` added. Existing records will not have it. */
  addedFields: string[];
  /** `entity.field` gone. Whatever it held stops being shown. */
  removedFields: string[];
  /** Did the app declare a new `schemaVersion`? Without one, no migration can run. */
  versionBumped: boolean;
  /** Did the app ship any migration at all? */
  hasMigrations: boolean;
}

const keysOf = (shape: { entities: { key: string; fields: { key: string }[] }[] }): { entities: Set<string>; fields: Set<string> } => ({
  entities: new Set(shape.entities.map((e) => e.key)),
  fields: new Set(shape.entities.flatMap((e) => e.fields.map((f) => `${e.key}.${f.key}`))),
});

/**
 * Compare two sources' declared shape.
 *
 * Resolves to `null` when either source cannot be read structurally — an app whose `defineApp` is
 * computed rather than literal. Unknown, not safe: callers must not report `null` as "no drift".
 */
export async function schemaDrift(before: string, after: string): Promise<SchemaDrift | null> {
  const [a, b] = await Promise.all([inspect(before), inspect(after)]);
  if (a.blocked || b.blocked) return null;

  const from = keysOf(a);
  const to = keysOf(b);
  const missing = (set: Set<string>, other: Set<string>): string[] => [...set].filter((k) => !other.has(k));

  return {
    addedEntities: missing(to.entities, from.entities),
    removedEntities: missing(from.entities, to.entities),
    // A field on a NEW entity is not drift: there are no records to migrate.
    addedFields: missing(to.fields, from.fields).filter((f) => !to.entities.has(f.split(".")[0]!) || from.entities.has(f.split(".")[0]!)),
    removedFields: missing(from.fields, to.fields).filter((f) => from.entities.has(f.split(".")[0]!) && to.entities.has(f.split(".")[0]!)),
    versionBumped: (schemaVersionOf(after) ?? 0) > (schemaVersionOf(before) ?? 0),
    hasMigrations: /\bmigrations\s*:/.test(after),
  };
}

/**
 * The warning to show, or null when there is nothing worth saying.
 *
 * Deliberately quiet when the version was bumped AND a migration exists: that is the app doing the
 * right thing, and a warning there would train people to dismiss this one.
 */
export function describeDrift(drift: SchemaDrift | null): string | null {
  if (!drift) return null;
  const changed =
    drift.removedEntities.length + drift.addedFields.length + drift.removedFields.length > 0;
  if (!changed) return null;
  if (drift.versionBumped && drift.hasMigrations) return null;

  const parts: string[] = [];
  if (drift.addedFields.length) parts.push(`added ${drift.addedFields.join(", ")}`);
  if (drift.removedFields.length) parts.push(`removed ${drift.removedFields.join(", ")}`);
  if (drift.removedEntities.length) parts.push(`removed the ${drift.removedEntities.join(", ")} type`);

  return (
    `This change alters how your data is stored — it ${parts.join("; ")} — but does not ` +
    `${drift.versionBumped ? "include a migration" : "bump schemaVersion or include a migration"}. ` +
    `Records you already have will not be updated to match, so some of them may stop appearing. ` +
    `Your previous version is in History.`
  );
}
