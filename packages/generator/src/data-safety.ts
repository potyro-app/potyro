// Did the change keep what the person had written?
//
// The first version of this asked one question — "is every record still reachable from a page?" —
// and that question is necessary and nowhere near sufficient. A record can sit on the list screen,
// exactly where it was, with its title intact and its notes gone. `dropField` does it in one line;
// so does a model that rewrote the entity and did not think about the field it stopped mentioning.
// Reachability reports that as a clean pass, which is the most dangerous possible answer: the app
// looks right, the count is right, and the data is not there.
//
// So the check is at the VALUE level. Before every modification: every entity, every record id,
// every stored field value. After: the same, compared.
//
// ## Requested transformation vs unexplained loss
//
// Not every change is damage. "Rename `notes` to `description`" SHOULD move the values, and
// "drop the old priority field" should remove them. The difference is whether anything in the app
// declared the intent — so a change is `explained` when a migration step in the chain that actually
// ran accounts for it, and unexplained otherwise.
//
// The `transform` step is the honest edge. It is an arbitrary function over every record, so it can
// account for any change at all and therefore attributes nothing: a chain containing one cannot be
// mechanically cleared. Those runs are flagged FOR REVIEW rather than passed, because "a human
// looked" and "we could not tell" must not produce the same verdict — the whole reason this file
// exists is that a check which cannot fail teaches nobody anything.

import type { AppDefinition, PotyroRecord, Migration } from "potyro";
import type { Store } from "@potyro/store";

/** Bookkeeping the store owns. A change to these says nothing about the user's data. */
const INTERNAL = new Set(["id", "createdAt", "updatedAt"]);

/** entity → record id → field → value, as stored. */
export type DataSnapshot = Map<string, Map<string, Record<string, unknown>>>;

export interface FieldChange {
  entity: string;
  id: string;
  field: string;
  before: unknown;
  /** Absent when the value disappeared entirely. */
  after?: unknown;
  /** The migration step that accounts for it, or null when nothing does. */
  explained: string | null;
}

export interface LostRecord {
  entity: string;
  id: string;
}

export interface DataSafetyReport {
  /** Record ids that are no longer STORED anywhere. The one finding that stops a chain. */
  lostRecords: LostRecord[];
  /** Entities that held records before and hold none under any name now. */
  removedEntities: string[];
  /** Entity renames the migration chain declared — reported, not counted as loss. */
  renamedEntities: { from: string; to: string }[];
  /** Fields that stopped being stored on every record of an entity. */
  removedFields: { entity: string; field: string; explained: string | null }[];
  /** Field renames the migration chain declared. */
  renamedFields: { entity: string; from: string; to: string }[];
  /**
   * Fields the app has STOPPED DECLARING while records still hold values for them.
   *
   * This is the failure the briefing describes and the one reachability cannot see: the record is
   * still on the list, still opens, still has its title — and the paragraph the person wrote is in
   * the store with nothing in the app that reads it. It is not gone, which is why no data check
   * catches it, and it is not there either, which is what the person will tell you.
   *
   * Nothing declares it, by construction: a `dropField` would have removed the values, so there
   * would be nothing left to orphan. So these always want a human.
   */
  orphanedFields: { entity: string; field: string; records: number }[];
  /** Values that disappeared or changed, explained or not. */
  changedValues: FieldChange[];
  /** The subset nothing in the app accounts for. Never auto-passed. */
  unexplained: FieldChange[];
  /**
   * The chain ran a `transform`, so nothing in it can be mechanically attributed.
   *
   * Not a failure and not a pass — a reason the automated verdict is `review`.
   */
  opaqueTransform: boolean;
  /** ok = clean; review = a human must look; loss = records are gone. */
  verdict: "ok" | "review" | "loss";
}

