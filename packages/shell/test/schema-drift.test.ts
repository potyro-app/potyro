// The check that would have warned a real user before their todo list emptied itself.
//
// Their sequence: "a shared todo list" → worked. "items can belong to groups" → the list stopped
// working. The agent added a `group` entity, added a REQUIRED `group` relation to `item`, and made
// the only route to items go through a group — while leaving `schemaVersion: 1` and shipping no
// migrations. Every todo they had written was still stored and appeared nowhere.

import { describe, expect, it } from "vitest";
import { describeDrift, schemaDrift } from "../src/schema-drift.js";

const BEFORE = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: {
    item: { label: "Item", displayField: "name", fields: { name: { type: "text", required: true }, position: { type: "number" } } },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "name" } } }],
});
`;

/** The real shape of the edit that broke it: a new required relation, same schemaVersion. */
const AFTER_BROKEN = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: {
    group: { label: "Group", displayField: "name", fields: { name: { type: "text", required: true } } },
    item: { label: "Item", displayField: "name", fields: { name: { type: "text", required: true }, position: { type: "number" }, group: { type: "relation", to: "group", required: true } } },
  },
  pages: [{ id: "groups", title: "Groups", view: { type: "list", entity: "group", display: { primary: "name" } } }],
});
`;

/**
 * Doing it properly: BOTH versions move, and the migration is keyed to the app version.
 *
 * The first version of this file used `{ from: "1", to: "2" }` and called it correct, because that
 * is what the generator's contract told the model to write. It is not. `migrateOnLoad` walks the
 * chain by matching `from` against the app version the stored data was written under — "1.0.0" —
 * so that migration matches nothing and never runs. It parsed, it validated, and it silenced the
 * very warning this file exists to prove works.
 */
const AFTER_MIGRATED = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 2")
  .replace('version: "1.0.0"', 'version: "1.1.0"')
  .replace(
    "  pages:",
    `  migrations: [{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addRelation", entity: "item", field: "group", to: "group" }] }],
  pages:`,
  );

/** The same edit, migrated the way the old contract taught: keyed on schemaVersion, so inert. */
const AFTER_INERT_MIGRATION = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 2").replace(
  "  pages:",
  `  migrations: [{ from: "1", to: "2", steps: [{ op: "addRelation", entity: "item", field: "group", to: "group" }] }],
  pages:`,
);

describe("schema drift", () => {
  it("warns when a field is added to an existing entity with no migration", async () => {
    const drift = await schemaDrift(BEFORE, AFTER_BROKEN);
    expect(drift).not.toBeNull();
    expect(drift!.addedFields).toContain("item.group");
    expect(drift!.versionBumped).toBe(false);
    expect(drift!.hasMigrations).toBe(false);

    const message = describeDrift(drift);
    expect(message, "the user got no warning at all").not.toBeNull();
    expect(message).toContain("item.group");
    expect(message).toContain("schemaVersion");
    expect(message).toContain("stop appearing");
  });

  it("says nothing when the app bumped the version AND shipped a migration", async () => {
    // Otherwise every correct change nags too, and the warning stops being read.
    expect(describeDrift(await schemaDrift(BEFORE, AFTER_MIGRATED))).toBeNull();
  });

  it("says nothing when only pages or logic changed", async () => {
    const cosmetic = BEFORE.replace('title: "Items"', 'title: "To do"');
    expect(describeDrift(await schemaDrift(BEFORE, cosmetic))).toBeNull();
  });

  it("treats a brand-new entity's own fields as nothing to migrate", async () => {
    const drift = await schemaDrift(BEFORE, AFTER_BROKEN);
    expect(drift!.addedFields).not.toContain("group.name");
  });

  it("still warns when the migration is keyed on schemaVersion and can never run", async () => {
    // The failure mode that hid inside "hasMigrations". `migrations:` is present, the array is not
    // empty, the steps are right — and `from: "1"` matches no stored version, so the records are
    // left exactly as they were. Reported as if it had been handled, this is worse than no
    // migration at all: the warning that would have sent someone to History never appears.
    const drift = await schemaDrift(BEFORE, AFTER_INERT_MIGRATION);
    expect(drift!.versionBumped, "schemaVersion did move").toBe(true);
    expect(drift!.hasMigrations, "but nothing will run").toBe(false);
    expect(describeDrift(drift)).toContain("will run");
  });

  it("still warns when `migrations` is an empty array", async () => {
    const empty = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 2").replace(
      "  pages:",
      "  migrations: [],\n  pages:",
    );
    expect(describeDrift(await schemaDrift(BEFORE, empty))).not.toBeNull();
  });

  it("still warns when the migration is there but the app version never moved", async () => {
    // `from` has to be the version the data was written under. If `version` did not change, there is
    // no version for the new data to be at, and the chain has nowhere to go.
    const sameVersion = AFTER_MIGRATED.replace('version: "1.1.0"', 'version: "1.0.0"');
    expect(describeDrift(await schemaDrift(BEFORE, sameVersion))).not.toBeNull();
  });

  it("accepts a chain of hops that reaches the new version", async () => {
    // Two edits in a row, each leaving its own migration behind. Walking the chain (rather than
    // looking for one matching hop) is what makes a device two versions behind catch up.
    const twoHops = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 3")
      .replace('version: "1.0.0"', 'version: "1.2.0"')
      .replace(
        "  pages:",
        `  migrations: [
    { from: "1.0.0", to: "1.1.0", steps: [{ op: "addRelation", entity: "item", field: "group", to: "group" }] },
    { from: "1.1.0", to: "1.2.0", steps: [{ op: "setDefaultForExisting", entity: "item", field: "position", value: 0 }] },
  ],
  pages:`,
      );
    expect(describeDrift(await schemaDrift(BEFORE, twoHops))).toBeNull();
  });

  it("does not mistake a renameField step's from/to for a version hop", async () => {
    // Steps carry `from`/`to` as well. Only semver-looking pairs count as hops, so a rename cannot
    // fake a chain that reaches the new version.
    const renameOnly = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 2")
      .replace('version: "1.0.0"', 'version: "1.1.0"')
      .replace(
        "  pages:",
        `  migrations: [{ from: "9.9.9", to: "9.9.10", steps: [{ op: "renameField", entity: "item", from: "name", to: "title" }] }],
  pages:`,
      );
    expect(describeDrift(await schemaDrift(BEFORE, renameOnly))).not.toBeNull();
  });
});
