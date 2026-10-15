import { describe, expect, it, vi } from "vitest";
import type { LiveCameraStop } from "potyro";
import { createFakeLiveCamera, failureOf, liveConstraints } from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("liveConstraints", () => {
  it("asks for video only, the selfie camera and 640×480 by default", () => {
    expect(liveConstraints()).toEqual({
      audio: false,
      video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  });
  it("clamps sizes and refuses facings it does not know", () => {
    const c = liveConstraints({ facing: "environment", width: 99_999, height: 3 });
    expect(c.video).toEqual({ facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 160 } });
    expect((liveConstraints({ facing: "sideways" as "user" }).video as { facingMode: unknown }).facingMode).toEqual({ ideal: "user" });
    expect((liveConstraints({ width: Number.NaN }).video as { width: unknown }).width).toEqual({ ideal: 640 });
  });
});

describe("failureOf", () => {
  it("sorts the browser's refusals into the five codes an app handles", () => {
    const named = (name: string) => failureOf(Object.assign(new Error("x"), { name })).code;
    expect(named("NotAllowedError")).toBe("denied");
    expect(named("SecurityError")).toBe("denied");
    expect(named("NotFoundError")).toBe("missing");
    expect(named("OverconstrainedError")).toBe("missing");
    expect(named("NotReadableError")).toBe("busy");
    expect(named("TypeError")).toBe("failed");
    expect(failureOf("nonsense").code).toBe("failed");
  });
});

describe("the live camera", () => {
  it("starts the camera, reports its size and facing, and tells the watchers", async () => {
    const fake = createFakeLiveCamera({ size: { width: 1280, height: 720 } });
    const seen: unknown[] = [];
    fake.cap.subscribe((on) => seen.push(on));
    const cam = await fake.cap.start({ facing: "environment" });
    expect(cam.active).toBe(true);
    expect([cam.width, cam.height, cam.facing]).toEqual([1280, 720, "environment"]);
    expect(cam.video.muted).toBe(true);
    expect(fake.asked).toHaveLength(1);
    expect(fake.cap.current()).toBe(cam);
    expect(seen).toEqual([null, cam]);
  });

  it("calls onFrame once per new frame, only while someone listens, and keeps going past a throwing listener", async () => {
    const fake = createFakeLiveCamera();
    const cam = await fake.cap.start();
    const video = fake.videos[0]!;
    expect(video.waiting).toBe(0); // nobody listens: no frame loop
    const frames: number[] = [];
    const boom = vi.fn(() => {
      throw new Error("app bug");
    });
    const errors: unknown[] = [];
    const onErr = (e: unknown) => errors.push(e);
    process.on("uncaughtException", onErr);
    const offBoom = cam.onFrame(boom);
    const off = cam.onFrame((_v, info) => frames.push(info.width));
    expect(video.waiting).toBe(1); // one loop for every listener
    video.frame();
    video.frame();
    await tick();
    process.off("uncaughtException", onErr);
    expect(frames).toEqual([640, 640]);
    expect(boom).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2); // reported, not swallowed
    off();
    offBoom();
    video.frame();
    expect(frames).toHaveLength(2);
    expect(video.waiting).toBe(0);
  });

  it("snap() is the current frame as a picture, and refuses once stopped", async () => {
    const fake = createFakeLiveCamera();
    const cam = await fake.cap.start();
    const blob = await cam.snap({ type: "image/png" });
    expect(blob.type).toBe("image/png");
    expect((await cam.snap()).type).toBe("image/jpeg");
    cam.stop();
    await expect(cam.snap()).rejects.toMatchObject({ code: "failed" });
  });

  it("stop() stops every track, tells onStop once with the reason, and clears the indicator", async () => {
    const fake = createFakeLiveCamera();
    const cam = await fake.cap.start();
    const why: LiveCameraStop[] = [];
    const seen: unknown[] = [];
    fake.cap.subscribe((on) => seen.push(on));
    cam.onStop((w) => why.push(w));
    cam.stop();
    cam.stop();
    expect(fake.tracks[0]!.stopped).toBe(true);
    expect(cam.active).toBe(false);
    expect(cam.video.srcObject).toBeNull();
    expect(why).toEqual(["app"]);
    expect(fake.cap.current()).toBeNull();
    expect(seen).toEqual([cam, null]);
    expect(cam.onFrame(() => undefined)).toBeTypeOf("function"); // harmless on a stopped camera
  });

  it("stops when the page is hidden, and never starts while it is", async () => {
    const fake = createFakeLiveCamera();
    const cam = await fake.cap.start();
    const why: LiveCameraStop[] = [];
    cam.onStop((w) => why.push(w));
    fake.setHidden(true);
    expect(why).toEqual(["hidden"]);
    expect(fake.tracks[0]!.stopped).toBe(true);
    await expect(fake.cap.start()).rejects.toMatchObject({ code: "hidden" });
    expect(fake.asked).toHaveLength(1); // the browser was not even asked
    // Visible again: it stays off until the app starts it again.
    fake.setHidden(false);
    expect(fake.cap.current()).toBeNull();
    expect((await fake.cap.start()).active).toBe(true);
  });

  it("stops when the page goes away, when the device ends the track, and when the shell says so", async () => {
    const fake = createFakeLiveCamera();
    const why: LiveCameraStop[] = [];
    (await fake.cap.start()).onStop((w) => why.push(w));
    fake.close();
    (await fake.cap.start()).onStop((w) => why.push(w));
    fake.tracks[1]!.end();
    (await fake.cap.start()).onStop((w) => why.push(w));
    fake.cap.stopAll("person");
    expect(why).toEqual(["closed", "ended", "person"]);
    expect(fake.tracks.every((t) => t.readyState === "ended")).toBe(true);
    expect(fake.cap.current()).toBeNull();
  });

  it("one session at a time: a second start replaces the first before asking for the camera", async () => {
    const fake = createFakeLiveCamera();
    const first = await fake.cap.start({ facing: "user" });
    const why: LiveCameraStop[] = [];
    first.onStop((w) => why.push(w));
    const second = await fake.cap.start({ facing: "environment" });
    expect(why).toEqual(["replaced"]);
    expect(fake.tracks[0]!.stopped).toBe(true);
    expect(second.active).toBe(true);
    expect(fake.cap.current()).toBe(second);
  });

  it("a start still waiting on the prompt does not light up after the person left", async () => {
    const fake = createFakeLiveCamera();
    const held = fake.holdNext();
    const pending = fake.cap.start();
    fake.cap.stopAll("closed");
    held.release();
    await expect(pending).rejects.toMatchObject({ code: "failed" });
    expect(fake.tracks[0]!.stopped).toBe(true);
    expect(fake.cap.current()).toBeNull();
  });

  it("a start that finishes after the page was hidden stops its stream and says hidden", async () => {
    const fake = createFakeLiveCamera();
    const held = fake.holdNext();
    const pending = fake.cap.start();
    fake.setHidden(true);
    held.release();
    await expect(pending).rejects.toMatchObject({ code: "hidden" });
    expect(fake.tracks[0]!.stopped).toBe(true);
  });

  it("a refusal rejects with its code and leaves nothing running", async () => {
    const fake = createFakeLiveCamera({ refuse: "NotAllowedError" });
    await expect(fake.cap.start()).rejects.toMatchObject({ code: "denied" });
    expect(fake.cap.current()).toBeNull();
    fake.refuseNext("NotReadableError");
    await expect(fake.cap.start()).rejects.toMatchObject({ code: "busy" });
  });
});
