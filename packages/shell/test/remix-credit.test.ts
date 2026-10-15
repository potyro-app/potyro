// @vitest-environment happy-dom
//
// Credit and remix (docs/24 §6): who made an app travels with it; a kept app is passed on as its
// maker's; a remix is the person's own, sealed like any app from a link, and says what it remixed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, packAppPackage, readAppPackage, type Store } from "@potyro/store";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-store.js", () => ({ openAppStore: async () => new MemoryStore(), syncAllowedFor: async () => false }));
vi.mock("../src/open-store.js", async () => {
  const { MemoryStore: Memory } = await import("@potyro/store");
  const s = new Memory();
  await s.open("x");
  return { openStore: async () => s };
});
vi.mock("../src/app-trial.js", () => ({
  trySealed: async () => ({ definition: { id: "groceries", name: "Groceries", entities: { item: { label: "Item" } } }, issues: [], missing: [] }),
}));

const { inspectPackage, installPackage } = await import("../src/add-app.js");
const { getUserApp, saveUserApp } = await import("../src/user-apps.js");
const { creditLine, creditToShare } = await import("../src/credit-words.js");

const SOURCE = 'import { defineApp } from "potyro"; export default defineApp({ id: "groceries" } as never);';
const ANA = { name: "Groceries", by: "Ana" };
const pkg = () => readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], seed: { item: [{ id: "1", name: "Apples" }] }, chat: undefined, credit: ANA }));
const stores = new Map<string, Store>();
const openFor = async (app: { id: string }) => {
  if (!stores.has(app.id)) {
    const s = new MemoryStore();
    await s.open(app.id);
    stores.set(app.id, s);
  }
  return stores.get(app.id)!;
};

beforeEach(() => {
  localStorage.clear();
  stores.clear();
});

describe("credit in words", () => {
  it("says who made it, and what it remixed", () => {
    expect(creditLine({ name: "Groceries", by: "Ana" })).toBe("By Ana");
    expect(creditLine({ name: "Shop", by: "Jo", remixOf: ANA })).toBe("By Jo · Remix of Groceries by Ana");
    expect(creditLine({ name: "Shop", remixOf: { name: "Groceries" } })).toBe("Remix of Groceries");
    expect(creditLine({ name: "Shop" })).toBeNull();
    expect(creditLine(undefined)).toBeNull();
  });

  it("a kept app is passed on as its maker's; a remix as the person's, with its chain; their own as theirs", () => {
    expect(creditToShare({ name: "Groceries", credit: ANA }, "Jo")).toEqual(ANA);
    expect(creditToShare({ name: "Shop", remixOf: ANA }, "Jo")).toEqual({ name: "Shop", by: "Jo", remixOf: ANA });
    expect(creditToShare({ name: "Shop", remixOf: ANA }, undefined)).toEqual({ name: "Shop", remixOf: ANA });
    expect(creditToShare({ name: "Mine" }, "Jo")).toEqual({ name: "Mine", by: "Jo" });
  });
});

describe("keeping and remixing", () => {
  it("the card says who made it; keeping keeps the credit, sealed", async () => {
    const inspected = await inspectPackage(pkg());
    expect(inspected.credit).toEqual(ANA);
    const done = await installPackage(pkg(), inspected, { source: "link", mine: true, mode: "replace", openStore: openFor });
    expect(done.app.trusted).toBe(false);
    expect(getUserApp(done.app.id)).toMatchObject({ credit: ANA });
    expect(getUserApp(done.app.id)!.remixOf).toBeUndefined();
  });

  it("a remix is a new app beside yours, sealed, credited as a remix", async () => {
    await saveUserApp({ id: "groceries", name: "Groceries", source: SOURCE, trusted: true }, "2026-10-15T00:00:00.000Z");
    const inspected = await inspectPackage(pkg());
    const done = await installPackage(pkg(), inspected, { source: "link", mine: false, mode: "copy", remix: true, openStore: openFor });
    expect(done.app.id).not.toBe("groceries");
    expect(done.app.trusted).toBe(false);
    expect(getUserApp(done.app.id)).toMatchObject({ remixOf: ANA });
    expect(getUserApp(done.app.id)!.credit).toBeUndefined();
    // yours is untouched
    expect(getUserApp("groceries")!.trusted).toBe(true);
  });

  it("an edit keeps the credit: whose app it was does not change when it is changed", async () => {
    const done = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: false, mode: "replace", openStore: openFor });
    await saveUserApp({ id: done.app.id, name: "Groceries", source: `${SOURCE}\n// edited` }, "2026-10-15T01:00:00.000Z");
    expect(getUserApp(done.app.id)!.credit).toEqual(ANA);
  });
});
