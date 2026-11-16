// @vitest-environment happy-dom
//
// The launcher runs a sealed app's tile code from Home. An app paused after a tab died with it
// showing is not run there either, and while a sealed app's tile code runs the app is marked as when
// it is open — so a tile that takes the tab down does it once (#90, docs/22 §7.1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_MARK_PREFIX, sealedOpenPaused } from "../src/sealed-open-guard.js";
import type { UserApp } from "../src/user-apps.js";

const marks = (): string[] => Object.keys(localStorage).filter((k) => k.startsWith(OPEN_MARK_PREFIX));
const seen = { bundled: 0, composed: [] as Array<{ provenance: string; marks: number }> };

vi.mock("../src/app-store.js", () => ({ openAppStore: async () => ({ close: async () => {} }), syncAllowedFor: async () => false }));
vi.mock("@potyro/identity", () => ({ ensureIdentity: async () => ({ id: "me" }) }));
vi.mock("../src/read-only-store.js", () => ({ readOnlyStore: (s: unknown) => s }));
vi.mock("../src/shell-caps.js", () => ({ shellCaps: () => ({}) }));
vi.mock("../src/ui-bridge.js", () => ({ createUiBridge: () => ({}), createNavBridge: () => ({}) }));
vi.mock("../src/app-modules.js", () => ({ deviceModules: async () => undefined }));
vi.mock("../src/open-libraries.js", () => ({ librariesForOpen: async () => ({ ok: true, modules: undefined }) }));
vi.mock("../src/trusted-loader.js", () => ({ loadTrustedModule: async () => ({}) }));
vi.mock("../src/app-bundler.js", () => ({ createAppBundler: async () => async () => (seen.bundled++, "code") }));
vi.mock("../src/isolate-bridge.js", () => ({ createSharedAppLoader: async () => ({}) }));
vi.mock("../src/compose.js", () => ({
  compose: async (o: { provenance: string }) => {
    seen.composed.push({ provenance: o.provenance, marks: marks().length });
    // An app with no tile: opened, looked at, put away.
    return { loaded: { definition: {}, dispose: () => {} }, runtime: { close: () => {} } };
  },
}));

const app = (trusted: boolean): UserApp => ({ id: "notes", name: "Notes", source: "export default {}", trusted, updatedAt: new Date().toISOString() }) as UserApp;
const deadTab = (): void => localStorage.setItem(`${OPEN_MARK_PREFIX}deadtab:1`, JSON.stringify({ app: "notes", page: "app", at: Date.now() - 60_000 }));

beforeEach(() => {
  localStorage.clear();
  seen.bundled = 0;
  seen.composed = [];
});

describe("a sealed app's tile, run from Home", () => {
  it("is marked while its code runs, and not after", async () => {
    const { runTileHeadless } = await import("../src/tile-runner.js");
    await runTileHeadless(app(false));
    expect(seen.composed).toEqual([{ provenance: "untrusted", marks: 1 }]);
    expect(marks()).toEqual([]);
    expect(sealedOpenPaused("notes")).toBe(false);
  });

  it("is not run for an app paused after a tab died with it showing: none of its code is even built", async () => {
    const { runTileHeadless } = await import("../src/tile-runner.js");
    deadTab();
    await runTileHeadless(app(false));
    expect(seen.bundled).toBe(0);
    expect(seen.composed).toEqual([]);
    expect(sealedOpenPaused("notes")).toBe(true); // still the person's to start
  });

  it("leaves the person's own apps alone: no marker, no pause", async () => {
    const { runTileHeadless } = await import("../src/tile-runner.js");
    deadTab(); // of a sealed app that happened to have the same id
    await runTileHeadless(app(true));
    expect(seen.composed).toEqual([{ provenance: "trusted", marks: 1 }]); // the dead tab's, not one of its own
  });
});
