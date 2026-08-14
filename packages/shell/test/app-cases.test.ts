// @vitest-environment happy-dom
//
// A case is what someone did in their app plus what they expected — recorded so a reported bug
// can be replayed instead of retyped. These tests drive the real module — `saveCase` writing to a
// Store — with only the durable-store factory faked (OPFS SQLite doesn't exist in Node;
// MemoryStore implements the same interface).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@karta/store";
import { newCase, addStep } from "@karta/runtime";

// `openStore` is the one thing that can't run headlessly — swap in the in-memory Store the shell
// itself falls back to in browsers without OPFS.
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const { saveCase, listCases, deleteCase, resetCasesStore } = await import("../src/app-cases.js");

describe("app cases", () => {
  beforeEach(() => resetCasesStore());

  it("round-trips a case for one app", async () => {
    const c = addStep(newCase("city-maps", "clicking a city"), { kind: "open", page: "all" });
    await saveCase(c);

    const back = await listCases("city-maps");
    expect(back).toHaveLength(1);
    expect(back[0]!.title).toBe("clicking a city");
    expect(back[0]!.steps).toHaveLength(1);
  });

  it("keeps each app's cases to itself", async () => {
    await saveCase(newCase("city-maps", "a"));
    await saveCase(newCase("recipes", "b"));

    expect(await listCases("city-maps")).toHaveLength(1);
    expect((await listCases("recipes"))[0]!.title).toBe("b");
  });

  it("deletes one case without touching the others", async () => {
    const keep = newCase("city-maps", "keep", "case-keep");
    await saveCase(keep);
    await saveCase(newCase("city-maps", "drop", "case-drop"));

    await deleteCase("city-maps", "case-drop");

    const left = await listCases("city-maps");
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe("case-keep");
  });
});
