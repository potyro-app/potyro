// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The launcher's own state (#78, #77, #81, #94). The sync, share and identity machinery behind the
// tiles is mocked: this is about what the list shows and how a tile's actions are reached.
vi.mock("../src/identity-panel.js", () => ({ IdentityPanel: () => null, askNameIfUnnamed: async () => {}, offerBackupOnFirstSync: async () => {} }));
vi.mock("../src/open-store.js", () => ({ canSync: () => true, cannotSyncMessage: () => "no" }));
vi.mock("../src/check-concurrency.js", () => ({ checkConcurrency: async () => ({}), describeHazards: () => [] }));
vi.mock("../src/share-sync.js", () => ({ createShareLink: async () => "link" }));
vi.mock("../src/toggle-sync.js", () => ({ toggleAppSync: async () => ({ copied: { records: 0 }, warnings: [] }) }));
vi.mock("../src/history.js", () => ({ History: () => null }));
vi.mock("../src/app-source.js", () => ({ inspect: async () => ({ entities: [], pages: [] }) }));
vi.mock("../src/dialog.js", () => ({ shellDialogs: { confirm: async () => true, prompt: async (_m: string, o?: { default?: string }) => `${o?.default ?? ""} 2`, share: async () => {} } }));

import { Launcher } from "../src/launcher.js";
import { USER_APPS_CHANGED, type UserApp } from "../src/user-apps.js";

