// The share sheet's ways out (docs/24 §1, §8): each chat's own share address, and how — or whether —
// this browser can record a clip.
import { describe, expect, it } from "vitest";
import { networkLinks, TELEGRAM_MAX } from "../src/share-networks.js";
import { clipWay, pickMime } from "../src/clip.js";

describe("network links", () => {
  it("WhatsApp and Telegram, with the words and the link encoded", () => {
    const link = "https://apps.example/s/AbCdEfGhIjKlMnOpQrStUv#k=key_-123";
    const nets = networkLinks(link, "Try Groceries & more");
    expect(nets.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(`Try Groceries & more ${link}`)}`);
    const tg = new URL(nets.telegram!);
    expect(tg.origin + tg.pathname).toBe("https://t.me/share/url");
    expect(tg.searchParams.get("url")).toBe(link);
    expect(tg.searchParams.get("text")).toBe("Try Groceries & more");
  });

  it("no Telegram for a link longer than a Telegram message", () => {
    expect(networkLinks(`https://a.example/#try=${"x".repeat(TELEGRAM_MAX)}`, "Try").telegram).toBeUndefined();
  });
});

describe("clips", () => {
  it("a canvas is recorded straight; else the tab; else it says it cannot", () => {
    expect(clipWay({ hasMediaRecorder: true, canvas: true, hasDisplayMedia: true })).toBe("canvas");
    expect(clipWay({ hasMediaRecorder: true, canvas: false, hasDisplayMedia: true })).toBe("tab");
    expect(clipWay({ hasMediaRecorder: true, canvas: false, hasDisplayMedia: false })).toBe("none");
    expect(clipWay({ hasMediaRecorder: false, canvas: true, hasDisplayMedia: true })).toBe("none");
  });

  it("MP4 where the browser writes it, else WebM, else none", () => {
    expect(pickMime((t) => t.startsWith("video/mp4"))).toEqual({ mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" });
    expect(pickMime((t) => t === "video/webm")).toEqual({ mime: "video/webm", ext: "webm" });
    expect(pickMime(() => false)).toBeNull();
  });
});
