// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_IDS, seedExamples } from "../src/examples.js";
import { getUserApp, listUserApps, removeUserApp, saveUserApp } from "../src/user-apps.js";
import { ensureIdentities, listInstalledApps } from "../src/launcher-store.js";

// The examples are ordinary apps (#152): seeded once into the same registry as everything else.

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const NOW = "2026-09-11T12:00:00.000Z";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("seedExamples", () => {
  it("knows the six examples", () => {
    expect(EXAMPLE_IDS).toEqual(["groceries", "places", "plants", "recipes", "split", "workout"]);
  });

  it("seeds each example as a trusted app with its declared name and full source, once", async () => {
    expect(await seedExamples({ trusted: true, now: NOW })).toEqual(["groceries", "places", "plants", "recipes", "split", "workout"]);
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
    expect(listUserApps().map((a) => a.id).sort()).toEqual(["groceries", "places", "recipes", "split", "workout"]);
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

// An example seeded once used to be an example frozen forever: every later improvement — how
// Groceries groups its aisles, how Split divides a bill — reached only people who had never opened
// it. A copy still exactly as we seeded it now follows the build; a copy you have touched does not.
describe("keeping the examples up to date", () => {
  const SEEDED_KEY = "karta:examples:seeded";
  const older = (source: string): string => source.replace(/^(\s*version:\s*)"[^"]+"/m, '$1"0.0.1"');

  /** Put this device back to where it was when it was seeded with `source`. */
  const pretendSeeded = async (id: string, source: string, now = NOW): Promise<void> => {
    const app = getUserApp(id)!;
    await saveUserApp({ ...app, source }, now);
    const state = JSON.parse(localStorage.getItem(SEEDED_KEY)!) as Record<string, { hash?: string; version?: string }>;
    // The fingerprint the shell would have recorded for that source (FNV-1a, as in examples.ts).
    let h = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
      h ^= source.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    state[id] = { hash: (h >>> 0).toString(36), version: "0.0.1" };
    localStorage.setItem(SEEDED_KEY, JSON.stringify(state));
  };

  it("replaces a copy that is still ours with the newer one the build carries", async () => {
    await seedExamples({ trusted: true, now: NOW });
    const shipped = getUserApp("split")!.source;
    await pretendSeeded("split", older(shipped));
    expect(getUserApp("split")!.source).not.toBe(shipped);

    // Not reported as added: it was already on the home screen, and it still is.
    expect(await seedExamples({ trusted: true, now: "2026-09-18T00:00:00.000Z" })).toEqual([]);
    expect(getUserApp("split")!.source).toBe(shipped);
  });

  it("never overwrites a copy you have edited", async () => {
    await seedExamples({ trusted: true, now: NOW });
    const shipped = getUserApp("split")!.source;
    // Seeded as an older version, then edited: the bytes no longer match what we wrote, so this is
    // someone's work and the newer build is not entitled to it.
    await pretendSeeded("split", older(shipped));
    const mine = `${older(shipped)}\n// my own note\n`;
    await saveUserApp({ ...getUserApp("split")!, source: mine }, NOW);

    await seedExamples({ trusted: true, now: "2026-09-18T00:00:00.000Z" });
    expect(getUserApp("split")!.source).toBe(mine);
  });

  it("leaves a device seeded before fingerprints alone, and records one for next time", async () => {
    await seedExamples({ trusted: true, now: NOW });
    const mine = `${getUserApp("split")!.source}\n// edited before this build existed\n`;
    await saveUserApp({ ...getUserApp("split")!, source: mine }, NOW);
    // The old shape of the record: ids only, no fingerprints.
    localStorage.setItem(SEEDED_KEY, JSON.stringify(EXAMPLE_IDS));

    await seedExamples({ trusted: true, now: "2026-09-18T00:00:00.000Z" });
    // Untouched, because this build cannot tell an edit from a stale copy...
    expect(getUserApp("split")!.source).toBe(mine);
    const state = JSON.parse(localStorage.getItem(SEEDED_KEY)!) as Record<string, { hash?: string }>;
    // ...and from now on it can.
    expect(state.split?.hash).toEqual(expect.any(String));
  });
});
