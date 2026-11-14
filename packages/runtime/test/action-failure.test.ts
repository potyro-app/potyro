// What a person is told when an action fails (#76).
//
// The toast used to be the thrown error's message, whatever it was: the validator's English, an
// engine's "x is undefined", and — out of a sealed box — a prefix naming the box. Now the failure
// is sorted first: a refused write names the field by the app's label, the app's own words stay
// its words, anything else is one plain sentence. The developer's line still reaches the console
// and whoever listens to the app's failures.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type ActionFailure, type AppFailure } from "@potyro/host";
import { ACTION_BROKE, createRuntime, type RuntimeDeps } from "../src/index.js";

const app = defineApp({
  id: "cellar",
  name: "Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    wine: {
      label: "Wine",
      displayField: "name",
      fields: {
        name: { type: "text" },
        grape: { type: "enum", label: "Grape", options: ["malbec", "merlot"] },
      },
      actions: {
        identify: async (r: { id: string }, ctx: { patch(e: string, id: string, d: unknown): Promise<unknown> }) => {
          await ctx.patch("wine", r.id, { grape: "Cabernet Sauvignon" });
        },
        refuse: () => {
          throw new Error("Pick a bottle first");
        },
        bug: (r: { cellar: { shelf: number } }) => r.cellar.shelf,
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "All",
      view: { type: "list", entity: "wine" },
      actions: [
        {
          label: "Add",
          run: async (ctx: { create(e: string, d: unknown): Promise<unknown> }) => {
            await ctx.create("wine", { grape: "Pinot" });
          },
        },
      ],
    },
  ],
} as never);

async function harness(failureWords?: RuntimeDeps["failureWords"]) {
  const store = new MemoryStore();
  await store.open("cellar");
  const row = await store.insert("wine", { name: "Bottle" });
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const toasts: string[] = [];
  const ui = { toast: (t: string) => void toasts.push(t), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, failureWords });
  const heard: AppFailure[] = [];
  runtime.onFailure((f) => heard.push(f));
  return { runtime, toasts, heard, id: String(row.id) };
}

afterEach(() => vi.restoreAllMocks());

describe("a failed action, said to the person", () => {
  it("a refused write names the field by the app's label; the detail goes to the console and the listeners", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, heard, id } = await harness();
    await runtime.runAction("wine", "identify", id);
    expect(toasts).toEqual(["Grape must be one of: malbec, merlot."]);
    expect(heard).toEqual([{ app: "cellar", what: "action wine.identify", message: "FieldValueError: Grape must be one of: malbec, merlot.", shown: "Grape must be one of: malbec, merlot." }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("[potyro] action wine.identify failed:");
    expect(warn.mock.calls[0]![1]).toBeInstanceOf(Error);
  });

  it("the app's own words are the toast", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, id } = await harness();
    await runtime.runAction("wine", "refuse", id);
    expect(toasts).toEqual(["Pick a bottle first"]);
  });

  it("a bug is one plain sentence: the engine's line is for the console and the listeners only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, heard, id } = await harness();
    await runtime.runAction("wine", "bug", id);
    expect(toasts).toEqual([ACTION_BROKE]);
    expect(toasts[0]).not.toMatch(/TypeError|undefined|shelf/);
    expect(heard[0]!.message).toMatch(/^TypeError: .*shelf/);
    expect(heard[0]!.shown).toBe(ACTION_BROKE);
    expect(warn.mock.calls[0]![1]).toBeInstanceOf(TypeError);
  });

  it("a page's button is told the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, heard } = await harness();
    await runtime.runPageAction("all", 0);
    expect(toasts).toEqual(["Grape must be one of: malbec, merlot."]);
    expect(heard[0]!.what).toBe("page action all[0]");
  });

  it("whoever composes the runtime supplies the words, and gets the failure as data with the app's definition", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const got: ActionFailure[] = [];
    const { runtime, toasts, heard, id } = await harness((failure, definition) => {
      got.push(failure);
      return failure.kind === "refused" ? `«${String(definition.entities[failure.refusal.entity]!.fields![failure.refusal.field]!.label)}»` : "?";
    });
    await runtime.runAction("wine", "identify", id);
    expect(got[0]).toMatchObject({ kind: "refused", refusal: { entity: "wine", field: "grape", issue: { rule: "options", options: ["malbec", "merlot"] } } });
    expect(toasts).toEqual(["«Grape»"]);
    expect(heard[0]!.shown).toBe("«Grape»");
  });

  it("words that fail to be made do not hide the failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, id } = await harness(() => {
      throw new Error("catalog missing");
    });
    await runtime.runAction("wine", "identify", id);
    expect(toasts).toEqual([ACTION_BROKE]);
  });
});
