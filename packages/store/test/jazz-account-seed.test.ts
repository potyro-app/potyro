// The device account must be derived from a seed we keep (ADR D2a).
//
// This is the whole basis of linking a second device. The recovery passphrase is a BIP39 encoding
// of a 32-byte *secret seed*, and Jazz reconstructs both the secret and the account id from it:
//
//     seed -> agentSecretFromSecretSeed(seed) -> idforHeader(accountHeaderForInitialAgentSecret(...))
//
// cojson's `withNewlyCreatedAccount` defaults `initialAgentSecret` to `newRandomAgentSecret()`,
// which has no seed behind it. An account created that way can never produce a passphrase —
// `getCurrentAccountPassphrase` looks for a stored seed and finds none — so multi-device would have
// been permanently impossible for every account created before anyone noticed, with no migration
// available afterwards (you cannot invent the seed of an existing key).
//
// Hence the test: it fails if account creation ever stops passing an explicit seed.

import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, type JazzKeyStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

function memoryKeys(): { store: JazzKeyStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { store: { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) }, map };
}

async function memoryDb() {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "c");
}

const fromHex = (s: string): Uint8Array => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

describe("device account is seed-derived", () => {
  it("keeps a 32-byte secret seed alongside the account", async () => {
    const keys = memoryKeys();
    await createJazzStore("split", { db: await memoryDb(), crypto, keys: keys.store });

    const hex = keys.map.get("karta:jazz:accountSeed");
    expect(hex, "no seed stored — the account can never produce a recovery passphrase").toBeTruthy();
    expect(fromHex(hex!)).toHaveLength(32);
  });

  it("re-derives the SAME account secret from the stored seed alone", async () => {
    // This is what a second device does with nothing but the words: seed in, identity out. If the
    // secret did not match, the passphrase would be decorative.
    const keys = memoryKeys();
    await createJazzStore("split", { db: await memoryDb(), crypto, keys: keys.store });

    const seed = fromHex(keys.map.get("karta:jazz:accountSeed")!);
    const derived = crypto.agentSecretFromSecretSeed(seed);

    expect(derived).toBe(keys.map.get("karta:jazz:accountSecret"));
  });
});
