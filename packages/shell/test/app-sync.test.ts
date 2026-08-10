// Syncing the app SOURCE through the space (KA-22).
//
// The dangerous case is not a stale screen — it is the guest running an older schema against
// records written by the newer one. These pin the direction rules that keep that from silently
// resolving the wrong way.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { isSchemaBehind, pendingAppUpdate, publishAppSource, readPublishedApp, schemaVersionOf } from "../src/app-sync.js";
import { readOnlyStore } from "../src/read-only-store.js";

const store = async (): Promise<MemoryStore> => {
  const s = new MemoryStore();
  await s.open("test");
  return s;
};

const OLD = { source: "v1", name: "Todo", updatedAt: "2026-08-08T10:00:00.000Z" };
const NEW = { source: "v2", name: "Todo", updatedAt: "2026-08-08T11:00:00.000Z" };

describe("publishing", () => {
  it("publishes when nothing is there yet", async () => {
    const s = await store();
    expect(await publishAppSource(s, OLD)).toBe(true);
    expect((await readPublishedApp(s))?.source).toBe("v1");
  });

  it("publishes a newer copy over an older one", async () => {
    const s = await store();
    await publishAppSource(s, OLD);
    expect(await publishAppSource(s, NEW)).toBe(true);
    expect((await readPublishedApp(s))?.source).toBe("v2");
  });

  it("carries WHY the source changed, not just the source", async () => {
    // Without this, an update adopted from someone else landed in History as "updated by a
    // collaborator" and nothing else: the app changed under you, and the record of what was asked
    // for existed only on the device that asked. History exists to answer exactly that question.
    const s = await store();
    await publishAppSource(s, {
      ...NEW,
      note: "add +1 / −1 buttons and show the count",
      rationale: "Two numeric fields on `item`, plus buttons inside the existing render.",
    });

    const read = await readPublishedApp(s);
    expect(read?.note).toBe("add +1 / −1 buttons and show the count");
    expect(read?.rationale).toContain("Two numeric fields");
  });

  it("REFUSES to publish an older copy over a newer one", async () => {
    // The data-loss case: a guest who declined an update must not push their stale source back
    // over the author's. Declining has to be a no-op, not a rollback for everyone.
    const s = await store();
    await publishAppSource(s, NEW);
    expect(await publishAppSource(s, OLD)).toBe(false);
    expect((await readPublishedApp(s))?.source).toBe("v2");
  });
});

describe("detecting an update", () => {
  it("offers a newer published source", async () => {
    const s = await store();
    await publishAppSource(s, NEW);
    expect((await pendingAppUpdate(s, OLD))?.source).toBe("v2");
  });

  it("offers nothing when this copy is the newer one", async () => {
    const s = await store();
    await publishAppSource(s, OLD);
    expect(await pendingAppUpdate(s, NEW)).toBeNull();
  });

  it("offers nothing when the source is identical", async () => {
    // Same content with a newer timestamp is not an update; prompting would be noise.
    const s = await store();
    await publishAppSource(s, { ...OLD, updatedAt: NEW.updatedAt });
    expect(await pendingAppUpdate(s, OLD)).toBeNull();
  });

  it("offers nothing when the space has no published source", async () => {
    expect(await pendingAppUpdate(await store(), OLD)).toBeNull();
  });

  it("survives a corrupt entry instead of blocking the app from opening", async () => {
    const s = await store();
    await s.kvSet("__appSource", "{not json");
    expect(await readPublishedApp(s)).toBeNull();
    expect(await pendingAppUpdate(s, OLD)).toBeNull();
  });
});

describe("the schema gate", () => {
  const at = (v: number, ts: string) => ({ source: `schemaVersion: ${v}`, name: "Todo", updatedAt: ts });

  it("locks a copy that is behind the space's schema", async () => {
    // The corrupting case: an old app writing records in a shape the current app does not expect,
    // replicated to every peer.
    expect(isSchemaBehind(at(1, "a"), at(2, "b"))).toBe(true);
  });

  it("does not lock an equal or newer copy", async () => {
    expect(isSchemaBehind(at(2, "a"), at(2, "b"))).toBe(false);
    expect(isSchemaBehind(at(3, "a"), at(2, "b"))).toBe(false);
  });

  it("stays open when a version cannot be read", async () => {
    // Locking someone out of their own app on a failed regex would be worse than the risk it
    // guards against.
    expect(isSchemaBehind({ source: "no version here", name: "T", updatedAt: "a" }, at(2, "b"))).toBe(false);
    expect(isSchemaBehind(at(1, "a"), { source: "no version here", name: "T", updatedAt: "b" })).toBe(false);
  });

  it("stays open when the space has published nothing", async () => {
    expect(isSchemaBehind(at(1, "a"), null)).toBe(false);
  });

  it("reads schemaVersion out of real app source without evaluating it", async () => {
    expect(schemaVersionOf('export default defineApp({ id: "x", schemaVersion: 4, entities: {} })')).toBe(4);
    expect(schemaVersionOf("schemaVersion:  12,")).toBe(12);
    expect(schemaVersionOf("no version")).toBeUndefined();
  });
});

describe("a read-only store", () => {
  it("serves reads but refuses every write", async () => {
    const s = await store();
    const r = await s.insert("todo", { title: "milk" });
    const ro = readOnlyStore(s, "older version");

    expect((await ro.all("todo")).map((x) => x.title)).toEqual(["milk"]);
    expect((await ro.get("todo", r.id))?.title).toBe("milk");

    // Loud, not silent: a no-op would look like the app was broken.
    await expect(ro.insert("todo", { title: "bread" })).rejects.toThrow(/older version/);
    await expect(ro.update("todo", r.id, { title: "x" })).rejects.toThrow(/older version/);
    await expect(ro.delete("todo", r.id)).rejects.toThrow(/older version/);
    await expect(ro.kvSet("k", "v")).rejects.toThrow(/older version/);
    // A transaction that could only fail must fail immediately, not part-way through.
    await expect(ro.transaction(async () => undefined)).rejects.toThrow(/older version/);

    // The underlying data is untouched.
    expect((await s.all("todo")).map((x) => x.title)).toEqual(["milk"]);
  });
});