const app = (id: string, name = id): UserApp => ({ id, name, source: "export default 1", updatedAt: "2026-09-11T00:00:00.000Z", trusted: true });
const seed = (...apps: UserApp[]) => localStorage.setItem("potyro:user-apps", JSON.stringify(apps));
const props = { variant: "home" as const, onOpen: () => {}, onNewApp: () => {} };
const tiles = (name: string) => screen.queryAllByRole("button", { name: new RegExp(name) }).filter((b) => b.classList.contains("k-launch-tile"));
/** The home screen's All apps pane (#96): every app's row, its menu, the search field. */
const allApps = () => fireEvent.click(screen.getByRole("tab", { name: "All apps" }));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Launcher", () => {
  // #78 / #81: the list used to be a prop read once. Now it is the launcher store, live: a write to
  // the registry from anywhere — the Studio, another launcher, another tab — reaches this render.
  it("shows an app saved after it mounted, with no help from its parent", () => {
    render(<Launcher {...props} />);
    allApps();
    expect(tiles("Groceries")).toHaveLength(0);
    seed(app("groceries", "Groceries"));
    act(() => {
      window.dispatchEvent(new Event(USER_APPS_CHANGED));
    });
    expect(tiles("Groceries")).toHaveLength(1);
  });

  it("hands the opened app to onOpen with its key", () => {
    seed(app("groceries", "Groceries"), app("trips", "Trips"));
    const onOpen = vi.fn();
    render(<Launcher {...props} onOpen={onOpen} />);
    allApps();
    fireEvent.click(tiles("Trips")[0]!);
    fireEvent.click(tiles("Groceries")[0]!);
    expect(onOpen.mock.calls.map(([a]) => [a.kind, a.id, a.key])).toEqual([
      ["user", "trips", "user:trips"],
      ["user", "groceries", "user:groceries"],
    ]);
  });

  // #77: the actions were a row that was `opacity: 0` until hover. A phone has no hover.
  it("reaches every per-app action through an always-visible menu button", async () => {
    seed(app("groceries", "Groceries"));
    render(<Launcher {...props} />);
    allApps();
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

  // Owner, 2026-10-13: a sealed app can ALWAYS be let run as yours — from its tile too, because an
  // app that cannot open sealed never shows its own badge.
  it("offers a sealed app, and only a sealed one, to run as yours — through the one trust dialog", () => {
    seed({ ...app("garden", "Garden"), trusted: false }, app("groceries", "Groceries"));
    render(<Launcher {...props} />);
    allApps();
    fireEvent.click(screen.getByRole("button", { name: /Actions for Groceries/ }));
    expect(screen.queryByRole("menuitem", { name: "Let it run as yours" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /Actions for Garden/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Let it run as yours" }));
    const dialog = screen.getByRole("dialog", { name: "Let it run as yours?" });
    expect(dialog.textContent).toContain("Only do this if you made it, or you know and trust whoever did.");
    expect(document.activeElement?.textContent).toBe("Cancel");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Let it run as yours?" })).toBeNull();
    // Nothing changed by looking.
    expect(JSON.parse(localStorage.getItem("potyro:user-apps")!).find((a: UserApp) => a.id === "garden").trusted).toBe(false);
  });

  // #94: a menu is a keyboard thing. Focus moves into it on open, arrows walk it (wrapping), and
  // Escape puts focus back on the button — without the first of these, Escape did nothing, because
  // the button holding focus was outside the element listening for it.
  it("is a keyboard menu: focus in, arrows wrap, Escape returns focus to the button", () => {
    seed(app("groceries", "Groceries"));
    render(<Launcher {...props} />);
    allApps();
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

// #96: the Start screen's wall. A new app is placed once what it declares about itself is read; the
// menu's Pin/Unpin puts it on the wall or takes it off, and All apps keeps it either way.
describe("Launcher wall", () => {
  it("places an app on the wall once its identity is read, and Unpin/Pin take it off and back", async () => {
    seed(app("groceries", "Groceries"), app("trips", "Trips"));
    render(<Launcher {...props} />);
    const onWall = () => Array.from(document.querySelectorAll<HTMLElement>(".k-metro-wall .k-metro-cell")).map((el) => el.dataset.key);
    await vi.waitFor(() => expect(onWall()).toEqual(["user:groceries", "user:trips"]));
    expect(JSON.parse(localStorage.getItem("potyro:launcher:wall")!).placed).toEqual(["user:groceries", "user:trips"]);
    allApps();
    fireEvent.click(screen.getByRole("button", { name: /Actions for Trips/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    expect(JSON.parse(localStorage.getItem("potyro:launcher:wall")!).unpinned).toEqual(["user:trips"]);
    // Still in All apps, with a way back.
    expect(tiles("Trips")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Pin Trips to Start" }));
    fireEvent.click(screen.getByRole("tab", { name: "Start" }));
    expect(onWall()).toContain("user:trips");
  });
});

// #85: search. The field filters; nothing found offers to create it; Enter opens the first match.
describe("Launcher search", () => {
  it("filters the tiles by name and offers to create what it cannot find", () => {
    seed(app("groceries", "Groceries"), app("garden", "Garden"), app("trips", "Trips"));
    const onNewApp = vi.fn();
    render(<Launcher {...props} onNewApp={onNewApp} />);
    allApps();
    const field = screen.getByRole("searchbox", { name: "Find an app" });
    fireEvent.change(field, { target: { value: "gr" } });
    expect(tiles("Groceries")).toHaveLength(1);
    expect(tiles("Garden")).toHaveLength(0);
    expect(tiles("Trips")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "zzz" } });
    expect(screen.getByText(/No app called “zzz”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Create “zzz”/ }));
    expect(onNewApp).toHaveBeenCalledWith("zzz");
    // Escape clears.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(tiles("Garden")).toHaveLength(1);
  });

  it("opens the first match on Enter", () => {
    seed(app("groceries", "Groceries"), app("garden", "Garden"));
    const onOpen = vi.fn();
    render(<Launcher {...props} onOpen={onOpen} />);
    allApps();
    const field = screen.getByRole("searchbox", { name: "Find an app" });
    fireEvent.change(field, { target: { value: "gar" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onOpen.mock.calls.map(([a]) => a.id)).toEqual(["garden"]);
  });
});

// #83: what this device calls an app, shows for it, and colours it — from the tile menu, on the
// launcher entry only; the app's record is untouched.
describe("Launcher tile editor", () => {
  it("renames, re-icons and recolours the tile from its menu, on this device only", () => {
    seed(app("recipes", "Recipes"));
    render(<Launcher {...props} />);
    allApps();
    fireEvent.click(screen.getByRole("button", { name: /Actions for Recipes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit tile" }));
    const dialog = screen.getByRole("dialog", { name: "Edit tile: Recipes" });
    fireEvent.change(screen.getByRole("textbox", { name: "Tile name" }), { target: { value: "Mum's recipes" } });
    fireEvent.click(screen.getByRole("button", { name: "Icon 🥘" }));
    fireEvent.click(screen.getByRole("button", { name: "Hue 205" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", { name: /Edit tile/ })).toBeNull();
    expect(dialog.isConnected).toBe(false);
    const tile = tiles("Mum's recipes")[0]!;
    expect(tile.querySelector(".k-launch-avatar")?.textContent).toBe("🥘");
    expect(tile.style.getPropertyValue("--tile-accent")).toBe("oklch(72% 0.13 205)");
    expect(JSON.parse(localStorage.getItem("potyro:launcher")!)["user:recipes"]).toMatchObject({ displayName: "Mum's recipes", icon: "🥘", hue: 205 });
    // The record is the author's, untouched.
    expect(JSON.parse(localStorage.getItem("potyro:user-apps")!)[0].name).toBe("Recipes");
    // Reset puts it back.
    fireEvent.click(screen.getByRole("button", { name: /Actions for Mum's recipes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit tile" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset name" }));
    fireEvent.click(screen.getByRole("button", { name: "The app's own colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(tiles("Recipes")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("potyro:launcher")!)["user:recipes"].hue).toBeUndefined();
  });
});
