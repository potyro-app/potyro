// Shared, pure migration-step application (docs/06). Operates on an in-memory record set so
// every Store implementation runs *identical* migration semantics: MemoryStore/LocalStore apply
// it to their live maps; SqliteStore loads rows, applies it, and writes back. Keeping this in one
// place means the existing MemoryStore test suite also validates the logic SqliteStore relies on.

import type { Id, KartaRecord, Migration, MigrationStep } from "karta";

/** Records grouped by entity, preserving per-entity creation (insertion) order. */
export type EntityRecords = Map<string, Map<Id, KartaRecord>>;

function entityMap(records: EntityRecords, entity: string): Map<Id, KartaRecord> {
  let m = records.get(entity);
  if (!m) {
    m = new Map();
    records.set(entity, m);
  }
  return m;
}

/**
 * Apply one migration step to `records` in place. Returns the set of entities whose rows changed
 * (so callers can emit change notifications). `now` supplies the `updatedAt` stamp for the
 * `transform` escape hatch, which runs in the app's trust context (a full `Ctx` is only available
 * at the host level, so a minimal placeholder is passed — matching the pre-extraction behaviour).
 */
export function applyMigrationStep(step: MigrationStep, records: EntityRecords, now: () => string): Set<string> {
  const affected = new Set<string>();

  if ("transform" in step) {
    for (const [entity, m] of records) {
      for (const [id, r] of m) {
        const out = step.transform(r, undefined as never);
        m.set(id, { ...out, id, createdAt: r.createdAt, updatedAt: now() });
      }
      affected.add(entity);
    }
    return affected;
  }

  switch (step.op) {
    case "addField":
    case "addRelation": {
      const def = step.op === "addField" ? step.default : step.many ? [] : null;
      for (const r of entityMap(records, step.entity).values()) {
        if (r[step.field] === undefined) r[step.field] = def as unknown;
      }
      affected.add(step.entity);
      break;
    }
    case "dropField": {
      for (const r of entityMap(records, step.entity).values()) delete r[step.field];
      affected.add(step.entity);
      break;
    }
    case "renameField": {
      for (const r of entityMap(records, step.entity).values()) {
        if (step.from in r) {
          r[step.to] = r[step.from];
          delete r[step.from];
        }
      }
      affected.add(step.entity);
      break;
    }
    case "changeType": {
      for (const r of entityMap(records, step.entity).values()) r[step.field] = step.via(r[step.field]);
      affected.add(step.entity);
      break;
    }
    case "setDefaultForExisting": {
      for (const r of entityMap(records, step.entity).values()) {
        if (r[step.field] === undefined) r[step.field] = step.value;
      }
      affected.add(step.entity);
      break;
    }
    case "renameEntity": {
      const from = records.get(step.from);
      if (from) {
        records.set(step.to, from);
        records.delete(step.from);
      }
      affected.add(step.to);
      break;
    }
  }

  return affected;
}

/**
 * The migrations still to run, in order, starting from the version the data was written under.
 *
 * Lives here rather than in the shell because it is pure, it belongs beside `MigrationPlan`, and
 * two callers outside the shell now need it: the eval harness, which measures whether a modified
 * app still carries its data, and the shell itself. A second copy would be a second set of rules
 * for which migrations run, which is exactly the kind of drift this file exists to prevent.
 *
 * Matching on `from` rather than comparing versions avoids a semver parser and, more importantly,
 * cannot skip a step. `from` is the app VERSION the data was written under, not `schemaVersion`.
 */
export function migrationChain(migrations: readonly Migration[], from: string | null): Migration[] {
  if (!from) return []; // fresh data: written by the current version already
  const chain: Migration[] = [];
  const seen = new Set<string>();
  let at = from;
  for (;;) {
    const next = migrations.find((m) => m.from === at);
    // `seen` guards a definition whose migrations loop (1.0 -> 1.1 -> 1.0); without it this spins
    // forever on app open, which is a far worse failure than an un-migrated field.
    if (!next || seen.has(next.to)) break;
    chain.push(next);
    seen.add(next.to);
    at = next.to;
  }
  return chain;
}
