// @vitest-environment happy-dom
//
// Entity groups drive the form (#100): titled sections in the declared order, editable fields
// only, the ungrouped rest after them; `help` under the control, `placeholder` in it, `width`
// on the row; and a required field left empty is told so under the field, marked invalid and
// focused — not listed in a summary line at the top.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { RecordForm } from "../src/record-form.js";
import { resolveGroups } from "../src/groups.js";

const app = defineApp({
  id: "groups-fixture",
  name: "Groups Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    recipe: {
      label: "Recipe",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Shakshuka" },
        servings: { type: "number", integer: true, min: 1, help: "The per-serving figures divide by this", width: "half" },
        prepMinutes: { type: "number", unit: "min", width: "half" },
        notes: { type: "text", multiline: true },
        secret: { type: "text", hidden: true },
        rating: { type: "number", min: 0, max: 5 },
      },
      computed: { calories: () => 420 },
      groups: [
        { title: "Overview", fields: ["name", "servings", "prepMinutes"] },
        { title: "Nutrition", fields: ["calories"] },
        { title: "Notes", fields: ["notes", "secret"], collapsed: true },
      ],
    },
  },
  pages: [{ id: "all", title: "Recipes", view: { type: "list", entity: "recipe" } }],
});

async function makeRuntime(): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open("groups-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

afterEach(cleanup);

describe("resolveGroups", () => {
  it("gives the form the editable fields of each group and the rest after, and the detail the computed too", () => {
    const entity = app.entities.recipe;
    expect(resolveGroups(entity, "form")).toEqual([
      { title: "Overview", fields: ["name", "servings", "prepMinutes"], collapsed: false },
      { title: "Notes", fields: ["notes"], collapsed: true },
      { fields: ["rating"], collapsed: false },
    ]);
    expect(resolveGroups(entity, "detail").map((g) => g.fields)).toEqual([
      ["name", "servings", "prepMinutes"],
      ["calories"],
      ["notes"],
      ["rating"],
    ]);
  });

  it("never folds the first group, and gives an ungrouped entity one untitled group", () => {
    expect(resolveGroups({ fields: { a: { type: "text" } }, groups: [{ fields: ["a"], collapsed: true }] }, "form")[0]!.collapsed).toBe(false);
    expect(resolveGroups({ fields: { a: { type: "text" }, b: { type: "text" } } }, "form")).toEqual([{ fields: ["a", "b"], collapsed: false }]);
  });
});

describe("RecordForm", () => {
  it("renders the groups as titled sections with help, placeholder and width", async () => {
    const runtime = await makeRuntime();
    render(<RecordForm runtime={runtime} entity="recipe" onDone={() => {}} onCancel={() => {}} />);
    const titles = await screen.findAllByRole("heading", { level: 4 });
    expect(titles.map((h) => h.textContent)).toEqual(["Overview"]);
    // The folded group is a disclosure, closed until opened.
    const notes = screen.getByText("Notes", { selector: "summary" }).closest("details")!;
    expect(notes.open).toBe(false);
    expect(screen.queryByRole("heading", { name: "Nutrition" })).toBeNull(); // computed only — nothing to edit
    const name = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(name.placeholder).toBe("Shakshuka");
    const servings = screen.getByRole("spinbutton", { name: "Servings" });
    expect(screen.getByText("The per-serving figures divide by this").id).toBe(servings.getAttribute("aria-describedby"));
    expect(servings.closest(".k-form-field")!.getAttribute("data-width")).toBe("half");
    expect(name.closest(".k-form-field")!.getAttribute("data-width")).toBe("full");
    // The ungrouped field is still on the form, after the groups.
    expect(screen.getByRole("spinbutton", { name: "Rating" })).toBeTruthy();
  });

  it("tells a required field it is missing under the field, marks it invalid and focuses it", async () => {
    const runtime = await makeRuntime();
    const onDone = vi.fn();
    render(<RecordForm runtime={runtime} entity="recipe" onDone={onDone} onCancel={() => {}} />);
    const name = (await screen.findByRole("textbox", { name: "Name" })) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByText("Required");
    expect(name.getAttribute("aria-describedby")).toBe(message.id);
    expect(document.activeElement).toBe(name);
    expect(screen.queryByText(/^Required:/)).toBeNull(); // no summary line
    // Typing answers the complaint; the next submit goes through.
    fireEvent.change(name, { target: { value: "Shakshuka" } });
    expect(name.getAttribute("aria-invalid")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
