// The identity's secrets live in a vault, not in plain storage (#57).
//
// The real browser vault (IndexedDB + a non-extractable WebCrypto key) needs a browser and is proven
// in `e2e/identity-linking-trusted.spec.ts`; these pin the rules every vault is used under: secrets
// go in, plain copies come out — and only once the vault has agreed — and nothing is ever lost.

import { describe, expect, it } from "vitest";
import {
  IdentityKeysMissingError,
  deferredVault,
  ensureIdentity,
  identityAccount,
  memoryVault,
  peekIdentity,
  recoveryPassphrase,
  secureIdentitySecrets,
  signInWithPassphrase,
  type IdentityKeys,
  type SecretVault,
} from "../src/index.js";

const SECRET_KEYS = ["karta:identity:seed", "karta:identity:secret"];

function device(secrets?: SecretVault): { keys: IdentityKeys; plain: Map<string, string> } {
  const plain = new Map<string, string>();
  return {
    plain,
    keys: { get: (k) => plain.get(k) ?? null, set: (k, v) => void plain.set(k, v), remove: (k) => void plain.delete(k), ...(secrets ? { secrets } : {}) },
  };
}

describe("a new identity", () => {
  it("keeps its seed and secret in the vault, and only the id and name in plain storage", async () => {
    const vault = memoryVault();
    const { keys, plain } = device(vault);
    const me = await ensureIdentity(keys);

    for (const k of SECRET_KEYS) {
      expect(plain.has(k)).toBe(false);
      expect(vault.map.get(k)).toBeTruthy();
    }
    expect(peekIdentity(keys)).toEqual(me); // still answered synchronously
    expect((await identityAccount(keys)).secret).toBe(vault.map.get("karta:identity:secret"));
    expect((await recoveryPassphrase(keys)).split(" ")).toHaveLength(24);
  });

  it("signs in with words into the vault too", async () => {
    const donor = device(memoryVault());
    const words = (await ensureIdentity(donor.keys), await recoveryPassphrase(donor.keys));
    const vault = memoryVault();
    const { keys, plain } = device(vault);
    const me = await signInWithPassphrase(words, keys);
    expect(me.id).toBe(peekIdentity(donor.keys)!.id);
    expect(SECRET_KEYS.some((k) => plain.has(k))).toBe(false);
  });
});

describe("a device from before the vault", () => {
  it("moves its plain secrets into the vault at boot, and removes the plain copies", async () => {
    const { keys: old, plain } = device(); // an older build: no vault
    const me = await ensureIdentity(old);
    const secret = plain.get("karta:identity:secret");

    const vault = memoryVault();
    const upgraded: IdentityKeys = { ...old, secrets: vault };
    await secureIdentitySecrets(upgraded);

    expect(SECRET_KEYS.some((k) => plain.has(k))).toBe(false);
    expect(vault.map.get("karta:identity:secret")).toBe(secret);
    expect(await identityAccount(upgraded)).toEqual({ id: me.id, secret });
  });

  it("keeps the plain copy when the vault did not take it — never loses the secret", async () => {
    const { keys: old, plain } = device();
    await ensureIdentity(old);
    const secret = plain.get("karta:identity:secret");
    const broken: SecretVault = { available: async () => true, get: async () => null, set: async () => {}, remove: async () => {} };

    await secureIdentitySecrets({ ...old, secrets: broken });

    expect(plain.get("karta:identity:secret")).toBe(secret);
    expect((await identityAccount({ ...old, secrets: broken })).secret).toBe(secret);
  });

  it("moves an account adopted from the old store into the vault as well", async () => {
    const vault = memoryVault();
    const { keys, plain } = device(vault);
    plain.set("karta:jazz:accountID", "co_zLegacy");
    plain.set("karta:jazz:accountSecret", "sealerSecret_legacy/signerSecret_legacy");

    const me = await ensureIdentity(keys);

    expect(me.id).toBe("co_zLegacy");
    expect(plain.has("karta:jazz:accountSecret")).toBe(false);
    expect(plain.has("karta:identity:secret")).toBe(false);
    expect((await identityAccount(keys)).secret).toBe("sealerSecret_legacy/signerSecret_legacy");
  });
});

describe("where there is no vault", () => {
  it("works exactly as before in plain storage", async () => {
    const unavailable: SecretVault = { available: async () => false, get: async () => null, set: async () => { throw new Error("no"); }, remove: async () => {} };
    const { keys, plain } = device(unavailable);
    const me = await ensureIdentity(keys);
    expect(plain.get("karta:identity:secret")).toBeTruthy();
    expect((await identityAccount(keys)).id).toBe(me.id);
  });

  it("a deferred vault that finds nothing behaves as no vault", async () => {
    const { keys, plain } = device(deferredVault(async () => null));
    await ensureIdentity(keys);
    expect(plain.get("karta:identity:secret")).toBeTruthy();
  });
});

describe("a vault that lost its secrets", () => {
  it("says so in words, rather than opening a store with no key or minting a stranger", async () => {
    const vault = memoryVault();
    const { keys } = device(vault);
    const me = await ensureIdentity(keys);
    vault.map.clear(); // site storage partly cleared

    await expect(identityAccount(keys)).rejects.toBeInstanceOf(IdentityKeysMissingError);
    expect(peekIdentity(keys)?.id).toBe(me.id); // still the same person; not replaced
  });
});
