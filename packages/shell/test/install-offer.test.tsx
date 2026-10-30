// @vitest-environment happy-dom
//
// The You panel's "Add Potyro to your home screen" row (#123): shown only when the browser offers
// installing (a faked `beforeinstallprompt` here) or on Safari for iPhone, never once installed,
// never again after "No thanks", and never as the browser's own banner.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DISMISSED_KEY,
  installOfferFor,
  isIosSafari,
  listenForInstall,
  readInstallEnv,
  resetInstallOfferForTests,
  type InstallEnv,
} from "../src/install-offer.js";
import { InstallRow } from "../src/install-row.js";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const base: InstallEnv = { standalone: false, native: false, iosSafari: false, canPrompt: false, installed: false, dismissed: false };

/** What Chromium fires: preventable, replayable once, answering with the person's choice. */
function fakePromptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

function setUserAgent(ua: string, platform = "Linux x86_64", maxTouchPoints = 0): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

function setStandalone(on: boolean): void {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query === "(display-mode: standalone)", media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  resetInstallOfferForTests();
  localStorage.clear();
  setUserAgent(ANDROID_CHROME);
  setStandalone(false);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("who is offered what", () => {
  it("offers the browser's dialog only when the browser has offered installing", () => {
    expect(installOfferFor(base)).toBeNull();
    expect(installOfferFor({ ...base, canPrompt: true })).toBe("prompt");
  });

  it("offers the two Safari steps on an iPhone, where there is no dialog to replay", () => {
    expect(installOfferFor({ ...base, iosSafari: true })).toBe("ios");
  });

  it("offers nothing once installed, inside the native app, or after No thanks", () => {
    for (const env of [
      { ...base, canPrompt: true, standalone: true },
      { ...base, iosSafari: true, standalone: true },
      { ...base, canPrompt: true, native: true },
      { ...base, canPrompt: true, installed: true },
      { ...base, canPrompt: true, dismissed: true },
      { ...base, iosSafari: true, dismissed: true },
    ]) {
      expect(installOfferFor(env)).toBeNull();
    }
  });

  it("tells Safari on iPhone and iPad from the other iOS browsers and from a Mac", () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, "MacIntel", 5)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, "MacIntel", 0)).toBe(false);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
  });

  it("reads the home-screen state from display-mode and from iOS's navigator.standalone", () => {
    setStandalone(true);
    expect(readInstallEnv(window).standalone).toBe(true);
    setStandalone(false);
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    expect(readInstallEnv(window).standalone).toBe(true);
    Object.defineProperty(window.navigator, "standalone", { value: undefined, configurable: true });
    expect(readInstallEnv(window).standalone).toBe(false);
  });
});

describe("the row in the You panel", () => {
  it("is not there until the browser offers installing, and the browser's own banner is held back", () => {
    listenForInstall(window);
    render(<InstallRow />);
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();

    const event = fakePromptEvent();
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("group", { name: "Add Potyro to your home screen" })).toBeTruthy();
    expect(screen.getByText("It opens like an app and works offline.")).toBeTruthy();
  });

  it("Add replays the browser's dialog; once accepted the row is gone and nothing is remembered as declined", async () => {
    listenForInstall(window);
    render(<InstallRow />);
    const event = fakePromptEvent("accepted");
    act(() => void window.dispatchEvent(event));

    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add" })));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it("declining the browser's dialog counts as No thanks", async () => {
    listenForInstall(window);
    render(<InstallRow />);
    act(() => void window.dispatchEvent(fakePromptEvent("dismissed")));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add" })));
    expect(localStorage.getItem(DISMISSED_KEY)).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
  });

  it("No thanks is remembered: the next visit, offered again by the browser, shows nothing", () => {
    listenForInstall(window);
    render(<InstallRow />);
    act(() => void window.dispatchEvent(fakePromptEvent()));
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
    cleanup();

    // A new page load: fresh module state, the browser offers again.
    resetInstallOfferForTests();
    listenForInstall(window);
    render(<InstallRow />);
    const again = fakePromptEvent();
    act(() => void window.dispatchEvent(again));
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
  });

  it("is gone when the app gets installed from the browser's own menu", () => {
    listenForInstall(window);
    render(<InstallRow />);
    act(() => void window.dispatchEvent(fakePromptEvent()));
    expect(screen.getByRole("group", { name: "Add Potyro to your home screen" })).toBeTruthy();
    act(() => void window.dispatchEvent(new Event("appinstalled")));
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
  });

  it("is not shown on the home screen even if the browser offers", () => {
    setStandalone(true);
    listenForInstall(window);
    render(<InstallRow />);
    act(() => void window.dispatchEvent(fakePromptEvent()));
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
  });

  it("on Safari for iPhone says the two steps, with no button that could not work", () => {
    setUserAgent(IPHONE_SAFARI, "iPhone", 5);
    listenForInstall(window);
    render(<InstallRow />);
    expect(screen.getByRole("group", { name: "Add Potyro to your home screen" })).toBeTruthy();
    expect(screen.getByText(/Tap Share, then “Add to Home Screen”/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
  });

  it("still works when the browser refuses storage: No thanks holds for this visit", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      listenForInstall(window);
      render(<InstallRow />);
      act(() => void window.dispatchEvent(fakePromptEvent()));
      expect(screen.getByRole("group", { name: "Add Potyro to your home screen" })).toBeTruthy();
      expect(() => fireEvent.click(screen.getByRole("button", { name: "No thanks" }))).not.toThrow();
      expect(screen.queryByRole("group", { name: "Add Potyro to your home screen" })).toBeNull();
    } finally {
      spy.mockRestore();
      set.mockRestore();
    }
  });
});
