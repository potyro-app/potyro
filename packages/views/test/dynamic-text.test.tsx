// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { defineApp, type Ctx } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { ListView } from "../src/builtins.js";

// `Dynamic<string>` in a built-in view (#133): the empty state names the selection, and follows it.

const app = () =>
  defineApp({
    id: "trips",
    name: "Trips",
    version: "1.0.0",
    schemaVersion: 1,
    scope: { entity: "trip" },
    entities: {
      trip: { displayField: "city", fields: { city: { type: "text" } } },
      place: { displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" } } },
    },
    pages: [
      {
        id: "places",
        title: "Places",
        view: {
          type: "list",
          entity: "place",
          display: { primary: "name" },
          filter: (p, ctx) => !ctx.scope.trip || p.trip?.id === ctx.scope.trip.id,
          emptyText: (ctx: Ctx) => `No places in ${String((ctx.scope.trip as { city?: string } | undefined)?.city ?? "any trip")} yet`,
        },
      },
    ],
  });

async function makeRuntime(): Promise<{ runtime: KartaRuntime; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.open("trips");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  return { runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }), store };
}

afterEach(cleanup);

describe("a function-valued emptyText", () => {
  it("renders the resolved text and follows the selection", async () => {
    const { runtime, store } = await makeRuntime();
    const { container } = render(<ListView runtime={runtime} pageId="places" params={{}} setParam={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(container.querySelector(".k-empty")?.textContent).toBe("No places in any trip yet"));

    const lisbon = await store.insert("trip", { city: "Lisbon" });
    await runtime.setScope("trip", lisbon.id);
    await waitFor(() => expect(container.querySelector(".k-empty")?.textContent).toBe("No places in Lisbon yet"));
  });
});
