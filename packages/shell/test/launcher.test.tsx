// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The launcher's own state (#78, #77). The sync, share and identity machinery behind the tiles is
// mocked: this is about what the list shows and how a tile's actions are reached, not about sync.
vi.mock("../src/identity-panel.js", () => ({ IdentityPanel: () => null, askNameIfUnnamed: async () => {}, offerBackupOnFirstSync: async () => {} }));
vi.mock("../src/open-store.js", () => ({ canSync: () => true, CANNOT_SYNC_MESSAGE: "no" }));
vi.mock("../src/check-concurrency.js", () => ({ checkConcurrency: async () => ({}), describeHazards: () => [] }));
vi.mock("../src/share-sync.js", () => ({ createShareLink: async () => "link" }));
vi.mock("../src/toggle-sync.js", () => ({ toggleAppSync: async () => ({ copied: { records: 0 }, warnings: [] }) }));
vi.mock("../src/history.js", () => ({ History: () => null }));
vi.mock("../src/app-source.js", () => ({ inspect: async () => ({ entities: [], pages: [] }) }));
vi.mock("../src/dialog.js", () => ({ shellDialogs: { confirm: async () => true, prompt: async (_m: string, o?: { default?: string }) => `${o?.default ?? ""} 2` } }));

import { Launcher } from "../src/launcher.js";
import type { UserApp } from "../src/user-apps.js";

const app = (id: string, name = id): UserApp => ({ id, name, source: "export default 1", updatedAt: "2026-09-11T00:00:00.000Z", trusted: true });
const props = { builtins: ["recipes"], variant: "home" as const, onOpenBuiltin: () => {}, onOpenUser: () => {}, onNewApp: () => {} };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Launcher", () => {
  // #78: `useState(userApps)` read the prop once. Create an app in the Studio, close it, and the
  // home screen still showed the old list until a full reload.
  it("shows an app that arrives in a later render, not only the first one", () => {
    const tile = (name: string) => screen.queryAllByRole("button", { name: new RegExp(name) }).filter((b) => b.classList.contains("k-launch-tile"));
    const { rerender } = render(<Launcher {...props} userApps={[]} />);
    expect(tile("Groceries")).toHaveLength(0);
    rerender(<Launcher {...props} userApps={[app("groceries", "Groceries")]} />);
    expect(tile("Groceries")).toHaveLength(1);
  });

  // #77: the actions were a row that was `opacity: 0` until hover. A phone has no hover.
  it("reaches every per-app action through an always-visible menu button", async () => {
    localStorage.setItem("karta:user-apps", JSON.stringify([app("groceries", "Groceries")]));
    render(<Launcher {...props} userApps={[app("groceries", "Groceries")]} />);
    const menuButton = screen.getByRole("button", { name: /Actions for Groceries/ });
    expect(menuButton.className).not.toContain("k-launch-act");
    fireEvent.click(menuButton);
    const menu = screen.getByRole("menu");
    for (const item of ["Open", "History", "Share", "Rename", "Delete"]) expect(menu.querySelector(`[role=menuitem][data-action="${item.toLowerCase()}"]`)).toBeTruthy();
    // Delete sits apart from the rest, styled as destructive.
    expect(menu.querySelector('[data-action="delete"]')?.className).toContain("k-danger");
    // Rename goes through the same handler as before and the tile updates in place.
    fireEvent.click(menu.querySelector('[data-action="rename"]')!);
    const renamed = await screen.findAllByRole("button", { name: /Groceries 2/ });
    expect(renamed.some((b) => b.classList.contains("k-launch-tile"))).toBe(true);
    // The menu closed once an item was chosen.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("has no dead conditional around Share", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src/launcher.tsx"), "utf8");
    expect(source).not.toContain("{true ?");
  });
});
