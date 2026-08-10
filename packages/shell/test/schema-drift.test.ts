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

const AFTER_MIGRATED = AFTER_BROKEN.replace("schemaVersion: 1", "schemaVersion: 2").replace(
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
});
