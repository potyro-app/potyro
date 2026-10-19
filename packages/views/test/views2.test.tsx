// @vitest-environment happy-dom
// Views 2: a record page's related records (list, timeline, chart), aggregate rows that lead
// somewhere, the checklist's add box that remembers, and a record's own glyph (`display.icon`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type AppInput } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { DetailView } from "../src/detail.js";
import { ListView } from "../src/builtins.js";
import { AggregateView } from "../src/aggregate.js";
import { ChecklistView } from "../src/checklist.js";
import { pointsAt, relatedBars } from "../src/related.js";

afterEach(cleanup);

const watered: string[] = [];

const garden: AppInput = {
  id: "garden",
  name: "Garden",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      label: "Plant",
      icon: "🌱",
      displayField: "name",
      fields: { name: { type: "text" }, kind: { type: "text" } },
      actions: { water: { label: "Water", run: (r) => void watered.push(String(r.name)) } },
    },
    care: {
      label: "Care",
      displayField: "note",
      fields: { note: { type: "text" }, plant: { type: "relation", to: "plant" }, when: { type: "datetime" }, ml: { type: "number" } },
    },
  },
  pages: [
    {
      id: "plants",
      title: "Plants",
      view: { type: "list", entity: "plant", display: { primary: "name", icon: (r) => (r.kind === "cactus" ? "🌵" : "🌿") }, onOpen: { page: "plant", param: { id: "id" } } },
    },
    {
      id: "plant",
      title: "Plant",
      hidden: true,
      view: {
        type: "detail",
        entity: "plant",
        param: "id",
        sections: [
          { title: "Care log", related: { entity: "care", via: "plant", view: "timeline", date: "when", display: { primary: (r) => `💧 ${r.note}` } } },
          { title: "Water", related: { entity: "care", via: "plant", view: "chart", date: "when", value: "ml", by: "day" } },
        ],
      },
    },
    {
      id: "due",
      title: "Due",
      view: {
        type: "aggregate",
        entity: "plant",
        rows: (rows) => rows.map((p) => ({ label: String(p.name), value: "now", record: { entity: "plant", id: p.id }, action: { entity: "plant", id: p.id, key: "water" } })),
      },
    },
  ],
};

