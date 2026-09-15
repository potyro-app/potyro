// The keystore vault over the secure-storage plugin (#57), driven with a fake plugin: the device half
// is Android's; what is ours is reading "no such key" as nothing stored, and a missing plugin as "use
// plain storage" rather than a broken identity.

import { describe, expect, it } from "vitest";
import { vaultOver } from "../src/secure-vault.js";

function fakePlugin() {
  const map = new Map<string, string>();
  return {
    map,
    get: async ({ key }: { key: string }) => {
      if (!map.has(key)) throw new Error("Item with given key does not exist");
      return { value: map.get(key)! };
    },
    set: async ({ key, value }: { key: string; value: string }) => (map.set(key, value), { value: true }),
    remove: async ({ key }: { key: string }) => ({ value: map.delete(key) }),
    keys: async () => ({ value: [...map.keys()] }),
  };
}

describe("the keystore vault", () => {
  it("stores, reads back, and removes", async () => {
    const plugin = fakePlugin();
    const vault = vaultOver(plugin);
    expect(await vault.available()).toBe(true);
    expect(await vault.get("karta:identity:secret")).toBeNull();
    await vault.set("karta:identity:secret", "sealerSecret_x/signerSecret_y");
    expect(await vault.get("karta:identity:secret")).toBe("sealerSecret_x/signerSecret_y");
    await vault.remove("karta:identity:secret");
    expect(plugin.map.size).toBe(0);
  });

  it("reports itself unavailable when the plugin is not in this build", async () => {
    const vault = vaultOver({
      get: async () => { throw new Error("not implemented"); },
      set: async () => { throw new Error("not implemented"); },
      remove: async () => { throw new Error("not implemented"); },
      keys: async () => { throw new Error("SecureStoragePlugin is not implemented on android"); },
    });
    expect(await vault.available()).toBe(false);
  });
});
