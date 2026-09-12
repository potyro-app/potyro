// @vitest-environment happy-dom
//
// The checklist view (#106): rows under their group headings, a tick that patches the record and
// moves the row to Done after a beat, quick add that creates a record and keeps the focus, and an
// enum `done` that flips between its options.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type KartaApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { ChecklistView } from "../src/checklist.js";

const app = (view: Record<string, unknown>): KartaApp =>
  defineApp({
    id: "groceries-fixture",
    name: "Groceries",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      item: {
        displayField: "name",
        fields: {
          name: { type: "text", required: true },
          aisle: { type: "enum", options: ["produce", "dairy"], default: "produce" },
          qty: { type: "text" },
          bought: { type: "boolean", default: false },
          status: { type: "enum", options: ["todo", "done"], default: "todo" },
        },
      },
    },
    pages: [{ id: "list", title: "Shopping", view: { type: "checklist", entity: "item", done: "bought", text: "name", detail: "qty", group: "aisle", quickAdd: true, ...view } as never }],
  });

async function makeRuntime(def: KartaApp): Promise<{ runtime: KartaRuntime; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.open("groceries-fixture");
  await store.insert("item", { name: "Milk", aisle: "dairy", qty: "1 l", bought: false, status: "todo" });
  await store.insert("item", { name: "Apples", aisle: "produce", qty: "", bought: false, status: "todo" });
  await store.insert("item", { name: "Rice", aisle: "produce", qty: "", bought: true, status: "done" });
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: def });
  return { runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }), store };
}

const props = (runtime: KartaRuntime) => ({ runtime, pageId: "list", params: {}, setParam: () => {}, navigate: vi.fn() });

afterEach(cleanup);

describe("ChecklistView", () => {
  it("lists open rows under their headings and done rows under Done, with text and detail", async () => {
    const { runtime } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    await screen.findByRole("heading", { name: "dairy" });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["dairy", "produce", "Done (1)"]);
    expect(screen.getByText("1 l")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Rice" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Milk" }).getAttribute("aria-checked")).toBe("false");
  });

  it("ticking patches the record, keeps the row in place for a beat, then moves it to Done", async () => {
    const { runtime, store } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    const milk = await screen.findByRole("checkbox", { name: "Milk" });
    await act(async () => {
      fireEvent.click(milk);
    });
    await waitFor(async () => {
      const rows = await store.all("item");
      expect(rows.find((r) => r.name === "Milk")?.bought).toBe(true);
    });
    // Struck through and checked, but still under "dairy" — not yet in Done.
    await waitFor(() => {
      const row = screen.getByRole("checkbox", { name: "Milk" }).closest("li")!;
      expect(row.getAttribute("data-done")).toBe("true");
      expect(row.closest("section")?.getAttribute("aria-label")).toBe("dairy");
    });
    await waitFor(
      () => {
        const moved = screen.getByRole("checkbox", { name: "Milk" }).closest("li")!;
        expect(moved.closest("section")?.getAttribute("aria-label")).toBe("Done");
      },
      { timeout: 2000 },
    );
    expect(screen.getByRole("heading", { name: "Done (2)" })).toBeTruthy();
  });

  it("quick add creates a record with the text as its display field and keeps the focus", async () => {
    const { runtime, store } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    const input = (await screen.findByRole("textbox", { name: "Add an item" })) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Bread" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(async () => {
      const rows = await store.all("item");
      const bread = rows.find((r) => r.name === "Bread");
      expect(bread).toBeTruthy();
      expect(bread?.aisle).toBe("produce"); // the field's default
      expect(bread?.bought).toBe(false);
    });
    await waitFor(() => expect(input.value).toBe(""));
    expect(document.activeElement).toBe(input);
    await screen.findByRole("checkbox", { name: "Bread" });
  });

  it("hides done rows when hideDone is true and folds them when it is collapse", async () => {
    const hidden = await makeRuntime(app({ hideDone: true }));
    const view = render(<ChecklistView {...props(hidden.runtime)} />);
    await screen.findByRole("checkbox", { name: "Milk" });
    expect(screen.queryByRole("checkbox", { name: "Rice" })).toBeNull();
    view.unmount();

    const folded = await makeRuntime(app({ hideDone: "collapse" }));
    render(<ChecklistView {...props(folded.runtime)} />);
    await screen.findByRole("checkbox", { name: "Milk" });
    const details = screen.getByText("Done (1)").closest("details")!;
    expect(details.open).toBe(false);
  });

  it("flips an enum done between its done value and the other option", async () => {
    const { runtime, store } = await makeRuntime(app({ done: "status", doneValue: "done" }));
    render(<ChecklistView {...props(runtime)} />);
    const rice = await screen.findByRole("checkbox", { name: "Rice" });
    expect(rice.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(rice);
    });
    await waitFor(async () => {
      const rows = await store.all("item");
      expect(rows.find((r) => r.name === "Rice")?.status).toBe("todo");
    });
  });
});
