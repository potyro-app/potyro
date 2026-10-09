// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { defineApp } from "potyro";
import type { ListField } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldInput, FieldValue, moveKey, singular } from "../src/index.js";

// Nested rows as cards (#104): a card per row, Remove in its menu, a grip and arrow keys when the
// list is ordered, and a button that says what it adds.

const app = defineApp({
  id: "rows-fixture",
  name: "Rows Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    recipe: {
      label: "Recipe",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        steps: { type: "list", ordered: true, label: "Steps", of: { text: { type: "text" }, minutes: { type: "number" } } },
      },
    },
  },
  pages: [{ id: "list", title: "Recipes", view: { type: "list", entity: "recipe", display: { primary: "name" } } }],
});

async function makeRuntime(): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("rows-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

const steps: ListField = { type: "list", ordered: true, label: "Steps", of: { text: { type: "text" }, minutes: { type: "number" } } };
const parts: ListField = { type: "list", label: "Ingredients", of: { name: { type: "text" }, grams: { type: "number" } } };
const rows = [{ text: "Heat the pan", minutes: 2 }, { text: "Sear it", minutes: 8 }, { text: "Toss the leaves", minutes: 1 }];

afterEach(cleanup);

describe("naming what it adds", () => {
  it("says one of the thing, not 'row'", () => {
    expect(singular("Steps")).toBe("step");
    expect(singular("Ingredients")).toBe("ingredient");
    expect(singular("Seasonal Care")).toBe("seasonal care");
    expect(singular("Entries")).toBe("entry");
    expect(singular("Progress")).toBe("progress");
    expect(singular("")).toBe("row");
  });
});

describe("the cards", () => {
  it("gives each row a card with its first field on the line and the rest under it", async () => {
    const runtime = await makeRuntime();
    render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={() => {}} label="Steps" />);
    const cards = document.querySelectorAll(".k-row-card");
    expect(cards).toHaveLength(3);
    expect((within(cards[0] as HTMLElement).getByRole("textbox") as HTMLInputElement).value).toBe("Heat the pan");
    // The second field is labelled inside the card, not left as a bare box.
    expect(within(cards[0] as HTMLElement).getByText("Minutes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "＋ Add step" })).toBeTruthy();
  });

  it("removes a row from the card's menu, not from a bare ✕", async () => {
    const runtime = await makeRuntime();
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={onChange} label="Steps" />);
    expect(document.querySelector(".k-remove")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Heat the pan: more" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove step/ }));
    expect(onChange).toHaveBeenCalledWith([rows[1], rows[2]]);
  });

  it("adding a row appends an empty one", async () => {
    const runtime = await makeRuntime();
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={onChange} label="Steps" />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Add step" }));
    expect(onChange).toHaveBeenCalledWith([...rows, {}]);
  });
});

describe("order", () => {
  it("only an ordered list gets a grip; a plain one is numbered", async () => {
    const runtime = await makeRuntime();
    const { rerender } = render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={() => {}} label="Steps" />);
    expect(document.querySelectorAll(".k-row-grip")).toHaveLength(3);
    expect(document.querySelectorAll(".k-row-n")).toHaveLength(0);

    rerender(<FieldInput runtime={runtime} field={parts} value={[{ name: "Flour" }]} onChange={() => {}} label="Ingredients" />);
    expect(document.querySelectorAll(".k-row-grip")).toHaveLength(0);
    expect(document.querySelector(".k-row-n")?.textContent).toBe("1");
  });

  it("an arrow key on the grip moves the row, and the new order is what is written", async () => {
    const runtime = await makeRuntime();
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={onChange} label="Steps" />);
    const grips = document.querySelectorAll(".k-row-grip");
    fireEvent.keyDown(grips[2] as HTMLElement, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith([rows[0], rows[2], rows[1]]);
    onChange.mockClear();
    fireEvent.keyDown(grips[0] as HTMLElement, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled(); // already first
  });

  it("names the row and its position for a screen reader", async () => {
    const runtime = await makeRuntime();
    render(<FieldInput runtime={runtime} field={steps} value={rows} onChange={() => {}} label="Steps" />);
    expect(screen.getByRole("button", { name: /Reorder Sear it, 2 of 3/ })).toBeTruthy();
  });

  it("moveKey clamps and leaves an unknown key alone", () => {
    const list = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(moveKey(list, "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveKey(list, "c", -5)).toEqual(["c", "a", "b"]);
    expect(moveKey(list, "zz", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("the value on a record page", () => {
  it("reads an ordered list as a numbered list", async () => {
    const runtime = await makeRuntime();
    const { container } = render(<FieldValue runtime={runtime} entity="recipe" fieldKey="steps" value={rows} />);
    const items = container.querySelectorAll("ol.k-row-list li");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Heat the pan");
    expect(container.querySelector("table")).toBeNull();
  });
});
