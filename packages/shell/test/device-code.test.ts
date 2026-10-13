// @vitest-environment happy-dom
//
// Where this device keeps an app's code (#281): in the app's LOCAL store, whether or not its data
// syncs — so a library's bytes never ride the shared space, and an app shared by link or from the
// account keeps what it fetched on this device and opens offline from then on.
import { beforeEach, describe, expect, it } from "vitest";
import { fileSpace, lockEntryFor, MemoryStore, moduleFileFor, type AppLock, type Store } from "@potyro/store";
import { codeToCarry, deviceModules, keepCode, receiveCode } from "../src/app-modules.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const LIB = "https://esm.sh/fancy-sum@1.2.3?bundle";
const PLAN = "export const weeks = 12;\n";

let locals: Map<string, MemoryStore>;
const openLocal = async (id: string): Promise<Store> => {
  if (!locals.has(id)) {
    const s = new MemoryStore();
    await s.open(`user:${id}`);
    locals.set(id, s);
  }
  return new Proxy(locals.get(id)!, { get: (t, k) => (k === "close" ? async () => {} : Reflect.get(t, k)) });
};

async function memory(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("shared");
  return s;
}

async function fixture(): Promise<{ lock: AppLock; libFile: string; libBytes: Uint8Array }> {
  const libBytes = enc("export const sum = (a, b) => a + b;");
  const libFile = await moduleFileFor(libBytes);
  return { lock: { [LIB]: await lockEntryFor(libFile, libBytes), "src/plan.ts": await lockEntryFor(".src/plan.ts", enc(PLAN)) }, libFile, libBytes };
}

beforeEach(() => {
  locals = new Map();
});

describe("keeping an app's code on this device", () => {
  it("writes it to the app's local store, as code that came with the app", async () => {
    const { libFile, libBytes } = await fixture();
    await keepCode("summer", [{ path: libFile, data: libBytes }], openLocal);
    const [entry] = await fileSpace(locals.get("summer")!).list();
    expect(entry).toMatchObject({ path: libFile, origin: "shipped" });
  });
});

describe("receiving the modules that came with an app", () => {
  it("keeps each one in .src/ once it matches the lock", async () => {
    const { lock } = await fixture();
    await receiveCode("summer", { lock, modules: { "src/plan.ts": PLAN } }, openLocal);
    const blob = await fileSpace(locals.get("summer")!).read(".src/plan.ts");
    expect(await blob?.text()).toBe(PLAN);
  });

  it("refuses one that does not, by name, and keeps nothing", async () => {
    const { lock } = await fixture();
    await expect(receiveCode("summer", { lock, modules: { "src/plan.ts": "export const weeks = 99;\n" } }, openLocal)).rejects.toThrow(
      "Its file plan.ts is not the copy this app was saved with",
    );
    expect(locals.has("summer")).toBe(false);
  });

  it("does nothing for an app with no modules of its own", async () => {
    await receiveCode("summer", {}, openLocal);
    expect(locals.has("summer")).toBe(false);
  });
});

describe("reading an app's code to open it", () => {
  it("a synced app reads this device's copy first, then its space (code that arrived there before #281)", async () => {
    const { lock, libFile, libBytes } = await fixture();
    await keepCode("summer", [{ path: libFile, data: libBytes }], openLocal);
    const shared = await memory();
    await fileSpace(shared).write(".src/plan.ts", new Blob([PLAN]), { origin: "shipped" });

    const modules = (await deviceModules({ id: "summer", lock }, shared, true, openLocal))!;
    expect(dec(await modules.read(libFile))).toContain("a + b");
    expect(dec(await modules.read(".src/plan.ts"))).toBe(PLAN);
    expect(await modules.read(".modules/elsewhere.js")).toBeNull();
    // Reading never copies anything into the space.
    expect((await fileSpace(shared).list()).map((f) => f.path)).toEqual([".src/plan.ts"]);
  });

  it("an app that does not sync reads its own store, which is its local one", async () => {
    const { lock, libFile, libBytes } = await fixture();
    const own = await memory();
    await fileSpace(own).write(libFile, new Blob([libBytes as BlobPart]), { origin: "shipped" });
    const modules = (await deviceModules({ id: "summer", lock }, own, false, openLocal))!;
    expect(dec(await modules.read(libFile))).toContain("a + b");
    expect(locals.has("summer")).toBe(false);
  });

  it("an app that is one file has no modules", async () => {
    expect(await deviceModules({ id: "notes", lock: undefined }, await memory(), true, openLocal)).toBeUndefined();
  });
});

describe("the code to carry with the source", () => {
  it("is the lock and the app's own modules, from wherever they are on this device", async () => {
    const { lock } = await fixture();
    const shared = await memory();
    await fileSpace(shared).write(".src/plan.ts", new Blob([PLAN]), { origin: "shipped" });
    expect(await codeToCarry({ id: "summer", lock }, shared, openLocal)).toEqual({ lock, modules: { "src/plan.ts": PLAN } });
  });

  it("is nothing for an app that is one file", async () => {
    expect(await codeToCarry({ id: "notes", lock: undefined }, undefined, openLocal)).toEqual({});
  });
});
