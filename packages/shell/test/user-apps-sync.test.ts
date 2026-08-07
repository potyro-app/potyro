// @vitest-environment happy-dom
// The per-app sync flag (ADR 0001 D3 — sync is opt-in per app, not a product-wide mode).
//
// `saveUserApp` REBUILDS the record rather than merging into it, so any field not named explicitly
// is silently dropped. That makes flag preservation a real hazard rather than a theoretical one:
// losing `sync` on an edit would switch the app back to the non-CRDT store, which keeps its data in
// a different file — so the app would reopen empty, indistinguishable from data loss.

import { beforeEach, describe, expect, it } from "vitest";
import { getUserApp, saveUserApp, setUserAppSync } from "../src/user-apps.js";

const NOW = "2026-08-07T12:00:00.000Z";

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe("per-app sync flag", () => {
  it("is off by default — an app does not opt into sync by existing", async () => {
    const app = await saveUserApp({ name: "Split", source: "export default {}" }, NOW);
    // Assert the app is actually there first: `toBeFalsy()` alone passes on a MISSING app, which
    // is how this test silently passed while the other three were failing to save at all.
    expect(getUserApp(app.id)).toBeDefined();
    expect(getUserApp(app.id)?.sync).toBeFalsy();
  });

  it("can be switched on and read back", async () => {
    const app = await saveUserApp({ name: "Split", source: "export default {}" }, NOW);
    setUserAppSync(app.id, true, NOW);
    expect(getUserApp(app.id)?.sync).toBe(true);
  });

  it("survives a later edit of the app source", async () => {
    // The regression this file exists for.
    const app = await saveUserApp({ name: "Split", source: "v1" }, NOW);
    setUserAppSync(app.id, true, NOW);

    await saveUserApp({ id: app.id, name: "Split", source: "v2" }, NOW);

    expect(getUserApp(app.id)?.source).toBe("v2");
    expect(getUserApp(app.id)?.sync).toBe(true); // would be undefined if the rebuild dropped it
  });

  it("can be switched back off", async () => {
    const app = await saveUserApp({ name: "Split", source: "v1" }, NOW);
    setUserAppSync(app.id, true, NOW);
    setUserAppSync(app.id, false, NOW);
    expect(getUserApp(app.id)?.sync).toBe(false);
  });
});
