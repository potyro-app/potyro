// @vitest-environment happy-dom
//
// The `steps` built-in. It was declared in the schema, the type union and the docs from the start
// while rendering a "arrives in a later milestone" placeholder — the last place the definition model
// promised something it didn't do.
//
// Beyond "it renders checkboxes", two behaviours are what make it usable rather than a demo:
// progress survives leaving the page, and `onFinish` fires once on completion rather than every
// time you look at a finished walk-through.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { StepsView } from "../src/steps.js";

const cooked = vi.fn();

const app = defineApp({
  id: "steps-fixture",
  name: "Steps Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    recipe: {
      label: "Recipe",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        steps: { type: "list", ordered: true, of: { text: { type: "text", required: true } } },
      },
      actions: { markCooked: async (r) => void cooked(r.id) },
    },
  },
  pages: [
    {
      id: "cook",
      title: "Cook",
      view: { type: "steps", entity: "recipe", param: "recipeId", list: "steps", text: "text", onFinish: "markCooked" },
    },
  ],
});

async function makeRuntime(): Promise<{ runtime: PotyroRuntime; id: string; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.open("steps-fixture");
  const rec = await store.insert("recipe", {
    name: "Toast",
    steps: [{ text: "Slice the bread" }, { text: "Toast it" }, { text: "Butter it" }],
  });

  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return { runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }), id: String(rec.id), store };
}

function View({ runtime, id }: { runtime: PotyroRuntime; id: string }) {
  return (
    <StepsView runtime={runtime} pageId="cook" params={{ recipeId: id }} setParam={() => {}} navigate={() => {}} />
  );
}

afterEach(() => {
  cleanup();
  cooked.mockReset();
});

describe("StepsView", () => {
  it("renders the ordered list with its progress", async () => {
    const { runtime, id } = await makeRuntime();
    render(<View runtime={runtime} id={id} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));
    expect(screen.getByText("Slice the bread")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("0 of 3 done");
  });

  it("ticks a step and counts it", async () => {
    const { runtime, id } = await makeRuntime();
    render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3 done"));
  });

  it("remembers progress, so you can walk away mid-recipe", async () => {
    // The reference custom view kept ticks in component state, so leaving the page lost them —
    // useless for the thing a walk-through is actually for.
    const { runtime, id } = await makeRuntime();
    const first = render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3 done"));
    first.unmount();

    render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3 done"));
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  });

  it("runs onFinish once when the last step is ticked", async () => {
    const { runtime, id } = await makeRuntime();
    render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));

    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    await waitFor(() => expect(cooked).toHaveBeenCalledTimes(1));
    expect(cooked).toHaveBeenCalledWith(id);
    expect(screen.getByText("All done.")).toBeTruthy();
  });

  it("does not re-run onFinish when you reopen a finished walk-through", async () => {
    // Re-firing on mount would silently log a second cook every time you glanced at the page.
    const { runtime, id } = await makeRuntime();
    const first = render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    await waitFor(() => expect(cooked).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("3 of 3 done"));
    expect(cooked).toHaveBeenCalledTimes(1);
  });

  it("starts over on request, clearing what was saved", async () => {
    const { runtime, id } = await makeRuntime();
    const first = render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3 done"));

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 of 3 done"));

    first.unmount();
    render(<View runtime={runtime} id={id} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 of 3 done"));
  });

  it("says so when there is nothing to walk through", async () => {
    const store = new MemoryStore();
    await store.open("steps-fixture");
    const rec = await store.insert("recipe", { name: "Empty", steps: [] });
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const host = createHost();
    const loaded = await host.load({ kind: "module", app });
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });

    render(<View runtime={runtime} id={String(rec.id)} />);
    await waitFor(() => expect(screen.getByText("No steps yet.")).toBeTruthy());
    // An empty list is not a completed one — `onFinish` must not fire for it.
    expect(cooked).not.toHaveBeenCalled();
  });
});
