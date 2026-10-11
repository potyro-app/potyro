// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { defineApp } from "potyro";
import type { MemberField, Space } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldInput, FieldValue } from "../src/index.js";

// The person picker and the person chip (KA-19, #60). The candidates are the people in the space —
// never rows an app keeps — and a solo app offers just you, so a `member` field works before the app
// is ever shared.

afterEach(cleanup);

const app = defineApp({
  id: "ledger",
  name: "Ledger",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    expense: {
      label: "Expense",
      displayField: "description",
      fields: { description: { type: "text" }, paidBy: { type: "member" }, splitAmong: { type: "member", many: true } },
    },
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "expense", display: { primary: "description" } } }],
});

const ana = { id: "co_zAna", name: "Ana" };
const space: Space = {
  id: "co_zSpace",
  role: "admin",
  members: [
    { ...ana, role: "admin" },
    { id: "co_zBo", name: "Bo", role: "writer" },
    { id: "co_zCarla", name: "Carla", role: "reader" },
  ],
  invite: async () => "",
};

async function makeRuntime(shared: boolean): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("ledger");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav, me: ana, ...(shared ? { space } : {}) });
}

const one: MemberField = { type: "member", label: "Paid by" };
const many: MemberField = { type: "member", many: true, label: "Split among" };

describe("picking one person", () => {
  it("offers everyone in the space and hands back the id", async () => {
    const runtime = await makeRuntime(true);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={one} value={null} onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["—", "Ana", "Bo", "Carla"]);
    fireEvent.change(select, { target: { value: "co_zBo" } });
    expect(onChange).toHaveBeenLastCalledWith("co_zBo");
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("offers just you in an app nobody else uses", async () => {
    const runtime = await makeRuntime(false);
    render(<FieldInput runtime={runtime} field={one} value={null} onChange={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["—", "Ana"]);
  });
});

describe("picking several people", () => {
  it("shows a chip per person, pressed when chosen, and toggles by id", async () => {
    const runtime = await makeRuntime(true);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={many} value={["co_zAna"]} onChange={onChange} />);
    const group = screen.getByRole("group");
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => [c.textContent, c.getAttribute("aria-pressed")])).toEqual([
      ["Ana", "true"],
      ["Bo", "false"],
      ["Carla", "false"],
    ]);
    fireEvent.click(within(group).getByRole("button", { name: "Bo" }));
    expect(onChange).toHaveBeenLastCalledWith(["co_zAna", "co_zBo"]);
    fireEvent.click(within(group).getByRole("button", { name: "Ana" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("showing people", () => {
  it("renders a chip per person by name, and someone who has left as Unknown", async () => {
    const runtime = await makeRuntime(true);
    render(
      <FieldValue
        runtime={runtime}
        entity="expense"
        fieldKey="splitAmong"
        value={[{ id: "co_zAna", name: "Ana" }, { id: "co_zGone", name: "Unknown" }]}
      />,
    );
    const chips = document.querySelectorAll(".k-person-chip");
    expect([...chips].map((c) => c.textContent)).toEqual(["Ana", "Unknown"]);
  });

  it("round-trips through the runtime: an id stored, a person shown", async () => {
    const runtime = await makeRuntime(true);
    const made = await runtime.ctx.create("expense", { description: "Dinner", paidBy: "co_zBo" });
    render(<FieldValue runtime={runtime} entity="expense" fieldKey="paidBy" value={made.paidBy} />);
    expect(document.querySelector(".k-person-chip")?.textContent).toBe("Bo");
  });
});
