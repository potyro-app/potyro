// The Data panel reads an app's fields from its source without running it, and builds a runtime from
// nothing but those. These pin that the literal read is faithful, that code is never evaluated, and
// that one unreadable field costs that field — not the whole app.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost } from "@potyro/host";
import { createRuntime } from "@potyro/runtime";
import { declaredEntities } from "../src/app-source.js";
import { dataDefinition } from "../src/data-runtime.js";

const read = (name: string): string => readFileSync(resolve(process.cwd(), "../../examples", name), "utf8");

describe("declaredEntities", () => {
  it("reads every example's fields with their types, in declared order", async () => {
    const groceries = (await declaredEntities(read("groceries.app.ts")))!;
    expect(Object.keys(groceries)).toEqual(["list", "aisle", "item"]);
    expect(Object.keys(groceries.item!.fields)).toEqual(["name", "aisle", "list", "quantity", "for", "bought", "position", "note", "onList", "timesBought", "lastBought"]);
    expect(groceries.item!.fields.aisle).toEqual({ type: "relation", to: "aisle", label: "Aisle" });
    expect(groceries.item!.displayField).toBe("name");
    for (const file of ["recipes.app.tsx", "places.app.ts", "plants.app.ts", "split.app.ts", "workout.app.tsx"]) {
      const entities = (await declaredEntities(read(file)))!;
      expect(Object.keys(entities).length, file).toBeGreaterThan(0);
    }
  });

  it("drops what would have to run, and never runs it", async () => {
    const source = `
      import { defineApp } from "potyro";
      globalThis.__ran = true;
      const SIZES = ["s", "m"];
      export default defineApp({
        id: "t", name: "T", version: "1.0.0", schemaVersion: 1, pages: [],
        entities: {
          thing: {
            fields: {
              name: { type: "text", default: () => { globalThis.__ran = true; return "x"; } },
              size: { type: "enum", options: SIZES },
              made: helper(),
              price: { type: "money", currency: "EUR", min: -5 },
            },
          },
        },
      });`;
    const entities = (await declaredEntities(source))!;
    expect(entities.thing!.fields.name).toEqual({ type: "text" });
    expect(entities.thing!.fields.size).toEqual({ type: "enum" });
    expect(entities.thing!.fields.price).toEqual({ type: "money", currency: "EUR", min: -5 });
    expect(entities.thing!.opaque).toEqual(["made"]);
    expect((globalThis as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it("answers null for a module it cannot read", async () => {
    expect(await declaredEntities("this is not typescript (")).toBeNull();
    expect(await declaredEntities("export default makeApp();")).toBeNull();
  });
});

describe("dataDefinition", () => {
  it("keeps valid fields and sets aside only the one the schema refuses", () => {
    const { app, rejected } = dataDefinition("t", {
      thing: {
        displayField: "name",
        fields: { name: { type: "text" }, size: { type: "enum" }, n: { type: "number" } },
        opaque: [],
      },
    });
    expect(Object.keys(app.entities.thing!.fields)).toEqual(["name", "n"]);
    expect(rejected).toEqual({ thing: ["size"] });
    expect(app.entities.thing!.displayField).toBe("name");
  });

  it("builds a runtime that reads and edits the app's real records", async () => {
    const declared = (await declaredEntities(read("groceries.app.ts")))!;
    const { app } = dataDefinition("groceries", declared);
    const store = new MemoryStore();
    await store.open("user:groceries");
    const aisle = await store.insert("aisle", { name: "Dairy", order: 1 });
    const item = await store.insert("item", { name: "Milk", aisle: aisle.id, bought: false });

    const host = createHost();
    const loaded = await host.load({ kind: "module", app, provenance: "trusted" });
    const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });

    const rows = await runtime.ctx.query("item");
    expect(rows[0]!.name).toBe("Milk");
    expect((rows[0]!.aisle as { name: string }).name).toBe("Dairy");

    await runtime.patch("item", item.id, { bought: true });
    expect((await store.get("item", item.id))!.bought).toBe(true);
    await runtime.remove("item", item.id);
    expect(await store.all("item")).toHaveLength(0);
  });

  it("keeps a translated app's fields, in the person's language (#302)", async () => {
    const source = `import { defineApp } from "potyro";
export default defineApp({ id: "t", name: { en: "Tasks", pl: "Zadania" }, language: "en", languages: ["en", "pl"], version: "1.0.0", schemaVersion: 1, pages: [],
  entities: { task: { label: { en: "Task", pl: "Zadanie" }, fields: {
    title: { type: "text", label: { en: "Title", pl: "Tytuł" } },
    status: { type: "enum", options: ["todo", "done"], labels: { todo: { en: "To do", pl: "Do zrobienia" }, done: "Done" } } } } } });`;
    const declared = (await declaredEntities(source))!;
    const { app, rejected } = dataDefinition("t", declared, { language: "en", languages: ["en", "pl"], shownIn: "pl" });
    expect(rejected).toEqual({});
    expect(app.entities.task!.label).toBe("Zadanie");
    expect(app.entities.task!.fields.title!.label).toBe("Tytuł");
    expect(app.entities.task!.fields.status).toMatchObject({ options: ["todo", "done"], labels: { todo: "Do zrobienia", done: "Done" } });
  });
});
