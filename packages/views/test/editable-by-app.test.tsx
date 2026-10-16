// @vitest-environment happy-dom
// `editableBy: "app"` (docs/03): records only the app's own code writes — a live feed's. Every
// built-in view and the form leave them alone: no Edit, no Delete, no Add, nothing changed in place.
// The app's own code still writes them through ctx. The same app with `editableBy` left out offers
// all of it, so each assertion is about the setting and not the fixture.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { ViewHost } from "../src/host.js";
import { RecordForm } from "../src/record-form.js";

function app(editableBy?: "app"): PotyroApp {
  return defineApp({
    id: "feed-fixture",
    name: "Quakes",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      quake: {
        label: "Earthquake",
        displayField: "place",
        ...(editableBy ? { editableBy } : {}),
        fields: { place: { type: "text", required: true }, mag: { type: "number" }, seen: { type: "boolean" }, state: { type: "enum", options: ["new", "old"] } },
      },
    },
    pages: [
      { id: "all", title: "Quakes", view: { type: "list", entity: "quake", display: { primary: "place" } } },
      { id: "one", title: "Quake", hidden: true, view: { type: "detail", entity: "quake", param: "id" } },
      { id: "check", title: "Check", view: { type: "checklist", entity: "quake", done: "seen", quickAdd: true } },
      { id: "board", title: "Board", view: { type: "board", entity: "quake", column: "state", display: { primary: "place" } } },
    ],
  } as never);
}

async function makeRuntime(def: PotyroApp): Promise<{ runtime: PotyroRuntime; id: string }> {
  const store = new MemoryStore();
  await store.open(def.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: def });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  // The app's own code writes a feed's records: that always works.
  const made = await runtime.ctx.create("quake", { place: "Off the coast", mag: 4.2, seen: false, state: "new" });
  return { runtime, id: String(made.id) };
}

const view = (runtime: PotyroRuntime, pageId: string, params: Record<string, unknown> = {}) =>
  render(<ViewHost runtime={runtime} pageId={pageId} params={params} setParam={() => {}} navigate={() => {}} onEdit={() => {}} onCreate={() => {}} />);

afterEach(cleanup);

describe('editableBy: "app" — a feed\'s records', () => {
  it("a record page offers no Edit and no More actions; the same record of an ordinary entity does", async () => {
    for (const [editableBy, offered] of [
      [undefined, true],
      ["app", false],
    ] as const) {
      const { runtime, id } = await makeRuntime(app(editableBy));
      view(runtime, "one", { id });
      await screen.findByRole("heading", { name: "Off the coast" });
      expect(screen.queryByRole("button", { name: "Edit" }) !== null).toBe(offered);
      expect(screen.queryByRole("button", { name: "More actions" }) !== null).toBe(offered);
      cleanup();
    }
  });

  it("a checklist neither ticks nor adds, and a board neither moves nor adds", async () => {
    for (const [editableBy, offered] of [
      [undefined, true],
      ["app", false],
    ] as const) {
      const { runtime } = await makeRuntime(app(editableBy));
      const patch = vi.spyOn(runtime, "patch");
      view(runtime, "check");
      await screen.findByText("Off the coast");
      expect(screen.queryByRole("textbox", { name: "Add an item" }) !== null).toBe(offered);
      fireEvent.click(document.querySelector<HTMLElement>(".k-check")!);
      await waitFor(() => expect(patch.mock.calls.length > 0).toBe(offered));
      cleanup();

      view(runtime, "board");
      await screen.findByText("Off the coast");
      // The empty column's Add, and the card's moves.
      expect(screen.queryByRole("button", { name: /Add/ }) !== null).toBe(offered);
      const more = screen.queryByRole("button", { name: "Off the coast: more" });
      if (more) fireEvent.click(more);
      expect(screen.queryByRole("menuitem", { name: /Move to/ }) !== null).toBe(offered);
      cleanup();
    }
  });

  it("a list row offers no Delete", async () => {
    const def = app("app");
    // A list with no record page of its own: its rows carry Edit and Delete themselves.
    const listOnly = { ...def, pages: def.pages.filter((p) => p.id === "all") } as PotyroApp;
    for (const [d, offered] of [
      [{ ...listOnly, entities: { quake: { ...def.entities.quake!, editableBy: undefined } } } as PotyroApp, true],
      [listOnly, false],
    ] as const) {
      const { runtime } = await makeRuntime(d);
      view(runtime, "all");
      await screen.findByText("Off the coast");
      expect(screen.queryByRole("button", { name: /Delete/ }) !== null).toBe(offered);
      cleanup();
    }
  });

  it("the form never saves one, even if something opened it", async () => {
    const { runtime, id } = await makeRuntime(app("app"));
    const patch = vi.spyOn(runtime, "patch");
    const cancelled = vi.fn();
    render(<RecordForm runtime={runtime} entity="quake" recordId={id} onDone={() => {}} onCancel={cancelled} />);
    const save = await screen.findByRole("button", { name: "Save changes" });
    fireEvent.click(save);
    await waitFor(() => expect(cancelled).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
  });

  it("the app's own code still writes them", async () => {
    const { runtime, id } = await makeRuntime(app("app"));
    await runtime.ctx.patch("quake", id, { mag: 4.5 });
    expect((await runtime.ctx.get("quake", id))?.mag).toBe(4.5);
  });
});
