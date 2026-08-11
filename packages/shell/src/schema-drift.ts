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
import { migrationChain } from "./migrate-on-load.js";

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
  /**
   * Does a migration exist that will ACTUALLY RUN — one whose `from` is the version the old source
   * declared, reaching the version the new one declares?
   *
   * This used to be `/\bmigrations\s*:/.test(after)` — the word appearing anywhere in the file. So
   * `migrations: []` counted, and so did a migration keyed on the wrong thing. `migrateOnLoad`
   * walks the chain by matching `from` against the app version the stored data was written under,
   * which means `{ from: "1", to: "2" }` matches nothing on an app whose `version` is "1.0.0": it
   * parses, it validates, it silences this warning, and it never runs.
   *
   * That is not hypothetical. The generator's own contract told the model to write exactly that,
   * and the test that was supposed to prove this check worked used it as its example of an app
   * doing the right thing. Both are fixed; this is the part that cannot be talked out of it.
   */
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
    hasMigrations: migrationReaches(before, after),
  };
}

const SEMVER_IN_SOURCE = /\d+\.\d+\.\d+(?:[-+][^"']+)?/;

/** The app's declared `version`, as written in the source. */
export function appVersionOf(source: string): string | null {
  const m = new RegExp(`\\bversion\\s*:\\s*["'](${SEMVER_IN_SOURCE.source})["']`).exec(source);
  return m ? m[1]! : null;
}

/**
 * The `from` -> `to` hops the source declares, as versions.
 *
 * Read with a regex rather than a parser, matching how the rest of this module works — and narrowed
 * to SEMVER pairs on purpose, because `renameField` and `renameEntity` steps also carry `from`/`to`.
 * A field is not called `1.2.0`, so requiring both halves to look like versions keeps the step keys
 * out without needing to understand the surrounding structure.
 */
function migrationEdges(source: string): { from: string; to: string; steps: [] }[] {
  const pair = new RegExp(
    `\\bfrom\\s*:\\s*["'](${SEMVER_IN_SOURCE.source})["'][\\s\\S]{0,120}?\\bto\\s*:\\s*["'](${SEMVER_IN_SOURCE.source})["']`,
    "g",
  );
  const edges: { from: string; to: string; steps: [] }[] = [];
  for (const m of source.matchAll(pair)) edges.push({ from: m[1]!, to: m[2]!, steps: [] });
  return edges;
}

/**
 * Will a migration actually carry this app's existing data from the old version to the new one?
 *
 * Walked with `migrationChain` — the SAME function `migrateOnLoad` uses at runtime — so this cannot
 * drift into approving a chain the real thing would reject. Answering "is the word `migrations` in
 * the file" (which is what this used to do) approved an empty array and a chain keyed on numbers.
 *
 * Unknown versions answer `true`: this feeds a warning, and warning someone about an app whose
 * version could not be read would fire on apps that are perfectly fine.
 */
function migrationReaches(before: string, after: string): boolean {
  const was = appVersionOf(before);
  const now = appVersionOf(after);
  if (!was || !now) return true;
  if (was === now) return false; // version never moved: nothing can be keyed off it
  const chain = migrationChain(migrationEdges(after), was);
  return chain.length > 0 && chain[chain.length - 1]!.to === now;
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

  // "that will run" is doing real work in this sentence. A migration can be present, valid, and
  // still inert — keyed to a version the stored data was never written under — and the previous
  // wording would have called that "includes a migration" and said nothing.
  return (
    `This change alters how your data is stored — it ${parts.join("; ")} — but does not ` +
    `${drift.versionBumped ? "include a migration that will run" : "bump schemaVersion or include a migration that will run"}. ` +
    `Records you already have will not be updated to match, so some of them may stop appearing. ` +
    `Your previous version is in History.`
  );
}
