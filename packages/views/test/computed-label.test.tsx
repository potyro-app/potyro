// @vitest-environment happy-dom
// A computed value shown on a page is headed by its own label, in the person's language (#310): a
// detail section's row, a table's column. A computed without one still reads as its key, humanised.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { DetailView, TableView } from "../src/builtins.js";
import { fieldLabel } from "../src/format.js";

const app: PotyroApp = defineApp({
  id: "dishes",
  name: { en: "Dishes", pl: "Dania" },
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pl"],
  entities: {
    dish: {
      displayField: "name",
      fields: { name: { type: "text" }, kcal: { type: "number" }, servings: { type: "number" } },
      computed: {
        caloriesPerServing: { label: { en: "Calories per serving", pl: "Kalorie na porcję" }, value: (r) => Number(r.kcal) / Number(r.servings) },
        doubleKcal: (r) => Number(r.kcal) * 2,
      },
    },
  },
  pages: [
    { id: "table", title: "Table", view: { type: "table", entity: "dish", display: { columns: ["name", "caloriesPerServing", "doubleKcal"] } } },
    { id: "dish", title: "Dish", view: { type: "detail", entity: "dish", param: "id", sections: [{ title: "Nutrition", fields: ["caloriesPerServing", "doubleKcal"] }] } },
  ],
});

async function makeRuntime(languages: string[]): Promise<{ runtime: PotyroRuntime; id: string }> {
  const store = new MemoryStore();
  await store.open(app.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav, languages });
  const rec = await runtime.ctx.create("dish", { name: "Soup", kcal: 900, servings: 3 });
  return { runtime, id: String(rec.id) };
}

afterEach(cleanup);

describe("computed labels", () => {
  it("a detail section heads a computed with its label in the person's language", async () => {
    const { runtime, id } = await makeRuntime(["pl-PL"]);
    render(<DetailView runtime={runtime} pageId="dish" params={{ id }} setParam={() => {}} navigate={() => {}} />);
    expect(await screen.findByText("Kalorie na porcję")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("Double Kcal")).toBeTruthy(); // no label: the key, humanised
    expect(screen.queryByText("Calories Per Serving")).toBeNull();
  });

  it("a table's column says the label too", async () => {
    const { runtime } = await makeRuntime(["pl"]);
    render(<TableView runtime={runtime} pageId="table" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Soup");
    const heads = [...document.querySelectorAll("th")].map((e) => e.textContent);
    expect(heads).toEqual(["Name", "Kalorie na porcję", "Double Kcal"]);
  });

  it("in English it is the English label", async () => {
    const { runtime } = await makeRuntime(["en"]);
    expect(fieldLabel(runtime, "dish", "caloriesPerServing")).toBe("Calories per serving");
  });
});
