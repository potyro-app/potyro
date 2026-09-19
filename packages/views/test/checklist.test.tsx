// @vitest-environment happy-dom
//
// The checklist view (#106): rows under their group headings, and a tick that patches the record and
// strikes the row through WHERE IT IS. Sinking a ticked row to the bottom of its group is opt-in
// (`donePlacement: "sink"`) and covered below. Quick add creates a record and keeps the focus, and an
// enum `done` flips between its options. `hideDone: "collapse"` still folds everything ticked into
// one section.

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
  it("lists rows under their headings, in the order the enum declares, with text and detail", async () => {
    const { runtime } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    await screen.findByRole("heading", { name: "dairy" });
    // The enum's own order — "produce" before "dairy" because the app said so, not the alphabet and
    // not whichever row happened to load first. No global Done section: a ticked row stays in its
    // aisle (`donePlacement: "sink"`, the default).
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["produce", "dairy"]);
    expect(screen.getByText("1 l")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Rice" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Milk" }).getAttribute("aria-checked")).toBe("false");
  });

  it("ticking patches the record and strikes the row through, in its own aisle", async () => {
    const { runtime, store } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    const milk = await screen.findByRole("checkbox", { name: "Milk" });
    await act(async () => {
      fireEvent.click(milk);
    });
    // Generous waits: CI's runner is slow enough that the default second is not always enough for
    // the store to notify and React to commit.
    await waitFor(
      async () => {
        const rows = await store.all("item");
        expect(rows.find((r) => r.name === "Milk")?.bought).toBe(true);
      },
      { timeout: 5000 },
    );
    // Struck through and checked, and still under "dairy" — it never leaves its aisle.
    await waitFor(
      () => {
        const row = screen.getByRole("checkbox", { name: "Milk" }).closest("li")!;
        expect(row.getAttribute("data-done")).toBe("true");
        expect(row.closest("section")?.getAttribute("aria-label")).toBe("dairy");
      },
      { timeout: 5000 },
    );
    // And nothing else was rearranged by the tick: "produce" is in the order it was seeded in.
    const produce = screen.getByRole("heading", { name: "produce" }).closest("section")!;
    const names = [...produce.querySelectorAll(".k-check-label")].map((el) => el.textContent);
    expect(names).toEqual(["Apples", "Rice"]);
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

  it("leaves a ticked row exactly where it is", async () => {
    // Ticked rows used to sink to the bottom of their group. That moved the line you had just
    // touched out from under your finger, and the next line you were about to read with it.
    const { runtime } = await makeRuntime(app({}));
    render(<ChecklistView {...props(runtime)} />);
    await screen.findByRole("checkbox", { name: "Apples" });
    const order = () => [...screen.getByRole("heading", { name: "produce" }).closest("section")!.querySelectorAll(".k-check-label")].map((el) => el.textContent);
    expect(order()).toEqual(["Apples", "Rice"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Apples" }));
    });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Apples" }).getAttribute("aria-checked")).toBe("true"));

    // Struck through, and still first.
    await new Promise((r) => setTimeout(r, 400));
    expect(order()).toEqual(["Apples", "Rice"]);
  });

  it("sinks it promptly, and marks where it landed, for an app that asks", async () => {
    // `donePlacement: "sink"` is the old behaviour, kept for lists where what is left to do staying
    // together matters more. It used to hold the row still for 700ms first so the eye could follow
    // it, which made a tick take about a second end to end; it moves in a fifth of that now and
    // says where it went instead.
    const { runtime } = await makeRuntime(app({ donePlacement: "sink" }));
    render(<ChecklistView {...props(runtime)} />);
    const milk = await screen.findByRole("checkbox", { name: "Milk" });
    await act(async () => {
      fireEvent.click(milk);
    });

    await waitFor(
      () => {
        const row = screen.getByRole("checkbox", { name: "Milk" }).closest("li")!;
        expect(row.getAttribute("data-held")).toBeNull();
        expect(row.getAttribute("data-landed")).toBe("true");
      },
      { timeout: 3000 },
    );
  });

  it("empties the box the moment you hit enter, without waiting for the store", async () => {
    // Typing the next item is the very next thing someone does with a quick-add list. Clearing only
    // once the write was durable meant that on slow storage the next item's letters landed on top of
    // the last one — "Item 2Item 3" — and neither was what anyone asked for.
    const { runtime } = await makeRuntime(app({}));
    const create = runtime.create.bind(runtime);
    // A store that takes its time, the way a phone's does once the database is big.
    runtime.create = (async (entity: string, data: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 50));
      return create(entity, data as never);
    }) as typeof runtime.create;

    render(<ChecklistView {...props(runtime)} />);
    const input = (await screen.findByRole("textbox", { name: "Add an item" })) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Empty already, with the write still in flight.
    expect(input.value).toBe("");
    await screen.findByRole("checkbox", { name: "Bread" });
  });

  it("puts the words back when the write fails, rather than losing what was typed", async () => {
    const { runtime } = await makeRuntime(app({}));
    runtime.create = (async () => {
      throw new Error("the disk is full");
    }) as typeof runtime.create;

    render(<ChecklistView {...props(runtime)} />);
    const input = (await screen.findByRole("textbox", { name: "Add an item" })) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bread" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(input.value).toBe("Bread"));
  });

  it("keeps both items when two are typed before the first has been written", async () => {
    // With the box emptied on enter, a refused second add is an item that vanishes without trace —
    // type, enter, type, enter, and only one of them exists. They queue instead.
    const { runtime, store } = await makeRuntime(app({}));
    const create = runtime.create.bind(runtime);
    runtime.create = (async (entity: string, data: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 30));
      return create(entity, data as never);
    }) as typeof runtime.create;

    render(<ChecklistView {...props(runtime)} />);
    const input = (await screen.findByRole("textbox", { name: "Add an item" })) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Bread" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.change(input, { target: { value: "Butter" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 150));
    });

    await waitFor(async () => {
      const names = (await store.all("item")).map((r) => r.name);
      expect(names).toContain("Bread");
      expect(names).toContain("Butter");
    });
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
