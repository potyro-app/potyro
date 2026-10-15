// @vitest-environment happy-dom
// The shell's "Camera on" (docs/25): there whenever the live camera runs, gone when it stops, and not
// the app's to take away.

import { describe, expect, it } from "vitest";
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
});
