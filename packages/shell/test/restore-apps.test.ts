// @vitest-environment happy-dom
//
// Putting an app from your account onto a device (KA-16 follow-up).
//
// The dangerous half is not the list, it is the install: an app restored WITHOUT the ids of its
// space opens a brand-new empty one, and the data sitting on the relay is stranded with no way back
// to it. That is the same failure a share link avoids by carrying the ids, and it is what this pins.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFromAccount } from "../src/restore-apps.js";
import { getUserApp, listUserApps, saveUserApp, setUserAppSync } from "../src/user-apps.js";
import type { AccountApp } from "@potyro/store";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));
const received = vi.hoisted(() => [] as Array<{ appId: string; code: unknown }>);
vi.mock("../src/app-modules.js", () => ({
  receiveCode: async (appId: string, code: { lock?: unknown; modules?: unknown }) => {
    if (code.lock) received.push({ appId, code: { lock: code.lock, modules: code.modules } });
  },
  // What History reads to keep with the version (#448): not what this test is about.
  ownModuleTexts: async () => undefined,
}));

const NOW = "2026-09-18T12:00:00.000Z";

const APP: AccountApp = {
  id: "split",
  name: "Split",
  icon: "🧾",
  source: 'import { defineApp } from "potyro";\nexport default defineApp({ id: "split", name: "Split" });\n',
  group: "co_zGROUP",
  root: "co_zROOT",
  // Recorded by one of this person's own devices as their own app.
  trusted: true,
  updatedAt: NOW,
};

beforeEach(() => {
  localStorage.clear();
  received.length = 0;
});
afterEach(() => localStorage.clear());

describe("loading an app from your account", () => {
  it("an app this person joined comes back as someone else's, not as their own", async () => {
    // The account's list holds joined apps beside the person's own. Restoring one as trusted would
    // run another person's code directly on the new device (CLAUDE.md rule 3).
    await installFromAccount({ ...APP, trusted: false }, NOW);

    expect(getUserApp("split")).toMatchObject({ trusted: false, sync: true });
  });

  it("an entry recorded before provenance travelled is treated as received", async () => {
    const { trusted: _dropped, ...legacy } = APP;

    await installFromAccount(legacy, NOW);

    expect(getUserApp("split")?.trusted).toBe(false);
  });

  it("installs it pointing at the space its data is already in", async () => {
    await installFromAccount(APP, NOW);

    const app = getUserApp("split")!;
    expect(app).toMatchObject({ id: "split", name: "Split", trusted: true, sync: true });
    expect(app.source).toContain("defineApp");
    // The ids the store looks for. Without them, opening this app mints a new empty space and the
    // records on the relay become unreachable — the app would look like it had lost everything.
    expect(localStorage.getItem("potyro:jazz:group:user:split")).toBe("co_zGROUP");
    expect(localStorage.getItem("potyro:jazz:root:user:split")).toBe("co_zROOT");
    // And WHICH database that space is in. Without this marker the store reads "a group id and no
    // marker" as an app older than the device database, opens a per-app file that never existed,
    // and the app arrives empty beside its own data — which is how it failed in two real browsers.
    expect(localStorage.getItem("potyro:jazz:db:user:split")).toBe("karta-jazz");
  });

  it("replaces a copy this device only has because it seeded one", async () => {
    // Every device seeds the examples for itself, so a newly linked phone already has a Groceries —
    // and that is not a reason to withhold the Groceries with the shopping list in it. The local one
    // is a factory default; the account's is the person's.
    await saveUserApp({ id: "split", name: "Split", source: "// the seeded one\n", trusted: true }, NOW);

    await installFromAccount(APP, "2026-09-19T00:00:00.000Z");

    const app = getUserApp("split")!;
    expect(app.source).toContain("defineApp"); // the account's code, not the seed's
    expect(app.sync).toBe(true);
    expect(localStorage.getItem("potyro:jazz:group:user:split")).toBe("co_zGROUP");
    expect(localStorage.getItem("potyro:jazz:db:user:split")).toBe("karta-jazz");
    expect(listUserApps()).toHaveLength(1);
  });

  it("leaves an app this device is already syncing alone", async () => {
    // That one is already pointed at a space of its own, and a second space cannot be grafted onto
    // it. Whatever it is, it is not this device's to overwrite.
    await saveUserApp({ id: "split", name: "My Split", source: "// mine\n", trusted: true }, NOW);
    setUserAppSync("split", true, NOW);
    localStorage.setItem("potyro:jazz:group:user:split", "co_zMINE");

    await installFromAccount(APP, "2026-09-19T00:00:00.000Z");

    expect(getUserApp("split")?.source).toBe("// mine\n");
    expect(localStorage.getItem("potyro:jazz:group:user:split")).toBe("co_zMINE");
    expect(listUserApps()).toHaveLength(1);
  });

  it("brings its code beyond the source: the lock on the app, its own modules into this device's copy (#281)", async () => {
    const lock = { "src/plan.ts": { file: ".src/plan.ts", integrity: "sha256-AAAA", size: 3 } };
    await installFromAccount({ ...APP, lock, modules: { "src/plan.ts": "x;\n" } }, NOW);
    expect(getUserApp("split")?.lock).toEqual(lock);
    expect(received).toEqual([{ appId: "split", code: { lock, modules: { "src/plan.ts": "x;\n" } } }]);
  });

  it("an entry from before the lock travelled installs as it always did", async () => {
    await installFromAccount(APP, NOW);
    expect(getUserApp("split")?.lock).toBeUndefined();
    expect(received).toEqual([]);
  });
});
