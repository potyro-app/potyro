import { describe, expect, it } from "vitest";
import { LocalStore, type StorageLike } from "../src/index.js";

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
});
