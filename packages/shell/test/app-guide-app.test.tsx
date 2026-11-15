// @vitest-environment happy-dom
//
// The guide inside the app's own chrome (#80): the card on first open, the menu entry, and neither
// for an app that carries no guide. `<App>` is mounted whole, as the shell mounts an app of the
// person's (an id, `currentKind: "user"`) and as a demo or the Studio's preview does (no id).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defineApp, type AppInput, type PotyroApp } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import { MemoryStore } from "@potyro/store";
import { compose } from "../src/compose.js";
import { createNavBridge } from "../src/ui-bridge.js";
import { Toaster } from "../src/toaster.js";
import { App } from "../src/App.js";
import { guideSeenKey } from "../src/app-guide.js";

const STEPS = ["Tap “Add: Bottle” and name the wine.", "Open a bottle to change it."];

const cellar = (extra: Partial<AppInput> = {}): PotyroApp =>
  defineApp({
    id: "cellar",
    name: "Cellar",
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    entities: { bottle: { label: "Bottle", displayField: "name", fields: { name: { type: "text", required: true } } } },
    pages: [{ id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } }],
    ...extra,
  });

async function mount(app: PotyroApp, as: { appId?: string; languages?: string[] } = { appId: "cellar" }) {
  const store = new MemoryStore();
  await store.open("guide-test");
  const composed = await compose({
    provenance: "trusted",
    app,
    store,
    caps: new FakeCapabilities(),
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: createNavBridge(() => {}),
    ...(as.languages ? { languages: as.languages } : {}),
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<App runtime={composed.runtime} provenance="trusted" toaster={new Toaster()} {...(as.appId ? { appId: as.appId, currentKind: "user" as const } : {})} />);
  });
  await waitFor(() => expect(view.container.querySelector(".k-app-chrome")).toBeTruthy());
  return view;
}

const card = (): HTMLElement | null => screen.queryByRole("region", { name: "How to use it" });
const menuEntry = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-tool="guide"]');

beforeEach(() => {
  localStorage.clear();
  // A wide screen: the sidebar lists the app's tools as buttons.
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
});
afterEach(cleanup);

describe("an app with a guide", () => {
  it("shows its steps on the page the first time, and not again once closed", async () => {
    const first = await mount(cellar({ guide: STEPS }));
    expect(within(card()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual(STEPS);
    expect(localStorage.getItem(guideSeenKey("cellar"))).toBeNull();
    fireEvent.click(within(card()!).getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(guideSeenKey("cellar"))).not.toBeNull();
    first.unmount();

    await mount(cellar({ guide: STEPS }));
    expect(card()).toBeNull();
  });

  it("is shown in the person's language, like the rest of the app's words", async () => {
    // A step with its languages written in place; a catalog is looked up the same way (schema guide.test.ts).
    const app = cellar({ guide: [STEPS[0]!, { en: STEPS[1]!, de: "Öffne eine Flasche, um sie zu ändern." }], languages: ["en", "de"] });
    await mount(app, { appId: "cellar", languages: ["de"] });
    expect(within(card()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual([STEPS[0], "Öffne eine Flasche, um sie zu ändern."]);
  });

  it("is not put in front of someone trying a demo or previewing in the Studio: no app here to remember it for", async () => {
    await mount(cellar({ guide: STEPS }), {});
    expect(card()).toBeNull();
  });
});

describe("an app without a guide", () => {
  it("shows no card", async () => {
    await mount(cellar());
    expect(card()).toBeNull();
    expect(localStorage.getItem(guideSeenKey("cellar"))).toBeNull();
  });
});

describe("the app's menu", () => {
  it("lists “How to use it” only for an app with a guide, and opens the steps as a dialog — with or without an id", async () => {
    const without = await mount(cellar());
    expect(without.container.querySelector(".k-app-chrome")!.getAttribute("data-layout")).toBeTruthy();
    expect(menuEntry(without.container)).toBeNull();
    expect(screen.queryByText("How to use it")).toBeNull();
    without.unmount();

    for (const as of [{ appId: "cellar" }, {}]) {
      localStorage.setItem(guideSeenKey("cellar"), "1");
      const view = await mount(cellar({ guide: STEPS }), as);
      expect(card()).toBeNull();
      const entry = menuEntry(view.container) ?? screen.queryByRole("button", { name: "How to use it" });
      if (!entry) {
        // Phone chrome: the entry is inside the ⋯ menu.
        fireEvent.click(screen.getByRole("button", { name: /^More/ }));
      }
      fireEvent.click(menuEntry(view.container) ?? screen.getByText("How to use it"));
      const dialog = screen.getByRole("dialog", { name: "How to use it" });
      expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual(STEPS);
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      view.unmount();
    }
  });
});