async function runtimeFor(def: AppInput): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  const built = defineApp(def);
  await store.open(built.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost();
  return createRuntime({ app: await host.load({ kind: "module", app: built }), host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
}

const props = (runtime: PotyroRuntime, pageId: string, params: Record<string, unknown> = {}) => ({ runtime, pageId, params, setParam: () => {}, navigate: vi.fn() });

describe("a record page's related records", () => {
  it("lists only the records that point at this one, newest first, words from a function binding, and Add pre-fills the relation", async () => {
    const runtime = await runtimeFor(garden);
    const fern = await runtime.ctx.create("plant", { name: "Fern" });
    const cactus = await runtime.ctx.create("plant", { name: "Cactus", kind: "cactus" });
    const day = (n: number) => new Date(Date.now() - n * 86_400_000);
    await runtime.ctx.create("care", { note: "a little", plant: fern.id, when: day(3), ml: 100 });
    await runtime.ctx.create("care", { note: "soaked", plant: fern.id, when: day(1), ml: 400 });
    await runtime.ctx.create("care", { note: "never", plant: cactus.id, when: day(1), ml: 10 });
    const onCreate = vi.fn();
    render(<DetailView {...props(runtime, "plant", { id: fern.id })} onCreate={onCreate} />);
    await waitFor(() => expect(document.querySelectorAll(".k-rel-timeline .k-primary")).toHaveLength(2));
    const texts = [...document.querySelectorAll(".k-rel-timeline .k-primary")].map((e) => e.textContent);
    await waitFor(() => expect([...document.querySelectorAll(".k-rel-timeline .k-primary")].map((e) => e.textContent)).toEqual(["💧 soaked", "💧 a little"]));
    expect(texts.join()).not.toContain("never");
    // The chart sums ml per day: 500 in all, for this plant only.
    expect(document.querySelector(".k-rel-total-value")?.textContent).toBe("500");
    fireEvent.click(screen.getAllByRole("button", { name: "Add another" })[0]!);
    expect(onCreate).toHaveBeenCalledWith("care", { plant: fern.id });
  });

  it("puts each record in its day, week or month, and a to-many relation counts", () => {
    const now = new Date(2026, 9, 16, 12);
    const rows = [
      { id: "a", when: new Date(2026, 9, 16, 8), ml: 2 },
      { id: "b", when: new Date(2026, 9, 15, 8), ml: 3 },
      { id: "c", when: new Date(2026, 8, 1), ml: 99 },
    ] as never[];
    const days = relatedBars(rows, { date: "when", value: "ml", by: "day" }, now);
    expect(days).toHaveLength(14);
    expect(days.at(-1)!.value).toBe(2);
    expect(days.at(-2)!.value).toBe(3);
    expect(relatedBars(rows, { date: "when", by: "month" }, now).at(-2)!.value).toBe(1);
    expect(pointsAt({ id: "x", plant: [{ id: "p1" }, { id: "p2" }] } as never, "plant", "p2")).toBe(true);
    expect(pointsAt({ id: "x", plant: "p3" } as never, "plant", "p2")).toBe(false);
  });
});

describe("aggregate rows that lead somewhere", () => {
  it("opens the row's record and runs its action", async () => {
    watered.length = 0;
    const runtime = await runtimeFor(garden);
    const fern = await runtime.ctx.create("plant", { name: "Fern" });
    const p = props(runtime, "due");
    render(<AggregateView {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fern" }));
    expect(p.navigate).toHaveBeenCalledWith("plant", { id: fern.id });
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    await waitFor(() => expect(watered).toEqual(["Fern"]));
  });
});

describe("a record's own glyph", () => {
  it("leads its row (display.icon, a function)", async () => {
    const runtime = await runtimeFor(garden);
    await runtime.ctx.create("plant", { name: "Saguaro", kind: "cactus" });
    render(<ListView {...props(runtime, "plants")} />);
    await waitFor(() => expect(document.querySelector(".k-list-row .k-lead")?.textContent).toBe("🌵"));
  });
});

describe("the checklist's add box", () => {
  const list = (quickAdd: unknown): AppInput => ({
    id: "shop",
    name: "Shop",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      item: {
        displayField: "name",
        fields: { name: { type: "text" }, aisle: { type: "enum", options: ["produce", "dairy", "pantry"] }, bought: { type: "boolean", default: false } },
      },
    },
    pages: [{ id: "list", title: "List", view: { type: "checklist", entity: "item", done: "bought", text: "name", group: "aisle", quickAdd, icon: (r) => (r.aisle === "dairy" ? "🥛" : "") } as never }],
  });

  it("brings back a bought item typed again word for word", async () => {
    const runtime = await runtimeFor(list(true));
    const eggs = await runtime.ctx.create("item", { name: "Eggs", aisle: "dairy", bought: true });
    render(<ChecklistView {...props(runtime, "list")} />);
    const box = await screen.findByRole("textbox", { name: "Add an item" });
    fireEvent.change(box, { target: { value: "eggs " } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(async () => expect((await runtime.ctx.get("item", eggs.id))?.bought).toBe(false));
    expect((await runtime.ctx.query("item")).length).toBe(1);
  });

  it("offers earlier items as you type, and one already bought comes back rather than twice", async () => {
    const runtime = await runtimeFor(list({ suggest: true }));
    const milk = await runtime.ctx.create("item", { name: "Milk", aisle: "dairy", bought: true });
    render(<ChecklistView {...props(runtime, "list")} />);
    await waitFor(() => expect(document.querySelector(".k-check-icon")?.textContent).toBe("🥛"));
    fireEvent.change(screen.getByRole("textbox", { name: "Add an item" }), { target: { value: "mi" } });
    fireEvent.click(await screen.findByRole("button", { name: /Milk/ }));
    await waitFor(async () => expect((await runtime.ctx.get("item", milk.id))?.bought).toBe(false));
    expect((await runtime.ctx.query("item")).length).toBe(1);
  });

  it("copies what the last one like it had (`remember`), and asks the app for the rest (`defaults`)", async () => {
    const runtime = await runtimeFor(list({ remember: ["aisle"], defaults: (text: string) => (/oat/i.test(text) ? { aisle: "pantry" } : {}) }));
    await runtime.ctx.create("item", { name: "Yoghurt", aisle: "dairy", bought: false });
    render(<ChecklistView {...props(runtime, "list")} />);
    const box = await screen.findByRole("textbox", { name: "Add an item" });
    fireEvent.change(box, { target: { value: "Oats" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(async () => expect((await runtime.ctx.query("item")).find((r) => r.name === "Oats")?.aisle).toBe("pantry"));
    // The same words as an item already on the list: a second one, in its aisle, though the app
    // would not have guessed it.
    const again = await screen.findByRole("textbox", { name: "Add an item" });
    fireEvent.change(again, { target: { value: "Yoghurt" } });
    fireEvent.submit(again.closest("form")!);
    await waitFor(async () => expect((await runtime.ctx.query("item")).filter((r) => r.name === "Yoghurt").map((r) => r.aisle)).toEqual(["dairy", "dairy"]));
  });
});