/** A value in a form two snapshots can be compared by. Dates and nested shapes included. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v)) ?? "undefined";
}

/**
 * Every stored record under `entities`, with its field values.
 *
 * Read straight off the `Store` rather than through `runtime.query`, deliberately: a query resolves
 * relations and evaluates computed, so it reports what the app currently DERIVES, and a field the
 * app stopped declaring would simply not appear. What is at stake here is what is on disk.
 */
export async function snapshotData(store: Store, entities: Iterable<string>): Promise<DataSnapshot> {
  const snap: DataSnapshot = new Map();
  for (const entity of new Set(entities)) {
    let rows: PotyroRecord[];
    try {
      rows = await store.all(entity);
    } catch {
      continue; // an entity the store cannot read holds nothing this can compare
    }
    if (!rows.length) continue;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (INTERNAL.has(key) || key.startsWith("__")) continue;
        if (value === undefined || value === null) continue;
        fields[key] = value;
      }
      byId.set(String(row.id), fields);
    }
    snap.set(entity, byId);
  }
  return snap;
}

/**
 * The entity names worth reading after a modification.
 *
 * What was there, plus whatever is declared now, plus every `renameEntity` destination in the chain
 * that ran. The last one matters: a migration can move a table to a name the definition does not
 * mention, and reading only the declared names would report every one of its rows as LOST when they
 * are sitting right there under the wrong key. That is a real failure — nothing in the app can
 * reach them — but it is `unreachable`, not `deleted`, and the strongest finding this harness has
 * must mean exactly one thing.
 */
export function entitiesToRead(before: DataSnapshot, def: AppDefinition, chain: readonly Migration[] = []): string[] {
  const renameTargets = chain.flatMap((m) =>
    m.steps.flatMap((s) => (!("transform" in s) && s.op === "renameEntity" ? [s.to] : [])),
  );
  return [...new Set([...before.keys(), ...Object.keys(def.entities ?? {}), ...renameTargets])];
}

/** What each migration step in `chain` declares it will do, indexed for lookup. */
interface Declared {
  droppedFields: Map<string, Set<string>>;
  changedFields: Map<string, Set<string>>;
  renamedFields: { entity: string; from: string; to: string }[];
  renamedEntities: { from: string; to: string }[];
  opaqueTransform: boolean;
  /** One entity, one key, whatever it was called at the step doing the talking. See `resolverFor`. */
  resolve: (entity: string) => string;
}

/**
 * Follow every `renameEntity` in the chain, so an entity has ONE name here.
 *
 * Without this the index and the lookup disagree the moment a table is renamed: a step says
 * `dropField` on `memo` while the snapshot being compared still calls it `note`, nothing matches,
 * and a change the app declared in as many words is reported as unexplained. The review sheet then
 * prints `note.body → **gone**` for a value sitting safely in `memo.content` — a false loss claim in
 * the one artifact whose whole job is to be believed.
 *
 * Renames are applied IN ORDER, so `A→B→C` resolves `A`, `B` and `C` all to `C`. A chain that
 * renames in a circle stops at the first repeat rather than spinning.
 */
function resolverFor(chain: readonly Migration[]): (entity: string) => string {
  const renames: { from: string; to: string }[] = [];
  for (const migration of chain) {
    for (const step of migration.steps) {
      if (!("transform" in step) && step.op === "renameEntity") renames.push({ from: step.from, to: step.to });
    }
  }
  if (!renames.length) return (entity) => entity;
  return (entity) => {
    let at = entity;
    const seen = new Set([at]);
    for (const r of renames) {
      if (r.from !== at || seen.has(r.to)) continue;
      at = r.to;
      seen.add(at);
    }
    return at;
  };
}

