// What your account knows about your apps (KA-16 follow-up).
//
// The failure this exists to end: type the recovery words on a new device and it is you — same
// account, still a member of every space — but it has no idea what you HAVE, because the app list
// and the ids of the spaces holding their data live in the other browser's localStorage. So the
// list moves onto the account, where the words can reach it.
//
// Two NODES over one account is the whole test: writing on one and reading on the other is exactly
// "my laptop wrote it, my new phone read it".

import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, openAccountNode, publishAppToAccount, readAccountApps, removeAppFromAccount, type JazzKeyStore } from "../src/index.js";

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

const APP = {
  id: "split",
  name: "Split",
  icon: "🧾",
  source: 'import { defineApp } from "karta";\nexport default defineApp({ id: "split" });\n',
  group: "co_zGROUP",
  root: "co_zROOT",
  sizeBytes: 4_200,
  updatedAt: "2026-09-18T10:00:00.000Z",
};

describe("the apps your account knows about", () => {
  it("records an app and reads it back, with everything needed to open it", async () => {
    const keys = memoryKeys();
    const handle = await createJazzStore("split", { db: await memoryDb(), crypto, keys });

    expect(await publishAppToAccount(handle.node, APP)).toBe(true);
    const [app] = await readAccountApps(handle.node);
    // The code AND where the data is: a new device can run the app before a single record arrives,
    // and knows which space to ask for.
    expect(app).toMatchObject({ id: "split", name: "Split", icon: "🧾", group: "co_zGROUP", root: "co_zROOT" });
    expect(app?.source).toContain("defineApp");
    // And enough to ask "this one is 400 MB, do you want it on this phone?"
    expect(app?.sizeBytes).toBe(4_200);
  });

  it("is empty — not an error — on a device that has never written one", async () => {
    const handle = await createJazzStore("plants", { db: await memoryDb(), crypto, keys: memoryKeys() });
    expect(await readAccountApps(handle.node)).toEqual([]);
  });

  it("updates an app in place rather than listing it twice", async () => {
    const keys = memoryKeys();
    const handle = await createJazzStore("split", { db: await memoryDb(), crypto, keys });
    await publishAppToAccount(handle.node, APP);
    await publishAppToAccount(handle.node, { ...APP, name: "Split the bill", sizeBytes: 9_000 });

    const apps = await readAccountApps(handle.node);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "Split the bill", sizeBytes: 9_000 });
  });

  it("forgets an app you deleted, so a new device is not offered it back", async () => {
    const keys = memoryKeys();
    const handle = await createJazzStore("split", { db: await memoryDb(), crypto, keys });
    await publishAppToAccount(handle.node, APP);
    await publishAppToAccount(handle.node, { ...APP, id: "plants", name: "Plants" });

    expect(await removeAppFromAccount(handle.node, "split")).toBe(true);
    expect((await readAccountApps(handle.node)).map((a) => a.id)).toEqual(["plants"]);
  });

  it("the list written on one device is the list a second one reads", async () => {
    // One account, two nodes — a laptop and a new phone — sharing a database the way two devices
    // share the relay. Without this, linking a device produced a correctly-attributed empty screen.
    const keys = memoryKeys();
    const db = await memoryDb();
    const laptop = await createJazzStore("split", { db, crypto, keys });
    await publishAppToAccount(laptop.node, APP);
    await publishAppToAccount(laptop.node, { ...APP, id: "groceries", name: "Groceries", icon: "🛒", sizeBytes: 40_000 });
    // Written means WRITTEN DOWN: a second node reads from storage, so a list still sitting in the
    // first one's memory is a list the new device does not have.
    await laptop.whenDurable();

    // The second device: the same account (as the words would give it), a different app open.
    const phone = await createJazzStore("groceries", { db, crypto, keys });
    const apps = await readAccountApps(phone.node);
    expect(apps.map((a) => a.name)).toEqual(["Groceries", "Split"]);
    // It can tell a cheap app from an expensive one BEFORE downloading either.
    expect(apps.map((a) => a.sizeBytes)).toEqual([40_000, 4_200]);
  });

  it("a device that has no apps at all can still read the list", async () => {
    // The actual moment this feature exists for: the words have just been typed on a new phone.
    // There is no app to open, so there is nothing to hang a node off — which is why the account
    // half of opening a store is its own function now.
    const keys = memoryKeys();
    const db = await memoryDb();
    const laptop = await createJazzStore("split", { db, crypto, keys });
    await publishAppToAccount(laptop.node, APP);
    await laptop.whenDurable();

    const phone = await openAccountNode({ db, crypto, keys });
    const apps = await readAccountApps(phone.node);
    expect(apps.map((a) => a.id)).toEqual(["split"]);
    // And what it needs to go and get it.
    expect(apps[0]).toMatchObject({ group: "co_zGROUP", root: "co_zROOT" });
  });
});
