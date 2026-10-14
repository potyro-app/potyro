// @vitest-environment happy-dom
//
// "Load your apps?" kept coming back: an app deleted here was offered back from the account, "Not
// now" was forgotten by the next boot, and with nothing ticked the button still read "Load 0 apps"
// and looked ready. These pin each of those.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AccountApp } from "@potyro/store";
import { accountOffer, recordDeclined, recordLeft } from "../src/account-offer.js";
import { RestoreApps } from "../src/restore-apps.js";

const forgotten = vi.hoisted(() => [] as string[]);
vi.mock("../src/open-store.js", () => ({
  forgetAppOnAccount: async (id: string) => {
    forgotten.push(id);
    return true;
  },
}));
vi.mock("../src/dialog.js", () => ({ shellDialogs: { confirm: async () => true } }));
vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));
vi.mock("../src/studio-chat.js", () => ({ clearChat: async () => {} }));

const NOW = "2026-10-14T12:00:00.000Z";
const app = (id: string, root = `co_zROOT_${id}`): AccountApp => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  source: "export default {}",
  group: `co_zGROUP_${id}`,
  root,
  shared: true,
  updatedAt: NOW,
});

const nothingHere = (): boolean => false;

beforeEach(() => {
  localStorage.clear();
  forgotten.length = 0;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("what the account offers this device", () => {
  it("offers the apps this device does not sync, all ticked, the first time", () => {
    const offer = accountOffer([app("notes"), app("plants")], (id) => id === "plants");
    expect(offer?.apps.map((a) => a.id)).toEqual(["notes"]);
    expect([...(offer?.ticked ?? [])]).toEqual(["notes"]);
  });

  it("does not offer back a shared app this device deleted", async () => {
    // The device had it, in that space; deleting it is leaving.
    localStorage.setItem("potyro:jazz:root:user:notes", "co_zROOT_notes");
    localStorage.setItem(
      "potyro:user-apps",
      JSON.stringify([{ id: "notes", name: "Notes", source: "x", trusted: true, sync: true, updatedAt: NOW }]),
    );
    const { confirmAndRemoveApp } = await import("../src/remove-app.js");
    expect(await confirmAndRemoveApp({ id: "notes", name: "Notes", sync: true })).toBe(true);

    // The account may still list it (another device of yours can keep putting it back): not offered.
    expect(accountOffer([app("notes")], nothingHere)).toBeNull();
    // And it is taken off the account too, so no OTHER device is offered it.
    await vi.waitFor(() => expect(forgotten).toEqual(["notes"]));
  });

  it("still offers an unrelated app that reuses the deleted one's id", () => {
    recordLeft({ id: "notes", root: "co_zROOT_old" });
    expect(accountOffer([app("notes", "co_zROOT_new")], nothingHere)?.apps).toHaveLength(1);
  });

  it("does not ask again about apps it was offered and passed on", () => {
    const first = accountOffer([app("notes"), app("plants")], nothingHere);
    expect(first).not.toBeNull();
    recordDeclined(first?.apps ?? []); // "Not now"
    expect(accountOffer([app("notes"), app("plants")], nothingHere)).toBeNull();
  });

  it("asks again when a new app appears, with only the new one ticked", () => {
    recordDeclined([app("notes")]);
    const offer = accountOffer([app("notes"), app("recipes")], nothingHere);
    expect(offer?.apps.map((a) => a.id)).toEqual(["notes", "recipes"]);
    expect([...(offer?.ticked ?? [])]).toEqual(["recipes"]);
  });
});

describe("the Load your apps panel", () => {
  it("disables the load button and says so when nothing is ticked", () => {
    const onRestore = vi.fn(async () => {});
    render(<RestoreApps apps={[app("notes"), app("plants")]} onRestore={onRestore} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Load 2 apps" }) as HTMLButtonElement).toHaveProperty("disabled", false);

    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);

    expect(screen.queryByRole("button", { name: /Load 0/ })).toBeNull();
    const none = screen.getByRole("button", { name: "Nothing to load" });
    expect((none as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(none);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("opens with only the apps it is given as ticked", () => {
    render(
      <RestoreApps apps={[app("notes"), app("plants")]} ticked={new Set(["plants"])} onRestore={async () => {}} onClose={() => {}} />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(screen.getByRole("button", { name: "Load 1 app" }) as HTMLButtonElement).toHaveProperty("disabled", false);
  });
});