function declaredBy(chain: readonly Migration[]): Declared {
  const resolve = resolverFor(chain);
  const d: Declared = {
    droppedFields: new Map(),
    changedFields: new Map(),
    renamedFields: [],
    renamedEntities: [],
    opaqueTransform: false,
    resolve,
  };
  const add = (m: Map<string, Set<string>>, entity: string, field: string): void => {
    let set = m.get(entity);
    if (!set) m.set(entity, (set = new Set()));
    set.add(field);
  };

  for (const migration of chain) {
    for (const step of migration.steps) {
      if ("transform" in step) {
        d.opaqueTransform = true;
        continue;
      }
      switch (step.op) {
        case "dropField":
          add(d.droppedFields, resolve(step.entity), step.field);
          break;
        // Deliberately NOT also recorded as a drop of `from`. A declared rename says where the
        // value should end up; if it does not arrive, that is loss, and letting the rename double
        // as a drop would explain away the exact failure this is here to catch.
        case "renameField":
          d.renamedFields.push({ entity: resolve(step.entity), from: step.from, to: step.to });
          break;
        case "changeType":
          add(d.changedFields, resolve(step.entity), step.field);
          break;
        // Steps that only ADD — a new field, a relation, a default for rows that lacked one. They
        // cannot lose anything that was there, so nothing here needs to know about them.
        case "setDefaultForExisting":
        case "addField":
        case "addRelation":
        case "addRecord":
          break;
        case "renameEntity":
          d.renamedEntities.push({ from: step.from, to: step.to });
          break;
      }
    }
  }
  return d;
}

/**
 * Fields the app stopped declaring while records still hold values under them.
 *
 * Read against the definitions rather than the data, because the data looks perfect: the value is
 * still on disk, byte for byte. What changed is that nothing in the app mentions it any more — no
 * form field, no display binding, no filter — so the person's paragraph is somewhere nobody can get
 * to it, and the next thing that walks the schema will drop it without a word.
 *
 * A rename in either direction is excluded: the value moved, and the destination IS declared.
 */
function findOrphanedFields(
  after: DataSnapshot,
  beforeDef: AppDefinition,
  afterDef: AppDefinition,
  declared: Declared,
): DataSafetyReport["orphanedFields"] {
  const renamed = new Set(declared.renamedFields.map((r) => `${r.entity}.${r.from}`));
  const out: DataSafetyReport["orphanedFields"] = [];

  for (const [entity, def] of Object.entries(beforeDef.entities ?? {})) {
    // The whole chain, not one hop: `A→B→C` left the rows under `C`, and looking under `B` would
    // find nothing and report the entity as holding no values at all.
    const nowCalled = declared.resolve(entity);
    const stillDeclared = afterDef.entities?.[nowCalled]?.fields ?? {};
    const rows = after.get(nowCalled);
    if (!rows?.size) continue;

    for (const field of Object.keys(def.fields ?? {})) {
      if (field in stillDeclared || renamed.has(`${nowCalled}.${field}`)) continue;
      const records = [...rows.values()].filter((r) => r[field] !== undefined).length;
      if (records) out.push({ entity: nowCalled, field, records });
    }
  }
  return out;
}

/** Where a record id lives in a snapshot, if anywhere. */
function locate(snap: DataSnapshot, id: string): { entity: string; fields: Record<string, unknown> } | null {
  for (const [entity, byId] of snap) {
    const fields = byId.get(id);
    if (fields) return { entity, fields };
  }
  return null;
}

/**
 * Compare two snapshots against what the migration chain said it would do.
 *
 * Records are matched by ID ACROSS entities, not within one: a `renameEntity` moves every row to a
 * new key, and matching per-entity would report the whole table as lost and the same rows as new —
 * a false alarm loud enough to make the real ones unreadable.
 */
