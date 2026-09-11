// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_IDS, seedExamples } from "../src/examples.js";
import { getUserApp, listUserApps, removeUserApp } from "../src/user-apps.js";
import { ensureIdentities, listInstalledApps } from "../src/launcher-store.js";

// The examples are ordinary apps (#152): seeded once into the same registry as everything else.

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const NOW = "2026-09-11T12:00:00.000Z";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("seedExamples", () => {
  it("knows the four examples", () => {
    expect(EXAMPLE_IDS).toEqual(["places", "plants", "recipes", "workout"]);
  });

  it("seeds each example as a trusted app with its declared name and full source, once", async () => {
    expect(await seedExamples({ trusted: true, now: NOW })).toEqual(["places", "plants", "recipes", "workout"]);
    const workout = getUserApp("workout")!;
    expect(workout).toMatchObject({ id: "workout", name: "PPL Log", trusted: true, updatedAt: NOW });
    expect(workout.source).toContain('defineApp({');
    expect(workout.source).toContain("function LogSession"); // one file: the view travels with it
    expect(getUserApp("recipes")?.name).toBe("Recipes");
    // Again: nothing to do.
    expect(await seedExamples({ trusted: true, now: "2026-09-12T00:00:00.000Z" })).toEqual([]);
    expect(getUserApp("workout")?.updatedAt).toBe(NOW);
  });

  it("leaves a deleted example deleted", async () => {
    await seedExamples({ trusted: true, now: NOW });
    await removeUserApp("plants");
    expect(await seedExamples({ trusted: true, now: NOW })).toEqual([]);
    expect(getUserApp("plants")).toBeUndefined();
    expect(listUserApps().map((a) => a.id).sort()).toEqual(["places", "recipes", "workout"]);
  });

  it("seeds untrusted for the sandbox, which is how the isolate gets exercised", async () => {
    await seedExamples({ trusted: false, now: NOW });
    expect(listUserApps().every((a) => a.trusted === false)).toBe(true);
  });

  it("gives the launcher the examples' identity like any other app's", async () => {
    await seedExamples({ trusted: true, now: NOW });
    await ensureIdentities(listInstalledApps());
    expect(listInstalledApps().find((a) => a.id === "workout")).toMatchObject({ name: "PPL Log", icon: "🏋", accent: "#5B8DEF" });
    expect(listInstalledApps().find((a) => a.id === "recipes")).toMatchObject({ name: "Recipes", icon: "🍳" });
  });
});
