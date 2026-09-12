// @vitest-environment happy-dom
//
// The one menu behind one button (#111): a real menu — opens on the button, the first item takes
// the focus, arrow keys move and wrap, Escape closes and gives the focus back to the button, an
// item runs its action and closes, a separator and a danger item render as such.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionMenu } from "../src/menu.js";

afterEach(cleanup);

function open() {
  const edit = vi.fn();
  const del = vi.fn();
  render(
    <ActionMenu
      label="More actions"
      title="Chicken Caesar"
      entries={[
        { key: "edit", label: "Edit", icon: "✎", onSelect: edit },
        "separator",
        { key: "delete", label: "Delete", icon: "🗑", danger: true, onSelect: del },
      ]}
    />,
  );
  const button = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(button);
  return { button, edit, del, menu: screen.getByRole("menu", { name: "More actions" }) };
}

describe("ActionMenu", () => {
  it("opens as a menu with the first item focused, and a danger item last", () => {
    const { button, menu } = open();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["✎Edit", "🗑Delete"]);
    expect(document.activeElement).toBe(items[0]);
    expect(items[1]!.className).toContain("k-danger");
    expect(menu.querySelectorAll("[role=separator]")).toHaveLength(1);
  });

  it("moves with the arrow keys and wraps; Escape closes and returns the focus to the button", () => {
    const { button, menu } = open();
    const [edit, del] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(del);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(del);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("runs the item's action and closes", () => {
    const { del } = open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
