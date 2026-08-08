// Opening a store under an identity minted elsewhere (ADR D2 amended).
//
// `@karta/identity` mints the account with crypto alone — no database, no `LocalNode` — so that a
// person who never turns on sync still has a `ctx.me` without loading a CRDT engine. The
// consequence is that the FIRST time any app syncs, cojson's storage has never seen the account
// CoValue, and loading it fails exactly as it does across a database boundary.
//
// So the store materialises it from the same secret. That is safe only because the account id is
// derived from the secret rather than assigned: create-from-secret and derive-from-secret agree, so
// materialising cannot mint a second identity behind the person's back. This pins that.

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

/** What `@karta/identity` produces, without depending on it from here. */
function mintedIdentity(): { id: string; secret: string } {
  const seed = crypto.newRandomSecretSeed();
  const secret = crypto.agentSecretFromSecretSeed(seed);
  return { id: accountIdFor(secret), secret: secret as unknown as string };
}

function accountIdFor(secret: unknown): string {
  // The same purely-local derivation `PassphraseAuth.logIn` uses to recognise a returning person.
  const internals = (cojsonInternals ?? {}) as {
    idforHeader(header: unknown, c: unknown): string;
    accountHeaderForInitialAgentSecret(s: unknown, c: unknown): unknown;
  };
  return internals.idforHeader(internals.accountHeaderForInitialAgentSecret(secret, crypto), crypto);
}

let cojsonInternals: unknown;
beforeAll(async () => {
  ({ cojsonInternals } = await import("cojson"));
});

describe("an account minted outside the store", () => {
  it("is materialised on first sync and keeps its id", async () => {
    const identity = mintedIdentity();

    const handle = await createJazzStore("split", {
      db: await memoryDb(),
      crypto,
      keys: memoryKeys(),
      account: identity,
    });

    // Not a new account: the one identity already promised.
    expect(handle.accountID).toBe(identity.id);
    await handle.store.insert("expense", { description: "Dinner" });
    expect(await handle.store.all("expense")).toHaveLength(1);
  });

  it("reopens the same account rather than materialising a second one", async () => {
    const identity = mintedIdentity();
    const keys = memoryKeys();
    const db = await memoryDb();

    const first = await createJazzStore("split", { db, crypto, keys, account: identity });
    await first.store.insert("expense", { description: "Dinner" });

    const again = await createJazzStore("split", { db, crypto, keys, account: identity });
    expect(again.accountID).toBe(identity.id);
    expect(await again.store.all("expense")).toHaveLength(1);
  });

  it("gives two apps one identity and separate spaces", async () => {
    const identity = mintedIdentity();
    const keys = memoryKeys();
    const db = await memoryDb();

    const split = await createJazzStore("split", { db, crypto, keys, account: identity });
    const plants = await createJazzStore("plants", { db, crypto, keys, account: identity });

    expect(plants.accountID).toBe(split.accountID);
    expect(plants.groupID).not.toBe(split.groupID);
  });

  it("does not fall back to minting when the failure is not a missing account", async () => {
    // Materialising is narrow on purpose. A bad secret must surface, not quietly become a second
    // identity that strands every space the person belonged to.
    await expect(
      createJazzStore("split", {
        db: await memoryDb(),
        crypto,
        keys: memoryKeys(),
        account: { id: "co_zNotARealAccountId", secret: "sealerSecret_zBadlyFormed/signerSecret_zAlsoBad" },
      }),
    ).rejects.toThrow();
  });
});
