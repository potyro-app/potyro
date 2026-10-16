// @vitest-environment happy-dom
//
// A sealed app's custom view, as the views see it (#267): the page asks the loaded app for its
// sealed view and hands it a place to draw; when the watchdog stops it — or it froze Potyro on this
// device before — the page shows the app's plain version, calmly, with its other pages one tap away
// and "Try its screen again". The frame itself is the host's and the browser's (e2e).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type SealedView, type SealedViewEvents, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { CustomView } from "../src/custom.js";

const app = defineApp({
  id: "sealed-fixture",
  name: "Sealed Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { label: "Note", displayField: "text", fields: { text: { type: "text" } } } },
  pages: [
    { id: "play", title: "Play", view: { type: "custom", entity: "note", render: () => null as never } },
    { id: "scores", title: "Scores", view: { type: "list", entity: "note" } },
  ],
});

/** A runtime whose loaded app behaves as a sealed one: no component in the shell, a sealed view instead. */
async function sealedRuntime(sealed: SealedView): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("sealed-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  Object.assign(loaded, { customView: () => null, customViewMount: () => null, sealedView: (p: string) => (p === "play" ? sealed : null) });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

function fakeSealed(initial: "ready" | "off" = "ready") {
  let state = initial;
  const mounts: Array<{ el: HTMLElement; events: SealedViewEvents; label?: string }> = [];
  const teardown = vi.fn();
  const sealed: SealedView = {
    state: () => state,
    retry: () => {
      state = "ready";
    },
    mount: (el, _props, events, label) => {
      mounts.push({ el, events, label });
      const f = document.createElement("iframe");
      el.appendChild(f);
      return teardown;
    },
  };
  return { sealed, mounts, teardown, turnOff: () => (state = "off") };
}

afterEach(() => cleanup());

describe("a sealed app's own screen", () => {
  it("is mounted into its place with the page's title, and torn down with the page", async () => {
    const f = fakeSealed();
    const runtime = await sealedRuntime(f.sealed);
    const { unmount, container } = render(<CustomView runtime={runtime} pageId="play" params={{}} setParam={() => {}} navigate={() => {}} />);
    expect(f.mounts).toHaveLength(1);
    expect(f.mounts[0]!.label).toBe("Play");
    expect(container.querySelector(".k-sealed-view iframe")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Run it as mine…" })).toBeNull();
    unmount();
    expect(f.teardown).toHaveBeenCalledTimes(1);
  });

  it("stopped by the watchdog, becomes the plain version: a calm status, the other pages, and a way back", async () => {
    const f = fakeSealed();
    const navigate = vi.fn();
    const runtime = await sealedRuntime(f.sealed);
    const { container } = render(<CustomView runtime={runtime} pageId="play" params={{}} setParam={() => {}} navigate={navigate} />);
    act(() => f.mounts[0]!.events.onStopped({ reason: "its screen stopped answering" }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("This app’s screen stopped responding, so Potyro is showing its plain version.");
    expect(container.querySelector(".k-sealed-view")).toBeNull();
    act(() => screen.getByRole("button", { name: "Scores" }).click());
    expect(navigate).toHaveBeenCalledWith("scores");
    act(() => screen.getByRole("button", { name: "Try its screen again" }).click());
    expect(f.mounts).toHaveLength(2);
  });

  it("off on this device (it froze Potyro before): plain from the start, never mounted until asked", async () => {
    const f = fakeSealed("off");
    const runtime = await sealedRuntime(f.sealed);
    render(<CustomView runtime={runtime} pageId="play" params={{}} setParam={() => {}} navigate={() => {}} />);
    expect(f.mounts).toHaveLength(0);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Try its screen again" }).click());
    expect(f.sealed.state()).toBe("ready");
    expect(f.mounts).toHaveLength(1);
  });

  it("whose code throws is that part failing, not a stopped screen", async () => {
    const f = fakeSealed();
    const runtime = await sealedRuntime(f.sealed);
    render(<CustomView runtime={runtime} pageId="play" params={{}} setParam={() => {}} navigate={() => {}} />);
    act(() => f.mounts[0]!.events.onFailed?.("boom"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).toMatch(/boom/);
  });
});