export function compareData(input: {
  before: DataSnapshot;
  after: DataSnapshot;
  /** The migrations that ACTUALLY ran, not everything the definition declares. */
  chain: readonly Migration[];
  /** The definitions either side of the change, for the orphaned-field check. */
  beforeDef: AppDefinition;
  afterDef: AppDefinition;
}): DataSafetyReport {
  const { before, after, chain, beforeDef, afterDef } = input;
  const declared = declaredBy(chain);
  const lostRecords: LostRecord[] = [];
  const changedValues: FieldChange[] = [];
  const removedFields: DataSafetyReport["removedFields"] = [];

  // `renameField` moves a value rather than losing it; the rename is recorded and the pair is not
  // then reported a second time as "gone from `from`, appeared on `to`".
  const renameFrom = new Map<string, string>();
  for (const r of declared.renamedFields) renameFrom.set(`${r.entity}.${r.from}`, r.to);

  /** Why a value moved or vanished, or null when nothing in the app declared it. */
  const explain = (entity: string, field: string, nextKey: string, next: unknown): string | null => {
    if (next === undefined) {
      // A declared rename that did not deliver the value is loss, not intent — see `renameField`.
      if (renameFrom.has(`${entity}.${field}`)) return null;
      // Nor does `changeType` cover it. A converter that returns `undefined` did not change a
      // type, it deleted a value, and letting the declaration excuse it would explain away the
      // single most likely way a hand-written `via` destroys data.
      return declared.droppedFields.get(entity)?.has(field) ? `dropField ${entity}.${field}` : null;
    }
    if (declared.changedFields.get(entity)?.has(nextKey)) return `changeType ${entity}.${nextKey}`;
    return null;
  };

  for (const [entity, byId] of before) {
    // What the migration steps call this entity, which is not what the snapshot calls it once a
    // `renameEntity` has run. Every declared step is indexed under this name — see `resolverFor`.
    const declaredAs = declared.resolve(entity);
    // A field counts as surviving if ANY record still carries it; a per-record disappearance is
    // already reported as a value change, and "the whole field is gone" is a different finding.
    const survivingFields = new Set<string>();
    const priorFields = new Set<string>();

    for (const [id, fields] of byId) {
      for (const key of Object.keys(fields)) priorFields.add(key);
      const found = locate(after, id);
      if (!found) {
        lostRecords.push({ entity, id });
        continue;
      }
      for (const [field, value] of Object.entries(fields)) {
        const renamedTo = renameFrom.get(`${declaredAs}.${field}`);
        const nextKey = renamedTo ?? field;
        const next = found.fields[nextKey];
        if (next !== undefined) survivingFields.add(field);
        if (next !== undefined && stable(next) === stable(value)) continue;

        changedValues.push({
          entity,
          id,
          field,
          before: value,
          ...(next === undefined ? {} : { after: next }),
          explained: explain(declaredAs, field, nextKey, next),
        });
      }
    }

    for (const field of priorFields) {
      if (survivingFields.has(field)) continue;
      const renamedTo = renameFrom.get(`${declaredAs}.${field}`);
      removedFields.push({
        entity,
        field,
        // The FIELD going away is explained by a declared rename even when the value failed to
        // arrive; that loss is reported on its own, above, and is not softened by this.
        explained: renamedTo
          ? `renameField ${declaredAs}.${field}→${renamedTo}`
          : declared.droppedFields.get(declaredAs)?.has(field)
            ? `dropField ${declaredAs}.${field}`
            : null,
      });
    }
  }

  // A renamed entity is not a removed one: its rows are all still there under the new key, and
  // reporting the whole table as gone would bury the cases where they genuinely are.
  const renamedAway = new Set(declared.renamedEntities.map((r) => r.from));
  const removedEntities = [...before.keys()].filter(
    (e) => !renamedAway.has(e) && (!after.has(e) || after.get(e)!.size === 0),
  );
  const orphanedFields = findOrphanedFields(after, beforeDef, afterDef, declared);
  const unexplained = changedValues.filter((c) => c.explained === null);
  const verdict: DataSafetyReport["verdict"] = lostRecords.length
    ? "loss"
    : unexplained.length ||
        orphanedFields.length ||
        declared.opaqueTransform ||
        removedFields.some((f) => f.explained === null)
      ? "review"
      : "ok";

  return {
    lostRecords,
    removedEntities,
    renamedEntities: declared.renamedEntities,
    removedFields,
    orphanedFields,
    renamedFields: declared.renamedFields,
    changedValues,
    unexplained,
    opaqueTransform: declared.opaqueTransform,
    verdict,
  };
}
