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

  it("rejects a case with a malformed step", async () => {
    // Save a valid case first
    const valid = newCase("city-maps", "valid", "case-valid");
    await saveCase(valid);

    // Try to save a deliberately malformed case by casting it through unknown
    // This simulates data corruption or format drift
    const malformed = {
      id: "case-malformed",
      appId: "city-maps",
      title: "malformed",
      steps: [{ foo: "bar" }], // Invalid: missing 'kind' field
      createdAt: new Date().toISOString(),
    };
    await saveCase(malformed as unknown as typeof valid);

    // When we list cases, the malformed one should be filtered out (after fix)
    // Before fix, it would be accepted and cause problems in replay
    const cases = await listCases("city-maps");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("case-valid");
  });

  it("protects cases by app boundary when deleting", async () => {
    // Create cases with the same ID in different apps
    const cityCase = newCase("city-maps", "city bug", "shared-id-123");
    const recipeCase = newCase("recipes", "recipe bug", "shared-id-123");

    await saveCase(cityCase);
    await saveCase(recipeCase);

    // Delete the city case
    await deleteCase("city-maps", "shared-id-123");

    // The recipe case should still exist
    const cityAfter = await listCases("city-maps");
    const recipeAfter = await listCases("recipes");

    expect(cityAfter).toHaveLength(0);
    expect(recipeAfter).toHaveLength(1);
    expect(recipeAfter[0]!.appId).toBe("recipes");
  });

  it("rejects an open step with params as array", async () => {
    // Save a valid case
    const valid = newCase("test-app", "valid", "case-valid");
    await saveCase(valid);

    // Save a malformed case with params as array
    const malformed = {
      id: "case-array-params",
      appId: "test-app",
      title: "array params",
      steps: [{ kind: "open", page: "home", params: ["a", "b"] }],
      createdAt: new Date().toISOString(),
    };
    await saveCase(malformed as unknown as typeof valid);

    // Only the valid case should be returned
    const cases = await listCases("test-app");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("case-valid");
  });

  it("rejects an open step with non-string param value", async () => {
    // Save a valid case
    const valid = newCase("test-app", "valid", "case-valid");
    await saveCase(valid);

    // Save a malformed case with non-string param value
    const malformed = {
      id: "case-bad-param-value",
      appId: "test-app",
      title: "bad param value",
      steps: [{ kind: "open", page: "home", params: { count: 42 } }],
      createdAt: new Date().toISOString(),
    };
    await saveCase(malformed as unknown as typeof valid);

    // Only the valid case should be returned
    const cases = await listCases("test-app");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("case-valid");
  });

  it("rejects an action step missing recordId", async () => {
    // Save a valid case
    const valid = newCase("test-app", "valid", "case-valid");
    await saveCase(valid);

    // Save a malformed case with missing recordId
    const malformed = {
      id: "case-no-record-id",
      appId: "test-app",
      title: "missing recordId",
      steps: [{ kind: "action", entity: "task", action: "complete" }],
      createdAt: new Date().toISOString(),
    };
    await saveCase(malformed as unknown as typeof valid);

    // Only the valid case should be returned
    const cases = await listCases("test-app");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("case-valid");
  });

  it("rejects an expect step with non-string note", async () => {
    // Save a valid case
    const valid = newCase("test-app", "valid", "case-valid");
    await saveCase(valid);

    // Save a malformed case with non-string note
    const malformed = {
      id: "case-bad-note",
      appId: "test-app",
      title: "bad note",
      steps: [{ kind: "expect", note: 123 }],
      createdAt: new Date().toISOString(),
    };
    await saveCase(malformed as unknown as typeof valid);

    // Only the valid case should be returned
    const cases = await listCases("test-app");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("case-valid");
  });
});
