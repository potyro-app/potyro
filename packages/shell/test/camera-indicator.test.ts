// @vitest-environment happy-dom
// The shell's "Camera on" (docs/25): there whenever the live camera runs, gone when it stops, and not
// the app's to take away.

import { describe, expect, it, vi } from "vitest";
import { createFakeLiveCamera } from "@potyro/capabilities";
import { watchLiveCamera } from "../src/camera-indicator.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const sign = () => document.querySelector<HTMLElement>(".k-camera-on");

describe("the camera-on indicator", () => {
  it("shows while the camera runs and goes when it stops", async () => {
    const live = createFakeLiveCamera();
    const stop = watchLiveCamera(live.cap);
    expect(sign()).toBeNull();
    const cam = await live.cap.start();
    expect(sign()).not.toBeNull();
    expect(sign()!.getAttribute("role")).toBe("status");
    expect(sign()!.textContent).toContain("Camera on");
    cam.stop();
    expect(sign()).toBeNull();
    stop();
  });

  it("Turn off stops the camera for the person, and the app hears why", async () => {
    const live = createFakeLiveCamera();
    const stop = watchLiveCamera(live.cap);
    const cam = await live.cap.start();
    const why: string[] = [];
    cam.onStop((w) => why.push(w));
    sign()!.querySelector("button")!.click();
    expect(why).toEqual(["person"]);
    expect(cam.active).toBe(false);
    expect(live.tracks[0]!.stopped).toBe(true);
    expect(sign()).toBeNull();
    stop();
  });

  it("is put back when an app removes, hides or restyles it", async () => {
    const live = createFakeLiveCamera();
    const stop = watchLiveCamera(live.cap);
    await live.cap.start();
    sign()!.remove();
    await flush();
    expect(sign()).not.toBeNull();
    sign()!.hidden = true;
    await flush();
    expect(sign()!.hidden).toBe(false);
    sign()!.style.display = "none";
    await flush();
    expect(sign()!.getAttribute("style")).toBeNull();
    // An overlay the app adds later does not end up over it: the sign stays the last thing on the page.
    document.body.append(document.createElement("div"));
    await flush();
    expect(document.body.lastElementChild).toBe(sign());
    live.cap.stopAll("app");
    stop();
  });

  it("says how much of the top of the app's screen it covers, as --k-chrome-top, and gives it back when it goes", async () => {
    // A phone: the app's top bar ends at 56px; the sign sits under it and is 36px tall.
    const bar = document.createElement("header");
    bar.className = "k-topbar";
    document.body.append(bar);
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("k-topbar")) return { top: 0, bottom: 56, height: 56, left: 0, right: 400, width: 400, x: 0, y: 0 } as DOMRect;
      if (this.classList.contains("k-camera-on")) return { top: 64, bottom: 100, height: 36, left: 250, right: 390, width: 140, x: 250, y: 64 } as DOMRect;
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0 } as DOMRect;
    });
    const live = createFakeLiveCamera();
    const stop = watchLiveCamera(live.cap);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--k-chrome-top")).toBe("");
    const cam = await live.cap.start();
    // 100 (where the sign ends) − 56 (where the app's screen starts) + 8 to spare.
    expect(root.getPropertyValue("--k-chrome-top")).toBe("52px");
    cam.stop();
    expect(root.getPropertyValue("--k-chrome-top")).toBe("");
    stop();
    rects.mockRestore();
    bar.remove();
  });
});
