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

const { inspectPackage, installPackage, remixNote, remixOf } = await import("../src/add-app.js");
const { getUserApp, saveUserApp } = await import("../src/user-apps.js");
const { creditLine, creditToShare, tileCredit } = await import("../src/credit-words.js");
const { shownNote } = await import("../src/version-notes.js");
const { canRemix } = await import("../src/remix.js");

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

describe("the tile's details", () => {
  it("a remix says what it remixed; a kept app says who made it; your own says nothing", () => {
    expect(tileCredit({ remixOf: ANA })).toBe("Remix of Groceries by Ana");
    expect(tileCredit({ credit: ANA })).toBe("By Ana");
    expect(tileCredit({ credit: { name: "Shop", by: "Jo", remixOf: ANA } })).toBe("By Jo · Remix of Groceries by Ana");
    expect(tileCredit({})).toBeNull();
  });

  it("Make it mine is offered on someone else's sealed app, not on yours or on a remix you already made", () => {
    expect(canRemix({ trusted: false })).toBe(true);
    expect(canRemix({ trusted: true })).toBe(false);
    expect(canRemix({})).toBe(false);
    expect(canRemix({ trusted: false, remixOf: ANA })).toBe(false);
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

  it("a remix never takes the original's id, even when the original is not here", async () => {
    // An example's first-run records and conversation are keyed on its id: a remix must not inherit them.
    const done = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: true, mode: "copy", remix: true, openStore: openFor });
    expect(done.app.id).toBe("groceries-remix");
    expect(done.app.name).toBe("Groceries");
    expect(done.app.trusted).toBe(false);
  });

  it("a remix of an app that said nobody made it credits just its name", async () => {
    const unnamed = readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], seed: undefined, chat: undefined }));
    const done = await installPackage(unnamed, await inspectPackage(unnamed), { source: "link", mine: false, mode: "copy", remix: true, openStore: openFor });
    expect(getUserApp(done.app.id)!.remixOf).toEqual({ name: "Groceries" });
    expect(tileCredit(getUserApp(done.app.id)!)).toBe("Remix of Groceries");
  });

  it("a remix beside an app of the same name is called a remix, so the two tiles differ", async () => {
    await saveUserApp({ id: "groceries", name: "Groceries", source: SOURCE, trusted: false }, "2026-10-15T00:00:00.000Z");
    const done = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: false, mode: "copy", remix: true, openStore: openFor });
    expect(done.app.name).toBe("Groceries (remix)");
  });

  it("starts with the package's sample records, or empty when the person says so", async () => {
    const kept = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: false, mode: "copy", remix: true, openStore: openFor });
    expect(kept.seeded).toBe(1);
    expect(await stores.get(kept.app.id)!.all("item")).toHaveLength(1);
    const empty = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: false, mode: "copy", remix: true, seed: false, openStore: openFor });
    expect(empty.app.id).not.toBe(kept.app.id);
    expect(empty.seeded).toBe(0);
    expect(await stores.get(empty.app.id)!.all("item")).toHaveLength(0);
  });

  it("History keeps the credit on the remix's first version, in the reader's language", () => {
    expect(remixNote(ANA)).toBe("remix of “Groceries” by Ana");
    expect(remixNote({ name: "Groceries" })).toBe("remix of “Groceries”");
    expect(shownNote(remixNote(ANA))).toBe("remix of “Groceries” by Ana");
    expect(shownNote(remixNote({ name: "Groceries" }))).toBe("remix of “Groceries”");
    expect(remixOf(undefined, "Plants")).toEqual({ name: "Plants" });
    expect(remixOf(ANA, "Plants")).toBe(ANA);
  });

  it("an edit keeps the credit: whose app it was does not change when it is changed", async () => {
    const done = await installPackage(pkg(), await inspectPackage(pkg()), { source: "link", mine: false, mode: "replace", openStore: openFor });
    await saveUserApp({ id: done.app.id, name: "Groceries", source: `${SOURCE}\n// edited` }, "2026-10-15T01:00:00.000Z");
    expect(getUserApp(done.app.id)!.credit).toEqual(ANA);
  });
});
