import { describe, expect, it } from "vitest";
import { LocalStore, QuotaError, type StorageLike } from "../src/index.js";

function fakeBackend(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("LocalStore persistence", () => {
  it("survives a reopen (simulated reload) with a shared backend", async () => {
    const backend = fakeBackend();

    const s1 = new LocalStore(backend);
    await s1.open("recipes");
    const r = await s1.insert("recipe", { name: "Soup", when: new Date("2026-07-22T00:00:00Z") });
    await s1.kvSet("pantry", JSON.stringify(["egg"]));
    const blob = await s1.putBlob(new Blob(["img"], { type: "image/png" }));

    // "reload": brand-new instance over the same backend
    const s2 = new LocalStore(backend);
    await s2.open("recipes");
    const rows = await s2.all("recipe");
    expect(rows.map((x) => x.name)).toEqual(["Soup"]);
    expect(rows[0].id).toBe(r.id);
    expect(await s2.kvGet("pantry")).toBe(JSON.stringify(["egg"]));
    const back = await s2.getBlob(blob);
    expect(await back!.text()).toBe("img");
  });

  it("namespaces by appId", async () => {
    const backend = fakeBackend();
    const a = new LocalStore(backend);
    await a.open("appA");
    await a.insert("x", { v: 1 });
    const b = new LocalStore(backend);
    await b.open("appB");
    expect(await b.all("x")).toEqual([]);
  });

  // A full store used to break the app permanently: the write threw the browser's own "The quota
  // has been exceeded", memory kept the photo storage had refused, and every later save then failed
  // on the same overflowing bytes — nothing could be saved again until a reload.
  it("a write that does not fit is refused with a message, and leaves the store usable", async () => {
    const backend = fakeBackend();
    let full = false;
    const capped: StorageLike = {
      getItem: backend.getItem,
      removeItem: backend.removeItem,
      setItem: (k, v) => {
        if (full && v.length > 1200) {
          const e = new Error("The quota has been exceeded.");
          e.name = "QuotaExceededError";
          throw e;
        }
        backend.setItem(k, v);
      },
    };

    const store = new LocalStore(capped);
    await store.open("places");
    const place = await store.insert("place", { name: "Nachtbar" });
    full = true;

    await expect(store.putBlob(new Blob(["x".repeat(4000)], { type: "image/jpeg" }))).rejects.toBeInstanceOf(QuotaError);

    // The photo is not in the store, and the store still works: the record that was there is intact
    // and a small write still goes through.
    expect(await store.all("place")).toHaveLength(1);
    await store.update("place", place.id, { name: "Nachtbar 2" });
    const rows = await store.all("place");
    expect(rows[0]!.name).toBe("Nachtbar 2");
  });
});
