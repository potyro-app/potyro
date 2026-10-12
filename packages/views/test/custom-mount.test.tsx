// @vitest-environment happy-dom
//
// The framework-neutral custom-view contract.
//
// `render: (props) => JSX` names React in the APP-FACING contract, which is what made the host's view
// framework an architectural decision rather than a changeable one. `mount: (el, props) => cleanup`
// says the same thing without naming a framework: the host hands over a container and keeps the
// teardown — the same deal MapLibre already gets.
//
// These use plain DOM as the "other framework" precisely because it needs no framework at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { defineApp, structureSchema, type ViewProps } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { CustomView } from "../src/custom.js";

const torn = vi.fn();

function appWith(view: Record<string, unknown>) {
  return defineApp({
    id: "mount-fixture",
    name: "Mount Fixture",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { note: { label: "Note", displayField: "text", fields: { text: { type: "text", required: true } } } },
    pages: [{ id: "screen", title: "Screen", view: view as never }],
  });
}

async function runtimeFor(view: Record<string, unknown>): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("mount-fixture");
  await store.insert("note", { text: "hello" });
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: appWith(view) });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

const View = ({ runtime }: { runtime: PotyroRuntime }) => (
  <CustomView runtime={runtime} pageId="screen" params={{}} setParam={() => {}} navigate={() => {}} />
);

afterEach(() => {
  cleanup();
  torn.mockReset();
});

describe("a custom view declared with `mount`", () => {
  it("renders without any React in the app's own code", async () => {
    const runtime = await runtimeFor({
      type: "custom",
      entity: "note",
      mount: (el: HTMLElement) => {
        const h = document.createElement("h2");
        h.textContent = "Built with plain DOM";
        el.append(h);
        return torn;
      },
    });
    render(<View runtime={runtime} />);
    await waitFor(() => expect(screen.getByText("Built with plain DOM")).toBeTruthy());
  });

  it("receives the same ViewProps a React view gets, so it can reach ctx and data", async () => {
    let seen: ViewProps | null = null;
    const runtime = await runtimeFor({
      type: "custom",
      entity: "note",
      mount: (el: HTMLElement, props: ViewProps) => {
        seen = props;
        // The neutral data contract: a subscription, not a hook.
        return props.runtime.watchQuery("note", undefined, ({ rows }) => {
          el.textContent = `${rows.length} note(s)`;
        });
      },
    });
    render(<View runtime={runtime} />);
    await waitFor(() => expect(screen.getByText("1 note(s)")).toBeTruthy());
    expect(seen!.entity).toBe("note");
    expect(typeof seen!.runtime.ctx.now).toBe("function");
  });

  it("is torn down when the view goes away", async () => {
    const runtime = await runtimeFor({
      type: "custom",
      entity: "note",
      mount: (el: HTMLElement) => {
        el.textContent = "up";
        return torn;
      },
    });
    const { unmount } = render(<View runtime={runtime} />);
    await waitFor(() => expect(screen.getByText("up")).toBeTruthy());
    unmount();
    expect(torn).toHaveBeenCalledTimes(1);
  });

  it("a throwing mount does not take the shell down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = await runtimeFor({
      type: "custom",
      entity: "note",
      mount: () => {
        throw new Error("boom");
      },
    });
    render(<View runtime={runtime} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/This part of the app hit a problem.*boom/));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the schema", () => {
  const base = {
    id: "a",
    name: "A",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { note: { fields: { text: { type: "text" } } } },
  };
  const parse = (view: unknown) => structureSchema.safeParse({ ...base, pages: [{ id: "p", title: "P", view }] });

  it("accepts either form", () => {
    expect(parse({ type: "custom", entity: "note", render: () => null }).success).toBe(true);
    expect(parse({ type: "custom", entity: "note", mount: () => () => {} }).success).toBe(true);
  });

  it("rejects declaring neither, or both", () => {
    // Both is ambiguous — the host would have to pick one silently, which is how a view ends up
    // rendering something the author didn't write.
    expect(parse({ type: "custom", entity: "note" }).success).toBe(false);
    expect(parse({ type: "custom", entity: "note", render: () => null, mount: () => () => {} }).success).toBe(false);
  });
});
