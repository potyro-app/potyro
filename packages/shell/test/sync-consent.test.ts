// @vitest-environment happy-dom
// Asking before a sandboxed app's data leaves the device (KA-23, #64).
//
// Sync is what lets an app someone else wrote put data where other people can read it — the same
// kind of power as `ctx.caps.network`, and asked about the same way. Your own apps are not asked
// about: you wrote them, and they already run directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declaredSync } from "../src/app-source.js";
import { askToSync, rememberSyncConsent, syncConsented } from "../src/sync-consent.js";
import { shellDialogs } from "../src/dialog.js";
import type { UserApp } from "../src/user-apps.js";

const app = (over: Partial<UserApp> = {}): UserApp =>
  ({ id: "trip", name: "Trip Costs", source: SOURCE(), trusted: false, updatedAt: "2026-09-16T00:00:00.000Z", ...over }) as UserApp;

const SOURCE = (permissions?: string) => `import { defineApp } from "karta";
export default defineApp({
  id: "trip", name: "Trip Costs", version: "1.0.0", schemaVersion: 1,${permissions ? `\n  permissions: ${permissions},` : ""}
  entities: { expense: { fields: { description: { type: "text" } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "expense" } }],
});
`;

const realConfirm = shellDialogs.confirm;
beforeEach(() => localStorage.clear());
afterEach(() => {
  shellDialogs.confirm = realConfirm;
});

describe("what the app declares", () => {
  it("reads permissions.sync out of the source without running it", async () => {
    expect(await declaredSync(SOURCE("{ sync: true }"))).toBe(true);
    expect(await declaredSync(SOURCE("{ sync: false }"))).toBe(false);
    expect(await declaredSync(SOURCE("{ camera: true }"))).toBe(false);
    expect(await declaredSync(SOURCE())).toBe(false);
  });

  it("says null — never 'it asked' — when the module cannot be read", async () => {
    // A manifest built by a helper, or a file that does not parse: unknown, and the caller treats
    // unknown as "did not ask".
    expect(await declaredSync(SOURCE("PERMS"))).toBeNull();
    expect(await declaredSync("this is not a module {")).toBeNull();
  });
});

describe("asking", () => {
  it("does not ask about your own app", async () => {
    const ask = vi.fn(async () => false);
    shellDialogs.confirm = ask;
    expect(await askToSync(app({ trusted: true }))).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks once for a sandboxed app, then remembers the yes", async () => {
    const ask = vi.fn(async () => true);
    shellDialogs.confirm = ask;
    expect(await askToSync(app())).toBe(true);
    expect(await askToSync(app())).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    expect(syncConsented("trip")).toBe(true);
  });

  it("says the app asked for this when it did, and warns when it did not", async () => {
    const ask = vi.fn(async () => true);
    shellDialogs.confirm = ask;
    await askToSync({ ...app(), source: SOURCE("{ sync: true }") } as UserApp);
    expect(ask.mock.calls[0]![0]).toContain("runs in a sandbox");
    expect(ask.mock.calls[0]![1]).toMatchObject({ ok: "Share" });
    expect(ask.mock.calls[0]![1]?.destructive).toBeUndefined();

    localStorage.clear();
    await askToSync(app());
    expect(ask.mock.calls[1]![0]).toContain("never asked to sync");
    expect(ask.mock.calls[1]![1]).toMatchObject({ ok: "Share anyway", cancel: "Don't share", destructive: true });
  });

  it("takes a no as a no, and asks again next time rather than making it final", async () => {
    // Only a YES is remembered as settled. A no leaves the app local-only; tapping Share again is
    // how someone changes their mind, and a decision they cannot revisit would be a trap.
    shellDialogs.confirm = vi.fn(async () => false);
    expect(await askToSync(app())).toBe(false);
    expect(syncConsented("trip")).toBe(false);

    const second = vi.fn(async () => true);
    shellDialogs.confirm = second;
    expect(await askToSync(app())).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(syncConsented("trip")).toBe(true);
  });

  it("is per app, not per device", () => {
    rememberSyncConsent("trip", true);
    expect(syncConsented("trip")).toBe(true);
    expect(syncConsented("some-other-app")).toBe(false);
  });
});
