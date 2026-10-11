import { describe, expect, it } from "vitest";
import { migrateStorageKeys } from "../src/rename-migration.js";

function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

describe("storage keys move from the codename prefix to the product's", () => {
  it("moves every karta: key to potyro: with its value, and drops the old key", () => {
    const s = fakeStorage({
      "karta:identity:id": "dev-1",
      "karta:user-apps": "[]",
      "karta:jazz:db:user:split": "karta-jazz",
      "unrelated": "stays",
    });

    const moved = migrateStorageKeys(s);

    expect(moved).toBe(3);
    expect(s.getItem("potyro:identity:id")).toBe("dev-1");
    expect(s.getItem("potyro:user-apps")).toBe("[]");
    // The database file keeps its old name; the moved key still points at it.
    expect(s.getItem("potyro:jazz:db:user:split")).toBe("karta-jazz");
    expect(s.getItem("karta:identity:id")).toBeNull();
    expect(s.getItem("unrelated")).toBe("stays");
  });

  it("keeps a value this build already wrote under the new prefix", () => {
    const s = fakeStorage({ "karta:look": "old", "potyro:look": "new" });

    migrateStorageKeys(s);

    expect(s.getItem("potyro:look")).toBe("new");
    expect(s.getItem("karta:look")).toBeNull();
  });

  it("is a no-op the second time and without storage", () => {
    const s = fakeStorage({ "potyro:identity:id": "dev-1" });
    expect(migrateStorageKeys(s)).toBe(0);
    expect(migrateStorageKeys(undefined)).toBe(0);
  });
});
