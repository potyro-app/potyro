// Carrying an identity to another Potyro site of the same person's (docs/16 §Moving). The new site
// must end up as the same account — same id, same recovery words — and must refuse a carried
// identity whose parts do not agree, and never replace an identity of its own that is in use.

import { describe, expect, it } from "vitest";
import {
  adoptPortableIdentity,
  ensureIdentity,
  memoryVault,
  peekIdentity,
  portableIdentity,
  recoveryPassphrase,
  renameIdentity,
  type IdentityKeys,
} from "../src/index.js";

function memoryKeys(withVault = false): IdentityKeys & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    ...(withVault ? { secrets: memoryVault() } : {}),
  };
}

describe("moving an identity between sites", () => {
  it("has nothing to move before an identity exists", async () => {
    expect(await portableIdentity(memoryKeys())).toBeNull();
  });

  it("arrives as the same person, with the same recovery words", async () => {
    const old = memoryKeys(true);
    const me = await ensureIdentity(old);
    renameIdentity("Ana", old);
    const words = await recoveryPassphrase(old);

    const fresh = memoryKeys(true);
    const moved = (await portableIdentity(old))!;
    expect(await adoptPortableIdentity(moved, { replaceOwn: true }, fresh)).toBe("adopted");
    expect(peekIdentity(fresh)).toEqual({ id: me.id, name: "Ana" });
    expect(await recoveryPassphrase(fresh)).toBe(words);
    expect(fresh.map.get("potyro:identity:origin")).toBe("moved");
    // Secrets went into the vault, not plain storage.
    expect(fresh.map.get("potyro:identity:secret")).toBeUndefined();
  });

  it("is a no-op when this site already is that person, and keeps the old site untouched", async () => {
    const old = memoryKeys();
    await ensureIdentity(old);
    const before = new Map(old.map);
    const moved = (await portableIdentity(old))!;
    const target = memoryKeys();
    await adoptPortableIdentity(moved, { replaceOwn: true }, target);
    expect(await adoptPortableIdentity(moved, { replaceOwn: false }, target)).toBe("same");
    expect(old.map).toEqual(before);
  });

  it("keeps an identity of this site's own that is in use", async () => {
    const old = memoryKeys();
    await ensureIdentity(old);
    const target = memoryKeys();
    const own = await ensureIdentity(target);
    expect(await adoptPortableIdentity((await portableIdentity(old))!, { replaceOwn: false }, target)).toBe("kept-own");
    expect(peekIdentity(target)?.id).toBe(own.id);
  });

  it("replaces an unused identity of this site's own, words and all", async () => {
    const old = memoryKeys();
    const me = await ensureIdentity(old);
    const target = memoryKeys(true);
    await ensureIdentity(target);
    expect(await adoptPortableIdentity((await portableIdentity(old))!, { replaceOwn: true }, target)).toBe("adopted");
    expect(peekIdentity(target)?.id).toBe(me.id);
    expect(await recoveryPassphrase(target)).toBe(await recoveryPassphrase(old));
  });

  it("refuses an identity whose parts do not agree", async () => {
    const a = memoryKeys();
    const b = memoryKeys();
    await ensureIdentity(a);
    await ensureIdentity(b);
    const pa = (await portableIdentity(a))!;
    const pb = (await portableIdentity(b))!;
    const target = memoryKeys();
    // Someone else's id with my secret, and my seed with someone else's secret.
    await expect(adoptPortableIdentity({ ...pa, id: pb.id }, { replaceOwn: true }, target)).rejects.toThrow(/hang together/);
    await expect(adoptPortableIdentity({ ...pa, secret: pb.secret }, { replaceOwn: true }, target)).rejects.toThrow(/hang together/);
    await expect(adoptPortableIdentity({ ...pa, seed: "zz" }, { replaceOwn: true }, target)).rejects.toThrow(/damaged/);
    expect(peekIdentity(target)).toBeNull();
  });
});
