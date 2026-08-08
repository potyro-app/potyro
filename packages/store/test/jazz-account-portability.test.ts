// Why cojson gets ONE database per device rather than one per app.
//
// The device account is global — one person across all their apps — but its CoValue is only ever
// written to the database that created it, and cojson cannot reconstitute an account from
// `{accountID, accountSecret}` alone. Give each app its own database and the SECOND synced app
// reads the saved secret against an empty store and dies with `Account unavailable from all peers`.
//
// That was live: `openJazzStore` opened `${appId}-jazz`. It stayed invisible because a dev relay can
// serve the account CoValue back over the wire, and because every other test in this package passes
// both apps a single shared `db`. A local-only synced app — no relay at all, which ADR D3 calls the
// default — had neither escape.
//
// The first test pins the engine constraint (so "let's give each app its own file again" fails
// loudly rather than in a user's second app); the second pins the property that makes one shared
// file safe.

import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, type JazzKeyStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

function memoryKeys(): JazzKeyStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

async function memoryDb() {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "c");
}

describe("the device account cannot cross a database boundary", () => {
  it("refuses to load an account from a database that never saw it", async () => {
    // One key store (the browser's localStorage, shared by every app) but two databases — which is
    // exactly what a database-per-app layout produces on a device with two synced apps.
    const keys = memoryKeys();
    await createJazzStore("split", { db: await memoryDb(), crypto, keys });

    await expect(createJazzStore("plants", { db: await memoryDb(), crypto, keys })).rejects.toThrow(
      /Account unavailable/i,
    );
  });

  it("two apps in the ONE device database share an identity and stay isolated anyway", async () => {
    // The shipped layout. Isolation comes from the group, not from the file.
    const keys = memoryKeys();
    const db = await memoryDb();

    const split = await createJazzStore("split", { db, crypto, keys });
    const plants = await createJazzStore("plants", { db, crypto, keys });

    expect(plants.accountID).toBe(split.accountID); // the same person
    expect(plants.groupID).not.toBe(split.groupID); // different spaces

    await split.store.insert("expense", { description: "Dinner" });
    await plants.store.insert("plant", { name: "Fern" });

    expect(await plants.store.all("expense")).toHaveLength(0); // no leakage either way
    expect(await split.store.all("plant")).toHaveLength(0);

    // And a reload of the second app still works — reconstituting an identity that can no longer
    // sign anything would be the subtle version of this failure.
    const again = await createJazzStore("plants", { db, crypto, keys });
    expect(again.accountID).toBe(split.accountID);
    expect(await again.store.all("plant")).toHaveLength(1);
  });
});
