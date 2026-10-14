// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import type { MediaField } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldInput, FieldValue } from "../src/index.js";

// The photo field (#102): a tile that shows what you chose, with a way to take it off, a strip when
// the field takes several, and a real complaint when the store refuses the file.

const app = defineApp({
  id: "media-fixture",
  name: "Media Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        photo: { type: "media", accept: "image" },
        gallery: { type: "media", accept: "image", multiple: true },
      },
    },
  },
  pages: [{ id: "list", title: "Plants", view: { type: "list", entity: "plant", display: { primary: "name" } } }],
});

async function makeRuntime(caps = new FakeCapabilities(), breakStore = false): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("media-fixture");
  // `runtime.ctx` mints a fresh ctx per access, so a failure has to come from the store underneath.
  if (breakStore) store.putBlob = async () => Promise.reject(new Error("disk is full"));
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps, ui, nav });
}

const photo: MediaField = { type: "media", accept: "image" };
const gallery: MediaField = { type: "media", accept: "image", multiple: true };
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "leaf.png", { type: "image/png" });

afterEach(cleanup);

describe("the empty field", () => {
  it("is a tile that says what it wants, not a file button", async () => {
    const runtime = await makeRuntime();
    render(<FieldInput runtime={runtime} field={photo} value={null} onChange={() => {}} label="Photo" />);
    expect(screen.getByRole("button", { name: "Photo: add photo" })).toBeTruthy();
    // The file input is there as the fallback the tile drives, but it is not what you see.
    const file = document.querySelector("input[type=file]") as HTMLInputElement;
    expect(file).toBeTruthy();
    expect(file.getAttribute("aria-hidden")).toBe("true");
    expect(file.className).toContain("k-media-file");
  });

  it("says the word the field's kind calls for", async () => {
    const runtime = await makeRuntime();
    render(<FieldInput runtime={runtime} field={{ type: "media", accept: "video" }} value={null} onChange={() => {}} label="Clip" />);
    expect(screen.getByRole("button", { name: "Clip: add video" })).toBeTruthy();
  });
});

describe("choosing a file", () => {
  it("stores it and hands back a ref; the tile then shows it with a way to remove it", async () => {
    const runtime = await makeRuntime();
    const onChange = vi.fn();
    const { rerender } = render(<FieldInput runtime={runtime} field={photo} value={null} onChange={onChange} label="Photo" />);
    const file = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(file, { target: { files: [png()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const ref = onChange.mock.calls[0]![0] as { key: string; mime: string };
    expect(ref.mime).toBe("image/png");

    rerender(<FieldInput runtime={runtime} field={photo} value={ref} onChange={onChange} label="Photo" />);
    // One photo: the add tile gives way to the photo itself.
    expect(screen.queryByRole("button", { name: "Photo: add photo" })).toBeNull();
    const remove = screen.getByRole("button", { name: "Remove: Photo" });
    fireEvent.click(remove);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("a multiple field keeps a strip and appends, and the add tile stays", async () => {
    const runtime = await makeRuntime();
    const onChange = vi.fn();
    const first = { key: "a", mime: "image/png" };
    render(<FieldInput runtime={runtime} field={gallery} value={[first]} onChange={onChange} label="Gallery" />);
    expect(screen.getByRole("button", { name: "Gallery: add" })).toBeTruthy();
    const file = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(file, { target: { files: [png()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0]![0] as { key: string }[];
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(first);
  });

  it("says so when the store refuses the file, instead of leaving an empty field", async () => {
    const runtime = await makeRuntime(new FakeCapabilities(), true);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={photo} value={null} onChange={onChange} label="Photo" />);
    fireEvent.change(document.querySelector("input[type=file]") as HTMLInputElement, { target: { files: [png()] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk is full"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the value on a record page", () => {
  it("shows every photo, not only the first", async () => {
    const runtime = await makeRuntime();
    const { container } = render(
      <FieldValue runtime={runtime} entity="plant" fieldKey="gallery" value={[{ key: "a", mime: "image/png" }, { key: "b", mime: "image/png" }]} />,
    );
    expect(container.querySelectorAll(".k-media-tile")).toHaveLength(2);
    // Read-only: no remove buttons where the record is only being read.
    expect(container.querySelectorAll(".k-media-x")).toHaveLength(0);
  });
});

// A photo someone else added, in a shared app (KA-20, #61): it is its own encrypted file, fetched
// when a view asks for it. So a reference whose bytes have not arrived is normal — and an empty
// square, which is what this used to draw, reads as a photo that was lost.
describe("a photo that has not arrived", () => {
  /** A store that answers "not here yet" until `land()` is called. */
  function latecomer() {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    let here = false;
    let tell: (() => void) | undefined;
    return {
      land: () => {
        here = true;
        tell?.();
      },
      install(store: MemoryStore) {
        store.getBlob = async () => (here ? new Blob([bytes], { type: "image/png" }) : null);
        (store as MemoryStore & { subscribeBlob?: unknown }).subscribeBlob = (_r: unknown, cb: () => void) => {
          tell = cb;
          return () => (tell = undefined);
        };
      },
    };
  }

  it("says it is coming, then shows it the moment it lands", async () => {
    const store = new MemoryStore();
    await store.open("media-fixture");
    const late = latecomer();
    late.install(store);
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const nav: NavBridge = { navigate: () => {} };
    const host = createHost();
    const loaded = await host.load({ kind: "module", app });
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });

    render(<FieldValue runtime={runtime} entity="plant" fieldKey="photo" value={{ key: "k1", mime: "image/png" }} />);

    await waitFor(() => expect(screen.getByText(/Getting the photo/)).toBeTruthy());
    expect(document.querySelector("img")).toBeNull();

    late.land();
    await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
    expect(screen.queryByText(/Getting the photo/)).toBeNull();
  });
});
