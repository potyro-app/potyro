// @vitest-environment happy-dom
//
// Diagnoses are the record of edits that were correctly NOT made. They exist so a host-side cause is
// stated once and then remembered: shown in a panel and dropped, the next edit re-derives the same
// wrong app-level fix. Same fake as app-history.test.ts — only the durable-store factory is swapped.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@karta/store";

// A switch the tests can flip, so the "store is unavailable" path is genuinely exercised rather than
// asserted against a store that happens to be empty.
const stores = vi.hoisted(() => ({ unavailable: false }));

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    if (stores.unavailable) throw new Error("OPFS unavailable");
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const { listDiagnoses, recordDiagnosis, clearDiagnoses, resetDiagnosisStore } = await import("../src/app-diagnoses.js");
const { saveUserApp, removeUserApp } = await import("../src/user-apps.js");
const { listVersions, resetHistoryStore } = await import("../src/app-history.js");

const at = (n: number): string => new Date(Date.UTC(2026, 0, n)).toISOString();

beforeEach(() => {
  globalThis.localStorage.clear();
  resetDiagnosisStore();
  resetHistoryStore();
});

describe("recordDiagnosis", () => {
  it("keeps the complaint alongside the explanation, newest first", async () => {
    await recordDiagnosis("places", { complaint: "no pins on open", text: "the marker sync races the map", target: "the map" }, at(1));
    await recordDiagnosis("places", { complaint: "opens on the world", text: "the camera is host-owned" }, at(2));

    const found = await listDiagnoses("places");
    expect(found.map((d) => [d.complaint, d.text])).toEqual([
      ["opens on the world", "the camera is host-owned"],
      ["no pins on open", "the marker sync races the map"],
    ]);
    expect(found[1]!.target).toBe("the map");
  });

  it("keeps each app's diagnoses to itself", async () => {
    await recordDiagnosis("places", { complaint: "a", text: "for places" }, at(1));
    await recordDiagnosis("plants", { complaint: "b", text: "for plants" }, at(2));

    expect((await listDiagnoses("places")).map((d) => d.text)).toEqual(["for places"]);
    expect((await listDiagnoses("plants")).map((d) => d.text)).toEqual(["for plants"]);
  });

  it("records no version — a diagnosis changed no source", async () => {
    // The point of the escape hatch: nothing was edited, so nothing may appear in the version log.
    // A phantom version there would be a change the user cannot diff, and would feed the next prompt
    // a source edit that never happened.
    await saveUserApp({ id: "places", name: "Places", source: "v1" }, at(1));
    await recordDiagnosis("places", { complaint: "opens on the world", text: "host-owned" }, at(2));

    const versions = await listVersions("places");
    expect(versions.map((v) => v.source)).toEqual(["v1"]);
  });

  it("survives an unavailable store rather than throwing into the edit flow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stores.unavailable = true;
    try {
      // Both must degrade quietly: a diagnosis the user is about to read must not be lost to a
      // storage failure, and the read must not take down the panel.
      await expect(recordDiagnosis("places", { complaint: "a", text: "host-owned" }, at(1))).resolves.toBeUndefined();
      await expect(listDiagnoses("places")).resolves.toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      stores.unavailable = false;
      resetDiagnosisStore();
      warn.mockRestore();
    }
  });

  it("recovers once the store comes back — a boot-time failure is not permanent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stores.unavailable = true;
    await recordDiagnosis("places", { complaint: "a", text: "lost" }, at(1));
    stores.unavailable = false;
    warn.mockRestore();

    await recordDiagnosis("places", { complaint: "b", text: "kept" }, at(2));
    expect((await listDiagnoses("places")).map((d) => d.text)).toEqual(["kept"]);
  });
});

describe("deleting an app", () => {
  it("forgets its diagnoses too", async () => {
    await saveUserApp({ id: "places", name: "Places", source: "v1" }, at(1));
    await recordDiagnosis("places", { complaint: "a", text: "host-owned" }, at(2));

    await removeUserApp("places");

    expect(await listDiagnoses("places")).toEqual([]);
  });
});
