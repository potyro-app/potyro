// @vitest-environment happy-dom
//
// A sealed app that was open when a tab died or froze is not started again by itself (#90): the
// browser, not Potyro, ends a tab whose shared app keeps memory without end, and a reload would open
// the same app into the same thing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewGuard } from "@potyro/host/realm";
import { OPEN_FORGET_MS, OPEN_MARK_PREFIX, OPEN_OFF_KEY, sealedOpenPaused, startSealedAgain, watchSealedOpen } from "../src/sealed-open-guard.js";
import { SEALED_OPEN_OFF, eraseAppData } from "../src/erase-app-data.js";

const marks = (): string[] => Object.keys(localStorage).filter((k) => k.startsWith(OPEN_MARK_PREFIX));

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("the marker of an open sealed app", () => {
  it("is there while the app is open and gone when it is put away", () => {
    const stop = watchSealedOpen("notes");
    expect(marks()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(marks()[0]!)!)).toMatchObject({ app: "notes" });
    stop();
    expect(marks()).toEqual([]);
    expect(sealedOpenPaused("notes")).toBe(false);
  });

  it("is kept fresh by the tab's own timer", () => {
    vi.useFakeTimers();
    const stop = watchSealedOpen("notes");
    const at = () => Number((JSON.parse(localStorage.getItem(marks()[0]!)!) as { at: number }).at);
    const first = at();
    vi.advanceTimersByTime(2500);
    expect(at()).toBeGreaterThan(first);
    stop();
  });

  it("is taken away while the page is off screen, and put back when it shows again", () => {
    const stop = watchSealedOpen("notes");
    const hide = (is: boolean): void => void Object.defineProperty(document, "hidden", { configurable: true, get: () => is });
    hide(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(marks()).toEqual([]);
    hide(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(marks()).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(marks()).toEqual([]);
    stop();
    delete (document as { hidden?: boolean }).hidden;
  });
});

describe("a tab that died with a sealed app open", () => {
  /** What a dead tab leaves: its marker, last refreshed a while ago. */
  const deadTab = (app: string, ago = 60_000): void =>
    localStorage.setItem(`${OPEN_MARK_PREFIX}deadtab:1`, JSON.stringify({ app, page: "app", at: Date.now() - ago }));

  it("pauses that app, and only that app, until the person starts it", () => {
    deadTab("notes");
    expect(sealedOpenPaused("other")).toBe(false);
    expect(sealedOpenPaused("notes")).toBe(true);
    expect(marks()).toEqual([]); // read once, then it is the note that counts
    expect(sealedOpenPaused("notes")).toBe(true);
    startSealedAgain("notes");
    expect(sealedOpenPaused("notes")).toBe(false);
    expect(localStorage.getItem(OPEN_OFF_KEY)).toBeNull();
  });

  it("does not count a marker from long ago: a power cut, a sleep, a restart with the app merely on screen", () => {
    deadTab("notes", OPEN_FORGET_MS + 1000);
    expect(sealedOpenPaused("notes")).toBe(false);
    expect(marks()).toEqual([]); // and it is not kept to be counted later
  });

  it("is not left by a page that is frozen", () => {
    const stop = watchSealedOpen("notes");
    document.dispatchEvent(new Event("freeze"));
    expect(marks()).toEqual([]);
    document.dispatchEvent(new Event("resume"));
    expect(marks()).toHaveLength(1);
    stop();
  });

  it("does not take another tab that is alive for a dead one", () => {
    deadTab("notes", 500);
    expect(sealedOpenPaused("notes")).toBe(false);
  });

  it("keeps its own keys: a sealed screen's guard does not read them, nor it the screens'", () => {
    deadTab("notes");
    const screens = new ViewGuard();
    expect(screens.isOff("notes")).toBe(false);
    expect(sealedOpenPaused("notes")).toBe(true);
    localStorage.setItem("potyro:sealed-view:off", JSON.stringify({ board: { page: "p", at: 1, why: "" } }));
    expect(sealedOpenPaused("board")).toBe(false);
  });

  it("is forgotten with the app when the app is deleted", async () => {
    expect(SEALED_OPEN_OFF).toBe(OPEN_OFF_KEY);
    deadTab("notes");
    sealedOpenPaused("notes");
    localStorage.setItem(OPEN_OFF_KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(OPEN_OFF_KEY)!) as object), other: { page: "app", at: 1, why: "" } }));
    await eraseAppData("notes", { deleteDatabase: async () => undefined, opfsRoot: () => Promise.reject(new Error("no OPFS")) });
    expect(sealedOpenPaused("notes")).toBe(false);
    expect(sealedOpenPaused("other")).toBe(true);
  });

  it("leaves no marker behind for a deleted app's id either", async () => {
    deadTab("notes");
    localStorage.setItem(`${OPEN_MARK_PREFIX}deadtab:2`, JSON.stringify({ app: "other", page: "app", at: Date.now() - 60_000 }));
    await eraseAppData("notes", { deleteDatabase: async () => undefined, opfsRoot: () => Promise.reject(new Error("no OPFS")) });
    expect(sealedOpenPaused("notes")).toBe(false);
    expect(sealedOpenPaused("other")).toBe(true);
  });
});
