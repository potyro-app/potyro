// @vitest-environment happy-dom
//
// A case is what someone did in their app plus what they expected — recorded so a reported bug
// can be replayed instead of retyped. These tests drive the real module — `saveCase` writing to a
// Store — with only the durable-store factory faked (OPFS SQLite doesn't exist in Node;
// MemoryStore implements the same interface).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@potyro/store";
import { newCase, addStep, type Case } from "@potyro/runtime";

// A switch the tests can flip, so the "store is unavailable" path is genuinely exercised rather
// than asserted against a store that happens to be empty (mirrors app-diagnoses.test.ts).
const stores = vi.hoisted(() => ({ unavailable: false }));

// `openStore` is the one thing that can't run headlessly — swap in the in-memory Store the shell
// itself falls back to in browsers without OPFS.
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    if (stores.unavailable) throw new Error("OPFS unavailable");
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const { saveCase, listCases, deleteCase, clearCases, hasRecordedActivity, resetCasesStore } = await import(
  "../src/app-cases.js"
);
const { saveUserApp, removeUserApp } = await import("../src/user-apps.js");

// Applies to every test in this file, not just "app cases" — each `it` gets a fresh MemoryStore
// (the mock above hands out a new one per `openStore` call), so state must not leak across
// `describe` blocks either.
beforeEach(() => resetCasesStore());

describe("app cases", () => {
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

  it("never throws when the store is unavailable — a recording must not be lost to a broken save", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stores.unavailable = true;
    try {
      await expect(saveCase(newCase("city-maps", "x"))).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      stores.unavailable = false;
      resetCasesStore();
      warn.mockRestore();
    }
  });

  it("recovers once the store comes back — a boot-time failure is not permanent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stores.unavailable = true;
    await saveCase(newCase("city-maps", "lost", "case-lost"));
    stores.unavailable = false;
    warn.mockRestore();

    await saveCase(newCase("city-maps", "kept", "case-kept"));
    expect((await listCases("city-maps")).map((c) => c.id)).toEqual(["case-kept"]);
  });

  it("caps an app's cases, dropping the oldest first", async () => {
    // MAX_CASES is 50 (mirrors app-diagnoses.ts's MAX_DIAGNOSES) — save one over the cap and check
    // the single oldest one is the one gone, newest kept.
    const at = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    for (let i = 0; i < 51; i++) {
      await saveCase({ ...newCase("city-maps", `case ${i}`, `case-${i}`), createdAt: at(i) });
    }

    const left = await listCases("city-maps");
    expect(left).toHaveLength(50);
    expect(left.map((c) => c.id)).not.toContain("case-0");
    expect(left.map((c) => c.id)).toContain("case-50");
  });

  it("does not let one app's cases push another app's cases out of its own cap", async () => {
    const at = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    await saveCase({ ...newCase("recipes", "keep me", "recipe-case"), createdAt: at(0) });
    for (let i = 0; i < 51; i++) {
      await saveCase({ ...newCase("city-maps", `case ${i}`, `city-case-${i}`), createdAt: at(i + 1) });
    }

    expect(await listCases("recipes")).toHaveLength(1);
    expect((await listCases("city-maps")).length).toBe(50);
  });
});

describe("clearCases", () => {
  it("removes only the named app's cases", async () => {
    await saveCase(newCase("city-maps", "a", "case-a"));
    await saveCase(newCase("recipes", "b", "case-b"));

    await clearCases("city-maps");

    expect(await listCases("city-maps")).toEqual([]);
    expect(await listCases("recipes")).toHaveLength(1);
  });

  it("never throws when the store is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stores.unavailable = true;
    try {
      await expect(clearCases("city-maps")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      stores.unavailable = false;
      resetCasesStore();
      warn.mockRestore();
    }
  });
});

describe("deleting an app", () => {
  // Ids are name slugs (user-apps.ts's `slug`), so a deleted app's id can be reused by a later,
  // unrelated app — removeUserApp must forget its cases the same way it already forgets history
  // and diagnoses, or the new app inherits the dead app's reported problems.
  it("forgets its cases too", async () => {
    const at = new Date(Date.UTC(2026, 0, 1)).toISOString();
    await saveUserApp({ id: "places", name: "Places", source: "v1" }, at);
    await saveCase(newCase("places", "a bug", "case-a"));

    await removeUserApp("places");

    expect(await listCases("places")).toEqual([]);
  });
});

describe("hasRecordedActivity", () => {
  // Gates whether App.tsx's onStopRecording bothers saving a case at all: replayPassed treats an
  // empty outcomes list as a pass ([].every() is vacuously true), so a case that could only ever
  // produce an empty outcomes list must never be saved as if it were a real recording.
  it("is false for a case with no steps at all", () => {
    expect(hasRecordedActivity(newCase("city-maps", "x"))).toBe(false);
  });

  it("is false for a case with only expect notes — nothing for replay to run", () => {
    const c = addStep(newCase("city-maps", "x"), { kind: "expect", note: "I expected X" });
    expect(hasRecordedActivity(c)).toBe(false);
  });

  it("is true once an open step was recorded", () => {
    const c = addStep(newCase("city-maps", "x"), { kind: "open", page: "all" });
    expect(hasRecordedActivity(c)).toBe(true);
  });

  it("is true once an action step was recorded", () => {
    const c: Case = addStep(newCase("city-maps", "x"), {
      kind: "action",
      entity: "item",
      action: "complete",
      recordId: "r1",
    });
    expect(hasRecordedActivity(c)).toBe(true);
  });
});
