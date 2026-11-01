// @vitest-environment happy-dom
//
// One owner of the kept idea at a time (#487). Words typed in the Studio before the person went to
// the gallery wait in this tab (kept-idea.ts) and fill Home's box on the way back. From then on they
// are that box's: edited, cleared or sent, the kept copy is forgotten, so nothing the person deleted
// comes back — not in Home's box when it mounts again, not in the Studio it opens. And leaving Home
// for the gallery keeps what is in Home's box.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../src/identity-panel.js", () => ({ IdentityPanel: () => null, askNameIfUnnamed: async () => {}, offerBackupOnFirstSync: async () => {} }));
vi.mock("../src/open-store.js", () => ({ canSync: () => true, cannotSyncMessage: () => "no" }));
vi.mock("../src/check-concurrency.js", () => ({ checkConcurrency: async () => ({}), describeHazards: () => [] }));
vi.mock("../src/share-sync.js", () => ({ createShareLink: async () => "link" }));
vi.mock("../src/toggle-sync.js", () => ({ toggleAppSync: async () => ({ copied: { records: 0 }, warnings: [] }) }));
vi.mock("../src/history.js", () => ({ History: () => null }));
vi.mock("../src/app-source.js", () => ({ inspect: async () => ({ entities: [], pages: [] }) }));
vi.mock("../src/dialog.js", () => ({ shellDialogs: { confirm: async () => true, prompt: async () => null, share: async () => {} } }));

import { Launcher } from "../src/launcher.js";
import { setLook } from "../src/look.js";
import { GALLERY_URL } from "../src/gallery-link.js";
import { keepIdea, keptIdea } from "../src/kept-idea.js";

const IDEA = "a list of the plants I water and when";
const props = { variant: "home" as const, onOpen: () => {} };
const box = (): HTMLTextAreaElement => screen.getAllByRole("textbox", { name: "Describe your app" })[0] as HTMLTextAreaElement;
const send = (): HTMLElement => screen.getAllByRole("button", { name: "Describe an app" })[0]!;

afterEach(() => {
  cleanup();
  setLook({ appearance: "system" });
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Home's box owns the kept idea once it has it", () => {
  it("starts with the kept words, and sends them as they are", () => {
    keepIdea(IDEA);
    const onNewApp = vi.fn();
    render(<Launcher {...props} onNewApp={onNewApp} />);
    expect(box().value).toBe(IDEA);
    fireEvent.click(send());
    expect(onNewApp).toHaveBeenCalledWith(IDEA);
    expect(keptIdea()).toBeUndefined();
  });

  it("cleared and sent: the Studio is handed the empty box, never the deleted words", () => {
    keepIdea(IDEA);
    const onNewApp = vi.fn();
    render(<Launcher {...props} onNewApp={onNewApp} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.click(send());
    // "" and not undefined: the Studio fills its box from a kept idea only when it is given nothing.
    expect(onNewApp).toHaveBeenCalledWith("");
    expect(keptIdea()).toBeUndefined();
  });

  it("cleared: the words do not fill the box again when Home comes back", () => {
    keepIdea(IDEA);
    const first = render(<Launcher {...props} onNewApp={() => {}} />);
    fireEvent.change(box(), { target: { value: "" } });
    first.unmount();
    render(<Launcher {...props} onNewApp={() => {}} />);
    expect(box().value).toBe("");
  });

  it("edited: the edit is the box's, and the kept words are forgotten", () => {
    keepIdea(IDEA);
    render(<Launcher {...props} onNewApp={() => {}} />);
    fireEvent.change(box(), { target: { value: "a list of the plants I water" } });
    expect(keptIdea()).toBeUndefined();
  });

  it("an idea kept about another app is left alone", () => {
    keepIdea("make the dates bigger", "plants");
    const onNewApp = vi.fn();
    render(<Launcher {...props} onNewApp={onNewApp} />);
    expect(box().value).toBe("");
    fireEvent.click(send());
    expect(onNewApp).toHaveBeenCalledWith("");
  });
});

describe("leaving Home for the gallery keeps what is in Home's box", () => {
  it("from the New app menu's Browse the gallery", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    render(<Launcher {...props} onNewApp={() => {}} />);
    fireEvent.change(box(), { target: { value: IDEA } });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".k-launch-fab")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse the gallery" }));
    expect(assign).toHaveBeenCalledWith(GALLERY_URL);
    expect(keptIdea()).toBe(IDEA);
  });

  it("from the Tiles app bar's Gallery", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    setLook({ appearance: "system", launcher: "start" });
    render(<Launcher {...props} onNewApp={() => {}} />);
    fireEvent.change(box(), { target: { value: IDEA } });
    fireEvent.click(screen.getByRole("button", { name: "Browse the gallery" }));
    expect(assign).toHaveBeenCalledWith(GALLERY_URL);
    expect(keptIdea()).toBe(IDEA);
  });

  it("a box left as it came keeps the kept words; a cleared one keeps nothing", () => {
    vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    keepIdea(IDEA);
    render(<Launcher {...props} onNewApp={() => {}} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".k-launch-fab")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse the gallery" }));
    expect(keptIdea()).toBe(IDEA);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".k-launch-fab")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse the gallery" }));
    expect(keptIdea()).toBeUndefined();
  });
});
