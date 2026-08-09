// Adopting an account that already existed (regression).
//
// Identity moved from `packages/store` into this package. A device that had synced ANYTHING before
// that move already had an account under `karta:jazz:accountID`/`accountSecret`, and every space and
// record on it is signed by that account.
//
// The move shipped without this: `ensureIdentity` saw no `karta:identity:*` keys and minted a fresh
// account, so the device woke up as a stranger to its own data and existing apps failed to open. The
// fix is to adopt, never replace — and these pin it, because the failure is silent until someone
// opens an app they already had.

import { describe, expect, it } from "vitest";
import { ensureIdentity, identityAccount, peekIdentity, recoveryPassphrase, type IdentityKeys } from "../src/index.js";

function keysWith(entries: Record<string, string>): { keys: IdentityKeys; map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return { keys: { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) }, map };
}

const LEGACY = {
  "karta:jazz:accountID": "co_zLegacyAccount123",
  "karta:jazz:accountSecret": "sealerSecret_zLegacy/signerSecret_zLegacy",
};

describe("a device that synced before identity moved here", () => {
  it("adopts the existing account instead of minting a new one", async () => {
    const { keys } = keysWith(LEGACY);
    const me = await ensureIdentity(keys);
    expect(me.id).toBe(LEGACY["karta:jazz:accountID"]);
  });

  it("hands the store the SAME secret, so existing spaces stay readable", async () => {
    // The id alone is not enough: the spaces are encrypted to the account, so a matching id with a
    // different secret would still open every existing app empty.
    const { keys } = keysWith(LEGACY);
    expect((await identityAccount(keys)).secret).toBe(LEGACY["karta:jazz:accountSecret"]);
  });

  it("is stable across calls and reloads", async () => {
    const { keys } = keysWith(LEGACY);
    const first = await ensureIdentity(keys);
    expect((await ensureIdentity(keys)).id).toBe(first.id);
    expect(peekIdentity(keys)!.id).toBe(first.id);
  });

  it("says plainly that an adopted account has no recovery passphrase", async () => {
    // The old code let cojson generate a random agent secret, so there is no seed and none can be
    // derived after the fact. Saying so is the only honest option — inventing words that restore
    // nothing would be worse than refusing.
    const { keys } = keysWith(LEGACY);
    await ensureIdentity(keys);
    await expect(recoveryPassphrase(keys)).rejects.toThrow(/cannot be linked/i);
  });

  it("adopts the seed too when the store had already started keeping one", async () => {
    const seed = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const { keys } = keysWith({ ...LEGACY, "karta:jazz:accountSeed": seed });
    await ensureIdentity(keys);
    // Present seed ⇒ the passphrase works, so such a device keeps multi-device.
    expect((await recoveryPassphrase(keys)).split(" ")).toHaveLength(24);
  });

  it("still mints for a genuinely new device", async () => {
    const { keys } = keysWith({});
    const me = await ensureIdentity(keys);
    expect(me.id).toMatch(/^co_/);
    expect(me.id).not.toBe(LEGACY["karta:jazz:accountID"]);
  });

  it("leaves an identity alone once it already matches the legacy account", async () => {
    const { keys } = keysWith({
      ...LEGACY,
      "karta:identity:id": LEGACY["karta:jazz:accountID"],
      "karta:identity:secret": LEGACY["karta:jazz:accountSecret"],
    });
    expect((await ensureIdentity(keys)).id).toBe(LEGACY["karta:jazz:accountID"]);
  });

  // NOTE: an identity that DIFFERS from the legacy account and carries no origin marker is not
  // "already owned" — it is the wreckage of the build that minted over an existing account, and it
  // owns none of this device's data. That case is reclaimed; see the next block.
});

describe("reclaiming after the build that minted over an existing account", () => {
  // This is the state of any device that opened an app while the regression was live: identity
  // minted a fresh account, which owns none of that device's data.
  const minted = {
    "karta:identity:id": "co_zFreshlyMinted",
    "karta:identity:secret": "sealerSecret_zFresh/signerSecret_zFresh",
    "karta:identity:seed": "aa".repeat(32),
  };

  it("gives the device its real account back", async () => {
    const { keys } = keysWith({ ...LEGACY, ...minted });
    expect((await ensureIdentity(keys)).id).toBe(LEGACY["karta:jazz:accountID"]);
    expect((await identityAccount(keys)).secret).toBe(LEGACY["karta:jazz:accountSecret"]);
  });

  it("does NOT undo a deliberate passphrase sign-in", async () => {
    // Someone who linked this device chose that identity. Leftover legacy keys must not silently
    // unlink them — which is the whole reason the origin marker exists.
    const { keys } = keysWith({ ...LEGACY, ...minted, "karta:identity:origin": "passphrase" });
    expect((await ensureIdentity(keys)).id).toBe("co_zFreshlyMinted");
  });

  it("leaves an already-adopted identity alone", async () => {
    const { keys } = keysWith({
      ...LEGACY,
      "karta:identity:id": LEGACY["karta:jazz:accountID"],
      "karta:identity:secret": LEGACY["karta:jazz:accountSecret"],
      "karta:identity:origin": "adopted",
    });
    expect((await ensureIdentity(keys)).id).toBe(LEGACY["karta:jazz:accountID"]);
  });

  it("does not reclaim on a device that never had a legacy account", async () => {
    const { keys } = keysWith(minted);
    expect((await ensureIdentity(keys)).id).toBe("co_zFreshlyMinted");
  });
});
