// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defineApp, type KartaApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { BoardView } from "../src/board.js";

// Records in columns by an enum field (#107): columns in the enum's order with counts, a card in its
// column, "Move to…" patching the field, an empty column offering Add pre-filled, and read-only when
// the board says so.

const app = (board: Record<string, unknown> = {}): KartaApp =>
  defineApp({
    id: "board-fixture",
    name: "Board",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      task: {
        label: "Task",
        displayField: "title",
        fields: {
          title: { type: "text", required: true },
          status: { type: "enum", options: ["todo", "doing", "done"], colors: { done: "green" } },
        },
      },
    },
    pages: [{ id: "board", title: "Board", view: { type: "board", entity: "task", column: "status", display: { primary: "title" }, ...board } }],
  } as never);

async function makeRuntime(def: KartaApp): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open(def.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: def });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  for (const [title, status] of [["Write tests", "todo"], ["Ship it", "doing"], ["Plan", "todo"], ["Loose end", ""]] as const) {
    await runtime.ctx.create("task", status ? { title, status } : { title });
  }
  return runtime;
}

const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}, \\d+$`) });

afterEach(cleanup);

describe("the board", () => {
  it("lays out the enum's options as columns with counts, and a card sits in its column", async () => {
    const runtime = await makeRuntime(app());
    render(<BoardView runtime={runtime} pageId="board" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Write tests");
    const titles = [...document.querySelectorAll(".k-board-col-title")].map((e) => e.textContent);
    // A row with no status gets a leading column of its own rather than vanishing.
    expect(titles).toEqual(["No status", "todo", "doing", "done"]);
    expect(within(column("todo")).getByText("Write tests")).toBeTruthy();
    expect(within(column("todo")).getByText("Plan")).toBeTruthy();
    expect(column("todo").querySelector(".k-board-count")?.textContent).toBe("2");
    expect(within(column("No status")).getByText("Loose end")).toBeTruthy();
  });

  it("Move to… in a card's menu patches the field, and the card changes column", async () => {
    const runtime = await makeRuntime(app());
    render(<BoardView runtime={runtime} pageId="board" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Ship it");
    fireEvent.click(screen.getByRole("button", { name: "Ship it: more" }));
    // Every other column, and not the one it is in.
    expect(screen.queryByRole("menuitem", { name: /Move to doing/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Move to done/ }));
    await waitFor(() => expect(within(column("done")).queryByText("Ship it")).toBeTruthy());
    const rows = await runtime.ctx.query("task");
    expect(rows.find((r) => r.title === "Ship it")?.status).toBe("done");
  });

  it("an empty column says so and offers Add, pre-filled with that column", async () => {
    const runtime = await makeRuntime(app());
    const onCreate = vi.fn();
    render(<BoardView runtime={runtime} pageId="board" params={{}} setParam={() => {}} navigate={() => {}} onCreate={onCreate} />);
    await screen.findByText("Write tests");
    const done = column("done");
    expect(within(done).getByText("Nothing here")).toBeTruthy();
    fireEvent.click(within(done).getByRole("button", { name: /Add/ }));
    expect(onCreate).toHaveBeenCalledWith("task", { status: "done" });
  });

  it("a subset of columns, in its own order; read-only offers no moves", async () => {
    const runtime = await makeRuntime(app({ columns: ["doing", "todo"], allowMove: false, onOpen: { page: "board" } }));
    render(<BoardView runtime={runtime} pageId="board" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Write tests");
    const titles = [...document.querySelectorAll(".k-board-col-title")].map((e) => e.textContent);
    expect(titles).toEqual(["No status", "doing", "todo"]);
    fireEvent.click(screen.getByRole("button", { name: "Ship it: more" }));
    expect(screen.queryByRole("menuitem", { name: /Move to/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
  });
});
