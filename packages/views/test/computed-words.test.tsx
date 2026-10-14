// @vitest-environment happy-dom
// A computed's VALUE reads in the person's language too: one that returns a few keys reads as its
// `labels` (as an enum's options do), and one that returns an object reads through its `format`, on
// a detail row, a table cell, a badge and a group heading. Without either it reads as before.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { DetailView, ListView, TableView } from "../src/builtins.js";
import { shownValue } from "../src/format.js";

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
      fields: { name: { type: "text" }, vegan: { type: "boolean" }, kg: { type: "number" } },
      computed: {
        diet: {
          label: { en: "Diet", pl: "Dieta" },
          labels: { vegan: { en: "vegan", pl: "wegańska" }, other: { en: "other", pl: "inna" } },
          value: (r) => (r.vegan ? "vegan" : "other"),
        },
        best: {
          label: { en: "Best", pl: "Rekord" },
          format: { en: "{kg, plural, =0 {{reps} reps} other {{kg} kg × {reps}}}", pl: "{kg, plural, =0 {{reps} powt.} other {{kg} kg × {reps} powt.}}" },
          value: (r) => ({ kg: Number(r.kg), reps: 8 }),
        },
        broken: { format: "{missing} left", value: () => ({ other: 1 }) },
        raw: (r) => (r.vegan ? "vegan" : "other"),
      },
    },
  },
  pages: [
    { id: "table", title: "Table", view: { type: "table", entity: "dish", display: { columns: ["name", "diet", "best"] } } },
    { id: "list", title: "List", view: { type: "list", entity: "dish", display: { primary: "name", badges: ["diet"] }, group: "diet" } },
    { id: "dish", title: "Dish", view: { type: "detail", entity: "dish", param: "id", sections: [{ title: "About", fields: ["diet", "best", "broken", "raw"] }] } },
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
  const rec = await runtime.ctx.create("dish", { name: "Soup", vegan: true, kg: 80 });
  return { runtime, id: String(rec.id) };
}

afterEach(cleanup);

describe("a computed's value in words", () => {
  it("a detail row reads the value's label and the object's format, in the person's language", async () => {
    const { runtime, id } = await makeRuntime(["pl"]);
    render(<DetailView runtime={runtime} pageId="dish" params={{ id }} setParam={() => {}} navigate={() => {}} />);
    expect(await screen.findByText("wegańska")).toBeTruthy();
    expect(screen.getByText("80 kg × 8 powt.")).toBeTruthy();
    expect(screen.getByText("vegan")).toBeTruthy(); // `raw` has no labels: its value, as before
  });

  it("a table cell does the same", async () => {
    const { runtime } = await makeRuntime(["en"]);
    render(<TableView runtime={runtime} pageId="table" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Soup");
    const cells = [...document.querySelectorAll("td")].map((e) => e.textContent);
    expect(cells).toEqual(["Soup", "vegan", "80 kg × 8"]);
  });

  it("a badge and a group heading read the label", async () => {
    const { runtime } = await makeRuntime(["pl"]);
    render(<ListView runtime={runtime} pageId="list" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Soup");
    expect(screen.getAllByText("wegańska").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("vegan")).toBeNull();
  });

  it("an object with no format, or one its format cannot say, reads as before", async () => {
    const { runtime } = await makeRuntime(["en"]);
    expect(shownValue(runtime, "dish", "broken", { other: 1 })).toEqual({ other: 1 });
    expect(shownValue(runtime, "dish", "best", { kg: 0, reps: 12 })).toBe("12 reps");
    expect(shownValue(runtime, "dish", "best", null)).toBeNull();
    expect(shownValue(runtime, "dish", "raw", "vegan")).toBe("vegan");
  });
});
