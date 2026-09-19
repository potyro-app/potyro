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
import type { AccountApp } from "@karta/store";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const NOW = "2026-09-18T12:00:00.000Z";

const APP: AccountApp = {
  id: "split",
  name: "Split",
  icon: "🧾",
  source: 'import { defineApp } from "karta";\nexport default defineApp({ id: "split", name: "Split" });\n',
  group: "co_zGROUP",
  root: "co_zROOT",
  updatedAt: NOW,
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("loading an app from your account", () => {
  it("installs it pointing at the space its data is already in", async () => {
    await installFromAccount(APP, NOW);

    const app = getUserApp("split")!;
    expect(app).toMatchObject({ id: "split", name: "Split", trusted: true, sync: true });
    expect(app.source).toContain("defineApp");
    // The ids the store looks for. Without them, opening this app mints a new empty space and the
    // records on the relay become unreachable — the app would look like it had lost everything.
    expect(localStorage.getItem("karta:jazz:group:user:split")).toBe("co_zGROUP");
    expect(localStorage.getItem("karta:jazz:root:user:split")).toBe("co_zROOT");
    // And WHICH database that space is in. Without this marker the store reads "a group id and no
    // marker" as an app older than the device database, opens a per-app file that never existed,
    // and the app arrives empty beside its own data — which is how it failed in two real browsers.
    expect(localStorage.getItem("karta:jazz:db:user:split")).toBe("karta-jazz");
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
    expect(localStorage.getItem("karta:jazz:group:user:split")).toBe("co_zGROUP");
    expect(localStorage.getItem("karta:jazz:db:user:split")).toBe("karta-jazz");
    expect(listUserApps()).toHaveLength(1);
  });

  it("leaves an app this device is already syncing alone", async () => {
    // That one is already pointed at a space of its own, and a second space cannot be grafted onto
    // it. Whatever it is, it is not this device's to overwrite.
    await saveUserApp({ id: "split", name: "My Split", source: "// mine\n", trusted: true }, NOW);
    setUserAppSync("split", true, NOW);
    localStorage.setItem("karta:jazz:group:user:split", "co_zMINE");

    await installFromAccount(APP, "2026-09-19T00:00:00.000Z");

    expect(getUserApp("split")?.source).toBe("// mine\n");
    expect(localStorage.getItem("karta:jazz:group:user:split")).toBe("co_zMINE");
    expect(listUserApps()).toHaveLength(1);
  });
});
