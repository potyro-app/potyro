// Device identity (KA-16). Everything here runs with no database, no node and no network — which
// is itself the point, not merely convenient: a person who never turns on sync must still have an
// identity without ever loading a CRDT engine.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAME,
  ensureIdentity,
  identityAccount,
  peekIdentity,
  recoveryPassphrase,
  renameIdentity,
  signInWithPassphrase,
  type IdentityKeys,
} from "../src/index.js";

function memoryKeys(): { keys: IdentityKeys; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { keys: { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) }, map };
}

describe("minting an identity", () => {
  it("has none before first run, and one after", async () => {
    const { keys } = memoryKeys();
    expect(peekIdentity(keys)).toBeNull();

    const me = await ensureIdentity(keys);
    expect(me.id).toMatch(/^co_/);
    expect(me.name).toBe(DEFAULT_NAME);
    expect(peekIdentity(keys)).toEqual(me);
  });

  it("mints once and only once", async () => {
    const { keys } = memoryKeys();
    const first = await ensureIdentity(keys);
    const second = await ensureIdentity(keys);
    expect(second.id).toBe(first.id);
  });

  it("answers from cache, so a later run never needs crypto", async () => {
    // `peekIdentity` is synchronous by design: `ctx.me` is read on every evaluation pass and must
    // not be able to pull a wasm module into an app that never asked for sync.
    const { keys } = memoryKeys();
    const me = await ensureIdentity(keys);
    expect(peekIdentity(keys)).toEqual(me); // no await anywhere
  });

  it("does not report a half-written identity", async () => {
    // The id is written last precisely so an interrupted first run mints cleanly next time rather
    // than surfacing an identity whose seed is missing — an account that could never be linked.
    const { keys, map } = memoryKeys();
    await ensureIdentity(keys);
    map.delete("potyro:identity:id");
    expect(peekIdentity(keys)).toBeNull();
  });
});

describe("naming", () => {
  it("renames without touching the id", async () => {
    const { keys } = memoryKeys();
    const me = await ensureIdentity(keys);
    const renamed = renameIdentity("Ana", keys);
    expect(renamed.name).toBe("Ana");
    expect(renamed.id).toBe(me.id); // a name is a label, not an identity
  });

  it("refuses a blank name", async () => {
    const { keys } = memoryKeys();
    await ensureIdentity(keys);
    expect(() => renameIdentity("   ", keys)).toThrow(/blank/i);
  });
});

describe("recovery passphrase (ADR D2a)", () => {
  it("produces 24 words that restore the SAME identity on another device", async () => {
    const { keys: mine } = memoryKeys();
    const me = await ensureIdentity(mine);
    const words = await recoveryPassphrase(mine);
    // 24, not 12: cojson's secret seed is 32 bytes of entropy, and BIP39 spends 3 words per 4 bytes.
    // Worth pinning — a change to 12 would mean the seed had been silently truncated.
    expect(words.split(" ")).toHaveLength(24);

    // A second device: empty key store, nothing but the words.
    const { keys: other } = memoryKeys();
    const there = await signInWithPassphrase(words, other);

    expect(there.id).toBe(me.id);
  });

  it("gives the linked device the same account secret, not just the same id", async () => {
    // An id that matched while the secret did not would look right and be unable to sign anything.
    const { keys: mine } = memoryKeys();
    await ensureIdentity(mine);
    const words = await recoveryPassphrase(mine);

    const { keys: other } = memoryKeys();
    await signInWithPassphrase(words, other);

    expect((await identityAccount(other)).secret).toBe((await identityAccount(mine)).secret);
  });

  it("is stable across calls", async () => {
    const { keys } = memoryKeys();
    await ensureIdentity(keys);
    expect(await recoveryPassphrase(keys)).toBe(await recoveryPassphrase(keys));
  });

  it("rejects mistyped words with something a person can act on", async () => {
    const { keys } = memoryKeys();
    await expect(signInWithPassphrase("not actually a valid bip39 phrase at all", keys)).rejects.toThrow(
      /typos/i,
    );
  });

  it("tolerates the way people actually type them", async () => {
    // Copied out of a text field: stray case, padding, and doubled spaces.
    const { keys: mine } = memoryKeys();
    const me = await ensureIdentity(mine);
    const words = await recoveryPassphrase(mine);

    const { keys: other } = memoryKeys();
    const there = await signInWithPassphrase(`  ${words.replace(/ /g, "  ").toUpperCase()}  `, other);
    expect(there.id).toBe(me.id);
  });

  it("refuses to link an identity that has no seed", async () => {
    // Accounts created before seeds were kept. Nothing can rescue them — you cannot invent the seed
    // of an existing key — so this says so plainly instead of producing wrong words.
    const { keys, map } = memoryKeys();
    await ensureIdentity(keys);
    map.delete("potyro:identity:seed");
    await expect(recoveryPassphrase(keys)).rejects.toThrow(/cannot be linked/i);
  });
});

describe("the account handed to the store", () => {
  it("mints on demand and matches the identity", async () => {
    const { keys } = memoryKeys();
    const account = await identityAccount(keys); // no prior ensureIdentity
    expect(account.id).toBe(peekIdentity(keys)!.id);
    expect(account.secret).toBeTruthy();
  });
});
