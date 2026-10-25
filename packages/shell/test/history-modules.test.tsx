// @vitest-environment happy-dom
//
// History of an app made of several modules (#448). The device keeps only the CURRENT modules, in
// `.src/`, so a version keeps its own: the diff shows a change to a module, and restoring a version
// puts back the modules it ran with — not its old entry file over today's modules, which could not open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fileSpace, MemoryStore, type Store } from "@potyro/store";

// One store per namespace for the whole test, as a device has: closing a handle keeps what it wrote.
const stores = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    if (!stores.has(namespace)) {
      const s = new MemoryStore();
      await s.open(namespace);
      stores.set(namespace, s);
    }
    return new Proxy(stores.get(namespace) as object, { get: (t, k) => (k === "close" ? async () => {} : Reflect.get(t, k)) });
  },
}));
vi.mock("../src/highlight.js", () => ({ highlightLines: async () => [] }));

const { resetHistoryStore, listVersions } = await import("../src/app-history.js");
const { saveUserApp, getUserApp } = await import("../src/user-apps.js");
const { keepCode, ownModuleCode, withOwnModules, forgetModules } = await import("../src/app-modules.js");
const { History } = await import("../src/history.js");

const OLD_CARD = "export const size = 12;\n";
const NEW_CARD = "export const cardSize = 16;\n";
const SOURCE_V1 = 'import { size } from "./card.ts";\nexport default size;\n';
const SOURCE_V2 = 'import { cardSize } from "./card.ts";\nexport default cardSize;\n';

/** What an update does: the new modules on this device, then the app saved with their lock. */
async function saveWithModules(id: string | undefined, source: string, modules: Record<string, string>, now: string, note?: string) {
  const code = await ownModuleCode(modules);
  const appId = id ?? "cards";
  await keepCode(appId, code.files);
  return saveUserApp({ id: appId, name: "Cards", source, lock: withOwnModules(getUserApp(appId)?.lock, code.lock), ...(note ? { note } : {}) }, now);
}

async function deviceText(appId: string, path: string): Promise<string | null> {
  const store = stores.get(`user:${appId}`) as Store;
  const space = fileSpace(store);
  const entry = await space.find(path);
  const blob = entry ? await space.read({ id: entry.id }) : null;
  return blob ? await blob.text() : null;
}

beforeEach(() => {
  localStorage.clear();
  stores.clear();
  resetHistoryStore();
  forgetModules("cards");
});
afterEach(cleanup);

describe("History of an app with modules of its own", () => {
  it("each version keeps the modules it ran with, read from this device", async () => {
    await saveWithModules(undefined, SOURCE_V1, { "card.ts": OLD_CARD }, "2026-10-01T00:00:00Z");
    await saveWithModules("cards", SOURCE_V2, { "card.ts": NEW_CARD }, "2026-10-02T00:00:00Z");

    const [v2, v1] = await listVersions("cards");
    expect(v1!.modules).toEqual({ "card.ts": OLD_CARD });
    expect(v2!.modules).toEqual({ "card.ts": NEW_CARD });
  });

  it("a change to a module alone is a version, and saving nothing new is not", async () => {
    await saveWithModules(undefined, SOURCE_V1, { "card.ts": OLD_CARD }, "2026-10-01T00:00:00Z");
    await saveWithModules("cards", SOURCE_V1, { "card.ts": "export const size = 13;\n" }, "2026-10-02T00:00:00Z");
    await saveUserApp({ id: "cards", name: "Cards", source: SOURCE_V1 }, "2026-10-03T00:00:00Z");

    const versions = await listVersions("cards");
    expect(versions.map((v) => v.modules?.["card.ts"])).toEqual(["export const size = 13;\n", OLD_CARD]);
  });

  it("modules the caller passes are kept when they are not on this device yet (an install)", async () => {
    const code = await ownModuleCode({ "card.ts": OLD_CARD });
    await saveUserApp({ id: "cards", name: "Cards", source: SOURCE_V1, lock: code.lock, modules: { "card.ts": OLD_CARD } }, "2026-10-01T00:00:00Z");
    expect((await listVersions("cards"))[0]!.modules).toEqual({ "card.ts": OLD_CARD });
  });

  it("the diff shows the change to the module, by its name", async () => {
    await saveWithModules(undefined, SOURCE_V1, { "card.ts": OLD_CARD }, "2026-10-01T00:00:00Z");
    await saveWithModules("cards", SOURCE_V2, { "card.ts": NEW_CARD }, "2026-10-02T00:00:00Z", "bigger cards");

    render(<History appId="cards" appName="Cards" onClose={() => {}} embedded />);
    fireEvent.click(await screen.findByText("bigger cards"));
    const detail = screen.getByRole("region", { name: "Changes in version 2" });
    expect(detail.querySelector(".k-history-module")?.textContent).toContain("card.ts");
    const removed = [...detail.querySelectorAll(".k-diff-del")].map((l) => l.textContent).join("\n");
    const added = [...detail.querySelectorAll(".k-diff-add")].map((l) => l.textContent).join("\n");
    expect(removed).toContain("export const size = 12;");
    expect(added).toContain("export const cardSize = 16;");
  });

  it("restoring a version puts back the modules it ran with, on this device and in the lock", async () => {
    await saveWithModules(undefined, SOURCE_V1, { "card.ts": OLD_CARD }, "2026-10-01T00:00:00Z", "first");
    await saveWithModules("cards", SOURCE_V2, { "card.ts": NEW_CARD }, "2026-10-02T00:00:00Z", "renamed size");
    const restored = vi.fn();

    render(<History appId="cards" appName="Cards" onClose={() => {}} onRestored={restored} embedded />);
    fireEvent.click(await screen.findByText("first"));
    fireEvent.click(screen.getByRole("button", { name: "Restore v1" }));
    await waitFor(() => expect(restored).toHaveBeenCalled());

    // The entry imports `size`: only the old card.ts has it. Today's would leave the app unable to open.
    expect(await deviceText("cards", ".src/card.ts")).toBe(OLD_CARD);
    const { lock: oldLock } = await ownModuleCode({ "card.ts": OLD_CARD });
    expect(getUserApp("cards")!.lock).toEqual(oldLock);
    const [newest] = await listVersions("cards");
    expect(newest).toMatchObject({ seq: 3, origin: "restored", source: SOURCE_V1, modules: { "card.ts": OLD_CARD } });
  });
});
