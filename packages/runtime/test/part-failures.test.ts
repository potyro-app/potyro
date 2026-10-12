// Every contained failure of an app's code reaches whoever shows that part (#271): a computed value,
// a page's filter, an action and a page button, each named in the app's own terms, for this app only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { activeFailureListeners, createHost, reportAppFailure, type AppFailure } from "@potyro/host";
import { createRuntime, watchPageQuery, type QueryState } from "../src/index.js";

const app = defineApp({
  id: "parts",
  name: "Parts",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      displayField: "name",
      fields: { name: { type: "text" } },
      computed: {
        month: () => {
          throw new ReferenceError("'Intl' is not defined");
        },
      },
      actions: {
        share: () => {
          throw new Error("no way out");
        },
      },
    },
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "item" } },
    {
      id: "picky",
      title: "Picky",
      view: {
        type: "list",
        entity: "item",
        filter: () => {
          throw new TypeError("cannot read property 'Collator' of undefined");
        },
      },
      actions: [
        {
          label: "Go",
          run: () => {
            throw new Error("not this button");
          },
        },
      ],
    },
  ],
} as never);

async function harness() {
  const store = new MemoryStore();
  await store.open("parts");
  await store.insert("item", { name: "one" });
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const toasts: string[] = [];
  const ui = { toast: (t: string) => void toasts.push(t), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
  return { store, runtime, toasts };
}

afterEach(() => vi.restoreAllMocks());

describe("an app's failures, by part", () => {
  it("a computed, a filter, an action and a page button are each heard, named in the app's terms", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { runtime, toasts } = await harness();
    const heard: AppFailure[] = [];
    const stop = runtime.onFailure((f) => heard.push(f));

    await runtime.queryPage("all");
    const state = await new Promise<QueryState>((resolve) => {
      const off = watchPageQuery(runtime.core, "picky", {}, (s) => {
        off();
        resolve(s);
      });
    });
    const [item] = await runtime.ctx.query("item");
    await runtime.runAction("item", "share", item!.id);
    await runtime.runPageAction("picky", 0);

    expect(state.error).toMatch(/Collator/);
    expect([...new Set(heard.map((f) => f.what))]).toEqual(["computed item.month", "page picky", "action item.share", "page action picky[0]"]);
    expect(heard.every((f) => f.app === "parts")).toBe(true);
    // A button still says what went wrong to whoever pressed it.
    expect(toasts).toEqual(["no way out", "not this button"]);
    stop();
  });

  it("another app's failures are not this one's, and nothing is left listening", async () => {
    const before = activeFailureListeners();
    const { runtime } = await harness();
    const heard: AppFailure[] = [];
    const stop = runtime.onFailure((f) => heard.push(f));
    reportAppFailure({ app: "someone-else", what: "computed x.y", message: "no" });
    runtime.reportFailure("view all", new Error("drawn wrong"));
    expect(heard).toEqual([{ app: "parts", what: "view all", message: "drawn wrong" }]);
    stop();
    expect(activeFailureListeners()).toBe(before);
  });
});
