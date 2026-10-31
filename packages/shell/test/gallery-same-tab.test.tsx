// @vitest-environment happy-dom
//
// The gallery opens in this tab (#487): its Make it mine comes back into Potyro, and only one tab at a
// time holds the apps — from a second tab the copy was refused as "open in another tab". What was in
// the Studio's box when the person left is kept for it, in this tab's session.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FreePanel } from "../src/free-panel.js";
import { GALLERY_URL, leaveForGallery, openGallery } from "../src/gallery-link.js";
import { Seal } from "../src/seal.js";
import { PromptBox } from "../src/prompt-box.js";
import { forgetKeptIdea, keepIdea, keptIdea } from "../src/kept-idea.js";

const free = { health: { ok: true, chat: false }, left: null, stopped: null } as unknown as Parameters<typeof FreePanel>[0]["free"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("the gallery, in this tab", () => {
  it("the key panel's link goes there in this tab, and keeps what the page holds as it leaves", () => {
    const onLeave = vi.fn();
    const { getByRole } = render(<FreePanel free={free} onAddKey={() => undefined} onLeave={onLeave} />);
    const link = getByRole("link", { name: "Start from an app in the gallery" });
    expect(link.getAttribute("href")).toBe(GALLERY_URL);
    expect(link.hasAttribute("target")).toBe(false);
    fireEvent.click(link);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("the key panel asks first when the Studio holds what cannot be kept, and goes only on Leave", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    let answer!: (go: boolean) => void;
    const onLeave = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { getByRole } = render(<FreePanel free={free} onAddKey={() => undefined} onLeave={onLeave} />);
    const link = getByRole("link", { name: "Start from an app in the gallery" });
    // Asking: the link does not go on its own.
    expect(fireEvent.click(link)).toBe(false);
    answer(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(assign).not.toHaveBeenCalled();
    // Asked again, and this time the person leaves.
    expect(fireEvent.click(link)).toBe(false);
    answer(true);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(GALLERY_URL));
    expect(onLeave).toHaveBeenCalledTimes(2);
  });

  it("with nothing unkept the link just goes, and the words are kept as it does", () => {
    const keep = vi.fn();
    const ask = vi.fn(async () => true);
    expect(leaveForGallery({ unkept: false, keep, ask })).toBe(true);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it("with a version or code not kept it asks; Stay keeps nothing and goes nowhere, Leave keeps the words", async () => {
    const keep = vi.fn();
    expect(await leaveForGallery({ unkept: true, keep, ask: async () => false })).toBe(false);
    expect(keep).not.toHaveBeenCalled();
    expect(await leaveForGallery({ unkept: true, keep, ask: async () => true })).toBe(true);
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("Browse the gallery goes there in this tab, never a window of its own", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openGallery();
    expect(assign).toHaveBeenCalledWith(GALLERY_URL);
    expect(open).not.toHaveBeenCalled();
  });

  it("the seal goes to Potyro in this tab; from inside the Studio's preview, beside it", () => {
    const { container, rerender } = render(<Seal hue={120} />);
    let seal = container.querySelector("a.k-seal")!;
    expect(seal.getAttribute("href")).toBe(GALLERY_URL);
    expect(seal.hasAttribute("target")).toBe(false);
    rerender(<Seal hue={120} beside />);
    seal = container.querySelector("a.k-seal")!;
    expect(seal.getAttribute("target")).toBe("_blank");
  });
});

describe("the words kept for the Studio", () => {
  it("are kept for the app they were about (none: a new app), until forgotten", () => {
    keepIdea("a list of the plants I water");
    expect(keptIdea()).toBe("a list of the plants I water");
    expect(keptIdea("plants")).toBeUndefined();
    forgetKeptIdea();
    expect(keptIdea()).toBeUndefined();

    keepIdea("make the dates bigger", "plants");
    expect(keptIdea("plants")).toBe("make the dates bigger");
    expect(keptIdea()).toBeUndefined();
  });

  it("an empty box keeps nothing, and clears what was kept", () => {
    keepIdea("a reading tracker");
    keepIdea("   ");
    expect(keptIdea()).toBeUndefined();
  });

  it("a stored value that is not ours reads as nothing", () => {
    sessionStorage.setItem("potyro:kept-idea", "{not json");
    expect(keptIdea()).toBeUndefined();
    sessionStorage.setItem("potyro:kept-idea", JSON.stringify({ text: 42 }));
    expect(keptIdea()).toBeUndefined();
  });

  it("Home's prompt box starts with them", () => {
    const { getByRole } = render(<PromptBox sendLabel="Describe an app" onSend={() => undefined} initial="a reading tracker" />);
    expect((getByRole("textbox", { name: "Describe your app" }) as HTMLTextAreaElement).value).toBe("a reading tracker");
  });
});
