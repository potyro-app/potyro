// @vitest-environment happy-dom
// Records only the app's code writes (`editableBy: "app"`, #365) offer no add, edit or delete by hand
// in the redesigned views either: no "Add another" under a short list, no "Add the first one" on an
// empty page, no Edit or More actions on the record's page, no Edit in a table.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { defineApp, type AppInput } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { ListView, TableView } from "../src/builtins.js";
import { DetailView } from "../src/detail.js";

afterEach(cleanup);

const feed: AppInput = {
  id: "feed",
  name: "Feed",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { quake: { editableBy: "app", displayField: "place", fields: { place: { type: "text" }, mag: { type: "number" } } } },
  pages: [
    { id: "list", title: "Latest", view: { type: "list", entity: "quake" } },
    { id: "table", title: "Table", view: { type: "table", entity: "quake", display: { columns: ["place", "mag"] } } },
    { id: "one", title: "Quake", hidden: true, view: { type: "detail", entity: "quake", param: "id" } },
  ],
};

async function runtimeFor(def: AppInput): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  const built = defineApp(def);
  await store.open(built.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost();
  return createRuntime({ app: await host.load({ kind: "module", app: built }), host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
}

const props = (runtime: PotyroRuntime, pageId: string, params: Record<string, unknown> = {}) => ({
  runtime,
  pageId,
  params,
  setParam: () => {},
  navigate: vi.fn(),
  onEdit: vi.fn(),
  onCreate: vi.fn(),
});

describe("records the app writes", () => {
  it("an empty page and a short list offer nothing to add", async () => {
    const runtime = await runtimeFor(feed);
    render(<ListView {...props(runtime, "list")} />);
    await screen.findByText("Nothing here yet.");
    expect(screen.queryByRole("button", { name: /Add the first one/ })).toBeNull();
    cleanup();
    await runtime.ctx.create("quake", { place: "Tonga", mag: 5.3 });
    render(<ListView {...props(runtime, "list")} />);
    await screen.findByText("Tonga");
    expect(screen.queryByRole("button", { name: "Add another" })).toBeNull();
  });

  it("the record's page and a table offer no Edit, no Delete", async () => {
    const runtime = await runtimeFor(feed);
    const q = await runtime.ctx.create("quake", { place: "Tonga", mag: 5.3 });
    render(<DetailView {...props(runtime, "one", { id: q.id })} />);
    await screen.findByRole("heading", { name: "Tonga" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    cleanup();
    render(<TableView {...props(runtime, "table")} />);
    await screen.findByText("Tonga");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
