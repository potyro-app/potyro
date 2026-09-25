// Declared action input (#213): `{ run, input }`. Whoever runs it — a button, Ask — the values are
// checked against the fields before `run` sees them, and a button that brings no values gets a form
// of those fields. The form's title and button are the action's label.

import { beforeEach, describe, expect, it } from "vitest";
import { defineApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "../src/index.js";

const app = defineApp({
  id: "plants",
  name: "Plants",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      displayField: "name",
      fields: { name: { type: "text" }, fed: { type: "number" } },
      actions: {
        feed: {
          label: "Feed",
          input: { grams: { type: "number", min: 0, required: true } },
          run: async (p, ctx, input) => {
            await ctx.patch("plant", p.id, { fed: (input as { grams: number }).grams });
          },
        },
      },
    },
  },
  pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant", rowActions: ["feed"] } }],
});

let runtime: KartaRuntime;
let store: MemoryStore;
let id: string;
let forms: Array<{ title: string; submit?: string; fields: Record<string, unknown> }>;
let answer: Record<string, unknown> | null;
let toasts: string[];

beforeEach(async () => {
  store = new MemoryStore();
  await store.open("plants");
  forms = [];
  toasts = [];
  answer = { grams: 20 };
  const ui: UiBridge = {
    toast: (m) => void toasts.push(m),
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
    form: async (o) => (forms.push(o), answer),
  };
  id = (await store.insert("plant", { name: "Monstera" })).id;
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
});

describe("declared action input", () => {
  it("runs with values that fit", async () => {
    await runtime.core.runAction("plant", "feed", id, { grams: 15 });
    expect((await store.get("plant", id))!.fed).toBe(15);
    expect(forms).toEqual([]);
  });

  it("refuses values that do not fit, before run sees them", async () => {
    await expect(runtime.core.runAction("plant", "feed", id, { grams: -3 })).rejects.toThrow(/at least 0/);
    await expect(runtime.core.runAction("plant", "feed", id, {})).rejects.toThrow(/required/i);
    await expect(runtime.core.runAction("plant", "feed", id, { grams: 1, extra: true })).rejects.toThrow(/extra/);
    expect((await store.get("plant", id))!.fed).toBeUndefined();
  });

  it("asks with a form of its fields when a button brings no values; cancelling runs nothing", async () => {
    await runtime.runAction("plant", "feed", id);
    expect(forms[0]).toMatchObject({ title: "Feed", submit: "Feed", fields: { grams: { type: "number" } } });
    expect((await store.get("plant", id))!.fed).toBe(20);
    answer = null;
    await runtime.runAction("plant", "feed", id);
    expect((await store.get("plant", id))!.fed).toBe(20);
  });
});
