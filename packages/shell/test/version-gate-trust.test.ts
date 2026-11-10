// @vitest-environment happy-dom
//
// Taking a version published into a shared space, and whose code it then is (CLAUDE.md rule 3).
//
// Everyone who can write to a space can publish a version of its app. The person who made the app
// runs their copy directly; saying "Update" to a version someone ELSE published must not hand that
// code the same standing. Only a version this person's own account published keeps it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, type Store } from "@potyro/store";
import { publishAppSource, type PublishedApp } from "../src/app-sync.js";
import { getUserApp, saveUserApp } from "../src/user-apps.js";
import { takeUpdate } from "../src/version-gate.js";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {}, listVersions: async () => [] }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));
vi.mock("../src/app-modules.js", () => ({ receiveCode: async () => {}, ownModuleTexts: async () => undefined }));

const NOW = "2026-11-10T12:00:00.000Z";
const LATER = "2026-11-10T13:00:00.000Z";
const MINE = "// the version I wrote\n";
const THEIRS: PublishedApp = { source: "// a version published into the space\n", name: "Split", updatedAt: LATER };

/** A space holding `published`, whose store answers `own` when asked who wrote it. */
async function space(published: PublishedApp, own: boolean | undefined): Promise<Store> {
  const store = new MemoryStore();
  await store.open("split");
  await publishAppSource(store, published);
  return own === undefined ? store : Object.assign(store, { kvOwn: async () => own });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("location", { reload: vi.fn() });
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("taking a published version of a shared app", () => {
  it("a version someone else published stops running as this person's own", async () => {
    await saveUserApp({ id: "split", name: "Split", source: MINE, trusted: true }, NOW);

    await takeUpdate("split", THEIRS, await space(THEIRS, false));

    expect(getUserApp("split")).toMatchObject({ source: THEIRS.source, trusted: false });
  });

  it("a version this person's other device published keeps running as their own", async () => {
    await saveUserApp({ id: "split", name: "Split", source: MINE, trusted: true }, NOW);

    await takeUpdate("split", THEIRS, await space(THEIRS, true));

    expect(getUserApp("split")).toMatchObject({ source: THEIRS.source, trusted: true });
  });

  it("a store that cannot say who published it is not taken as proof", async () => {
    await saveUserApp({ id: "split", name: "Split", source: MINE, trusted: true }, NOW);

    await takeUpdate("split", THEIRS, await space(THEIRS, undefined));

    expect(getUserApp("split")?.trusted).toBe(false);
  });

  it("the answer for one version is not lent to another written after it", async () => {
    await saveUserApp({ id: "split", name: "Split", source: MINE, trusted: true }, NOW);
    // The store says "yours" — but what the space holds now is no longer the version being taken.
    const swapped: PublishedApp = { ...THEIRS, source: "// swapped in afterwards\n", updatedAt: "2026-11-10T14:00:00.000Z" };

    await takeUpdate("split", THEIRS, await space(swapped, true));

    expect(getUserApp("split")?.trusted).toBe(false);
  });

  it("a copy that already ran as someone else's stays that way, whoever published", async () => {
    await saveUserApp({ id: "split", name: "Split", source: MINE, trusted: false }, NOW);

    await takeUpdate("split", THEIRS, await space(THEIRS, true));

    expect(getUserApp("split")?.trusted).toBe(false);
  });
});
