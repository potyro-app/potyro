// @vitest-environment happy-dom
// A row's photo URL lives as long as the row shows it. The cells used to free every URL they had
// minted the moment the rows changed — while those pictures were still on screen, and before the new
// batch had arrived — so a lazy image that had not loaded yet pointed at a dead URL for good: blank
// gallery cards and "ERR_FILE_NOT_FOUND" in the console (Recipes' gallery, first run).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { defineApp, type MediaRef } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type UiBridge } from "@potyro/host";
import { createRuntime } from "@potyro/runtime";
import { GalleryView } from "../src/builtins.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const app = defineApp({
  id: "pics",
  name: "Pics",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { pic: { displayField: "name", fields: { name: { type: "text" }, photo: { type: "media" } } } },
  pages: [{ id: "all", title: "All", view: { type: "gallery", entity: "pic" } }],
});

describe("a gallery's photo URLs", () => {
  it("stay valid while they are on screen, through a change of rows, and are freed once replaced", async () => {
    const store = new MemoryStore();
    await store.open(app.id);
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const host = createHost();
    const runtime = createRuntime({ app: await host.load({ kind: "module", app }), host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });

    // Every photo read waits on `hold`, so a test can keep the next batch of URLs from arriving.
    let hold: Promise<void> = Promise.resolve();
    const getBlob = store.getBlob.bind(store);
    vi.spyOn(store, "getBlob").mockImplementation(async (ref: MediaRef) => {
      await hold;
      return getBlob(ref);
    });
    let minted = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${(minted += 1)}`);
    const revoked = new Set<string>();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => void revoked.add(u));
    const photo = (): Promise<MediaRef> => runtime.ctx.media.put(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));

    await runtime.ctx.create("pic", { name: "one", photo: await photo() });
    render(<GalleryView runtime={runtime} pageId="all" params={{}} setParam={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll(".k-card-media img")).toHaveLength(1));
    const first = (document.querySelector(".k-card-media img") as HTMLImageElement).getAttribute("src")!;

    // The rows change; the next batch of URLs is slow to come.
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    await act(async () => {
      await runtime.ctx.create("pic", { name: "two", photo: await photo() });
    });
    await waitFor(() => expect(document.body.textContent).toContain("two"));
    // Still on screen, so still alive.
    expect(revoked.has(first)).toBe(false);

    await act(async () => release());
    await waitFor(() => expect(document.querySelectorAll(".k-card-media img")).toHaveLength(2));
    const now = [...document.querySelectorAll(".k-card-media img")].map((i) => i.getAttribute("src")!);
    for (const u of now) expect(revoked.has(u)).toBe(false);
    // The replaced one is freed, not leaked.
    await waitFor(() => expect(revoked.has(first)).toBe(true));

    cleanup();
    for (const u of now) expect(revoked.has(u)).toBe(true);
  });
});
