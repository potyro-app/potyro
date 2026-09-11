// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The launcher's own state (#78, #77, #81, #94). The sync, share and identity machinery behind the
// tiles is mocked: this is about what the list shows and how a tile's actions are reached.
vi.mock("../src/identity-panel.js", () => ({ IdentityPanel: () => null, askNameIfUnnamed: async () => {}, offerBackupOnFirstSync: async () => {} }));
vi.mock("../src/open-store.js", () => ({ canSync: () => true, CANNOT_SYNC_MESSAGE: "no" }));
vi.mock("../src/check-concurrency.js", () => ({ checkConcurrency: async () => ({}), describeHazards: () => [] }));
vi.mock("../src/share-sync.js", () => ({ createShareLink: async () => "link" }));
vi.mock("../src/toggle-sync.js", () => ({ toggleAppSync: async () => ({ copied: { records: 0 }, warnings: [] }) }));
vi.mock("../src/history.js", () => ({ History: () => null }));
vi.mock("../src/app-source.js", () => ({ inspect: async () => ({ entities: [], pages: [] }) }));
vi.mock("../src/dialog.js", () => ({ shellDialogs: { confirm: async () => true, prompt: async (_m: string, o?: { default?: string }) => `${o?.default ?? ""} 2`, share: async () => {} } }));

import { Launcher } from "../src/launcher.js";
import { USER_APPS_CHANGED, type UserApp } from "../src/user-apps.js";

const app = (id: string, name = id): UserApp => ({ id, name, source: "export default 1", updatedAt: "2026-09-11T00:00:00.000Z", trusted: true });
const seed = (...apps: UserApp[]) => localStorage.setItem("karta:user-apps", JSON.stringify(apps));
const props = { variant: "home" as const, onOpen: () => {}, onNewApp: () => {} };
const tiles = (name: string) => screen.queryAllByRole("button", { name: new RegExp(name) }).filter((b) => b.classList.contains("k-launch-tile"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Launcher", () => {
  // #78 / #81: the list used to be a prop read once. Now it is the launcher store, live: a write to
  // the registry from anywhere — the Studio, another launcher, another tab — reaches this render.
  it("shows an app saved after it mounted, with no help from its parent", () => {
    render(<Launcher {...props} />);
    expect(tiles("recipes")).toHaveLength(1); // the built-ins come from the same list
    expect(tiles("Groceries")).toHaveLength(0);
    seed(app("groceries", "Groceries"));
    act(() => {
      window.dispatchEvent(new Event(USER_APPS_CHANGED));
    });
    expect(tiles("Groceries")).toHaveLength(1);
  });

  it("hands the opened app to onOpen with its kind, for both kinds", () => {
    seed(app("groceries", "Groceries"));
    const onOpen = vi.fn();
    render(<Launcher {...props} onOpen={onOpen} />);
    fireEvent.click(tiles("recipes")[0]!);
    fireEvent.click(tiles("Groceries")[0]!);
    expect(onOpen.mock.calls.map(([a]) => [a.kind, a.id, a.key])).toEqual([
      ["builtin", "recipes", "builtin:recipes"],
      ["user", "groceries", "user:groceries"],
    ]);
  });

  // #77: the actions were a row that was `opacity: 0` until hover. A phone has no hover.
  it("reaches every per-app action through an always-visible menu button", async () => {
    seed(app("groceries", "Groceries"));
    render(<Launcher {...props} />);
    const menuButton = screen.getByRole("button", { name: /Actions for Groceries/ });
    expect(menuButton.className).not.toContain("k-launch-act");
    fireEvent.click(menuButton);
    const menu = screen.getByRole("menu");
    for (const item of ["Open", "History", "Share", "Rename", "Delete"]) expect(menu.querySelector(`[role=menuitem][data-action="${item.toLowerCase()}"]`)).toBeTruthy();
    // Delete sits apart from the rest, styled as destructive.
    expect(menu.querySelector('[data-action="delete"]')?.className).toContain("k-danger");
    // Rename goes through the same handler as before and the tile updates in place — through the
    // registry's own change event, not a local copy.
    fireEvent.click(menu.querySelector('[data-action="rename"]')!);
    const renamed = await screen.findAllByRole("button", { name: /Groceries 2/ });
    expect(renamed.some((b) => b.classList.contains("k-launch-tile"))).toBe(true);
    // The menu closed once an item was chosen.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // #94: a menu is a keyboard thing. Focus moves into it on open, arrows walk it (wrapping), and
  // Escape puts focus back on the button — without the first of these, Escape did nothing, because
  // the button holding focus was outside the element listening for it.
  it("is a keyboard menu: focus in, arrows wrap, Escape returns focus to the button", () => {
    seed(app("groceries", "Groceries"));
    render(<Launcher {...props} />);
    const button = screen.getByRole("button", { name: /Actions for Groceries/ });
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    const item = (name: string) => screen.getByRole("menuitem", { name });
    expect(document.activeElement).toBe(item("Open"));
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Delete"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Open"));
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(item("Delete"));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("has no dead conditional around Share", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src/launcher.tsx"), "utf8");
    expect(source).not.toContain("{true ?");
  });
});
