// Syncing the app SOURCE through the space (KA-22).
//
// The dangerous case is not a stale screen — it is the guest running an older schema against
// records written by the newer one. These pin the direction rules that keep that from silently
// resolving the wrong way.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { pendingAppUpdate, publishAppSource, readPublishedApp } from "../src/app-sync.js";

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
