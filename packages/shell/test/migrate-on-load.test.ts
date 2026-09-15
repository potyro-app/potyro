// Running an app's migrations on load (docs/06).
//
// The mechanism existed at both ends and was never called, so no app has ever migrated its data.
// These pin the two things that make it safe to call now: run exactly the steps this device owes,
// and never spin.

import { describe, expect, it } from "vitest";
import type { AppDefinition, Migration } from "karta";
import { MemoryStore } from "@karta/store";
import { migrateOnLoad, migrationChain } from "../src/migrate-on-load.js";

const mig = (from: string, to: string, steps: Migration["steps"]): Migration => ({ from, to, steps });

const M1 = mig("1.0.0", "1.1.0", [{ op: "addField", entity: "note", field: "pinned", default: false }]);
const M2 = mig("1.1.0", "1.2.0", [{ op: "renameField", entity: "note", from: "body", to: "text" }]);

const def = (version: string, migrations: Migration[]): AppDefinition =>
  ({ id: "notes", name: "Notes", version, schemaVersion: 1, entities: {}, pages: [], migrations }) as unknown as AppDefinition;

describe("choosing which migrations to run", () => {
  it("runs nothing for fresh data — it was written by the current version", () => {
    expect(migrationChain([M1, M2], null)).toEqual([]);
  });

  it("runs the whole chain when the device is two versions behind", () => {
    expect(migrationChain([M1, M2], "1.0.0")).toEqual([M1, M2]);
  });

  it("runs only what is owed when the device is one version behind", () => {
    expect(migrationChain([M1, M2], "1.1.0")).toEqual([M2]);
  });

  it("runs nothing when the device is current", () => {
    expect(migrationChain([M1, M2], "1.2.0")).toEqual([]);
  });

  it("terminates on a definition whose migrations loop", () => {
    // Spinning forever on app open is a far worse failure than an un-migrated field.
    const loop = [mig("1.0.0", "1.1.0", []), mig("1.1.0", "1.0.0", [])];
    expect(migrationChain(loop, "1.0.0").length).toBeLessThanOrEqual(2);
  });
});

describe("migrating on load", () => {
  const store = async (): Promise<MemoryStore> => {
    const s = new MemoryStore();
    await s.open("notes");
    return s;
  };

  it("transforms existing records", async () => {
    const s = await store();
    await s.insert("note", { body: "hello" });
    await s.kvSet("__appVersion", "1.0.0");

    const { ran } = await migrateOnLoad(s, def("1.2.0", [M1, M2]));

    expect(ran).toHaveLength(2);
    const [row] = await s.all("note");
    expect(row!.pinned).toBe(false); // addField
    expect(row!.text).toBe("hello"); // renameField
    expect(row!.body).toBeUndefined();
  });

  it("is idempotent — opening again runs nothing", async () => {
    const s = await store();
    await s.insert("note", { body: "hello" });
    await s.kvSet("__appVersion", "1.0.0");
    await migrateOnLoad(s, def("1.2.0", [M1, M2]));

    const second = await migrateOnLoad(s, def("1.2.0", [M1, M2]));
    expect(second.ran).toEqual([]);
    expect((await s.all("note"))[0]!.text).toBe("hello");
  });

  it("stamps the version even when there was nothing to run", async () => {
    // Otherwise the marker is only ever written by a migration, and an app that ships its FIRST
    // migration later has no idea which version its existing data came from.
    const s = await store();
    await s.insert("note", { body: "hello" });

    await migrateOnLoad(s, def("1.0.0", []));

    expect(await s.kvGet("__appVersion")).toBe("1.0.0");
  });

  it("an OLDER copy leaves data a newer one migrated alone (KA-22)", async () => {
    // The data says schema 2; this copy knows schema 1. Recording "1.0.0" as the data's version
    // would make the newer copy run its migrations a second time on its next open.
    const s = await store();
    await s.insert("note", { body: "hello" });
    await s.runMigrations({ fromAppVersion: "1.0.0", toAppVersion: "2.0.0", fromSchemaVersion: 1, toSchemaVersion: 2, migrations: [] });

    const { ran } = await migrateOnLoad(s, def("1.0.0", []));

    expect(ran).toEqual([]);
    expect(await s.kvGet("__appVersion")).toBe("2.0.0");
  });

  it("does not record its version when told this copy is not the newest", async () => {
    const s = await store();
    await s.kvSet("__appVersion", "1.1.0");

    await migrateOnLoad(s, def("1.0.0", []), { recordVersion: false });

    expect(await s.kvGet("__appVersion")).toBe("1.1.0");
  });
});
