// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import type { RelationField } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldInput } from "../src/index.js";

// A field pointing at other records: a searchable picker instead of a browser <select>, chips you
// can take off for several, and a way to make the record the search did not find.

const app = defineApp({
  id: "relation-fixture",
  name: "Relation Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    ingredient: { label: "Ingredient", displayField: "name", fields: { name: { type: "text", required: true } } },
    recipe: {
      label: "Recipe",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        main: { type: "relation", to: "ingredient" },
        extras: { type: "relation", to: "ingredient", many: true },
      },
    },
  },
  pages: [{ id: "list", title: "Recipes", view: { type: "list", entity: "recipe", display: { primary: "title" } } }],
});

async function makeRuntime(seed: string[] = []): Promise<{ runtime: PotyroRuntime; ids: Record<string, string> }> {
  const store = new MemoryStore();
  await store.open("relation-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  const ids: Record<string, string> = {};
  for (const name of seed) ids[name] = (await runtime.ctx.create("ingredient", { name })).id;
  return { runtime, ids };
}

const one: RelationField = { type: "relation", to: "ingredient" };
const many: RelationField = { type: "relation", to: "ingredient", many: true };

afterEach(cleanup);

describe("one related record", () => {
  it("is a picker, not a select: search narrows it, and a pick closes it", async () => {
    const { runtime, ids } = await makeRuntime(["Chicken breast", "Chickpeas", "Butter"]);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={one} value={null} onChange={onChange} label="Main" />);
    const trigger = await screen.findByRole("button", { name: "Main: choose" });
    expect(document.querySelector("select")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Main" }), { target: { value: "chi" } });
    const labels = [...document.querySelectorAll(".k-enum-option-label")].map((e) => e.textContent);
    expect(labels).toEqual(["Chicken breast", "Chickpeas"]);
    fireEvent.click(screen.getByRole("option", { name: "Chickpeas" }));
    expect(onChange).toHaveBeenCalledWith(ids["Chickpeas"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the chosen record on the trigger", async () => {
    const { runtime, ids } = await makeRuntime(["Butter"]);
    render(<FieldInput runtime={runtime} field={one} value={ids["Butter"]} onChange={() => {}} label="Main" />);
    expect(await screen.findByRole("button", { name: "Main: Butter" })).toBeTruthy();
  });

  it("offers to make what the search did not find, named with what was typed, and selects it", async () => {
    const { runtime } = await makeRuntime(["Butter"]);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={one} value={null} onChange={onChange} label="Main" />);
    fireEvent.click(await screen.findByRole("button", { name: "Main: choose" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Main" }), { target: { value: "Saffron" } });
    fireEvent.click(screen.getByRole("button", { name: /New ingredient “Saffron”/ }));

    // A second sheet, starting with the name already in it.
    const name = (await screen.findByRole("textbox", { name: /Name/ })) as HTMLInputElement;
    expect(name.value).toBe("Saffron");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const created = await runtime.ctx.get("ingredient", onChange.mock.calls[0]![0] as string);
    expect(created?.name).toBe("Saffron");
  });

  it("an empty table says so on the trigger, and the list still offers to make one", async () => {
    const { runtime } = await makeRuntime([]);
    render(<FieldInput runtime={runtime} field={one} value={null} onChange={() => {}} label="Main" />);
    const trigger = await screen.findByRole("button", { name: "Main: choose" });
    expect(trigger.textContent).toContain("No ingredient yet");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: /New ingredient/ })).toBeTruthy();
  });
});

describe("several related records", () => {
  it("shows the chosen ones as chips, not every record, and a chip takes itself off", async () => {
    const { runtime, ids } = await makeRuntime(["Butter", "Egg", "Flour", "Garlic"]);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={many} value={[ids["Egg"], ids["Flour"]]} onChange={onChange} label="Extras" />);
    await screen.findByRole("button", { name: "Extras: add" });
    expect([...document.querySelectorAll(".k-selchip")].map((e) => e.firstChild?.textContent)).toEqual(["Egg", "Flour"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Egg" }));
    expect(onChange).toHaveBeenCalledWith([ids["Flour"]]);
  });

  it("Add opens a list that toggles and stays open until Done", async () => {
    const { runtime, ids } = await makeRuntime(["Butter", "Egg"]);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={many} value={[]} onChange={onChange} label="Extras" />);
    fireEvent.click(await screen.findByRole("button", { name: "Extras: add" }));
    fireEvent.click(screen.getByRole("option", { name: "Butter" }));
    expect(onChange).toHaveBeenLastCalledWith([ids["Butter"]]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
