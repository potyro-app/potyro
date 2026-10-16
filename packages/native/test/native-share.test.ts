import { describe, expect, it } from "vitest";
import { nativeShare, type FilesystemPlugin } from "../src/capacitor-capabilities.js";

// The phone's share sheet (@capacitor/share) behind `ShareCap`: what the share dialog's "Share…"
// hands it on Android and iOS, where the WebView has no `navigator.share`.

describe("the phone's share sheet", () => {
  it("writes each file to the cache and hands the sheet their file:// URLs, with the words and the link", async () => {
    const writes: Array<{ path: string; data: string; directory: string }> = [];
    const shared: unknown[] = [];
    const fs: FilesystemPlugin = {
      writeFile: async (o) => {
        writes.push(o);
        return { uri: `file:///cache/${o.path}` };
      },
    };
    const share = nativeShare({ share: async (o) => void shared.push(o) }, fs, async (b) => `b64:${b.size}`);
    expect(share.canShare({ files: [new File(["x"], "a.png")] })).toBe(true);
    await share.share({
      title: "Snap",
      text: "Look",
      url: "https://example.org/",
      files: [new File(["abc"], "snap 1.png", { type: "image/png" }), new File(["de"], "..\\evil:x.txt")],
    });
    expect(writes.map((w) => w.directory)).toEqual(["CACHE", "CACHE"]);
    expect(writes[0]!.data).toBe("b64:3");
    // Nothing in a name can lead the file out of its share folder.
    expect(writes.every((w) => /^potyro-share\/\d+\/\d-[^/\\:]+$/.test(w.path))).toBe(true);
    expect(shared).toEqual([{ title: "Snap", dialogTitle: "Snap", text: "Look", url: "https://example.org/", files: writes.map((w) => `file:///cache/${w.path}`) }]);
  });

  it("words alone go without touching the disk", async () => {
    const writes: unknown[] = [];
    const shared: unknown[] = [];
    const share = nativeShare({ share: async (o) => void shared.push(o) }, { writeFile: async (o) => (writes.push(o), { uri: "x" }) }, async () => "");
    await share.share({ text: "Daily #12 4/6" });
    expect(writes).toEqual([]);
    expect(shared).toEqual([{ text: "Daily #12 4/6" }]);
  });

  it("backing out of the sheet is an AbortError, not a failure; anything else is passed on", async () => {
    const fs: FilesystemPlugin = { writeFile: async () => ({ uri: "file:///x" }) };
    const cancelled = nativeShare({ share: () => Promise.reject(new Error("Share canceled")) }, fs, async () => "");
    await expect(cancelled.share({ text: "hi" })).rejects.toMatchObject({ name: "AbortError" });
    const broken = nativeShare({ share: () => Promise.reject(new Error("No app can handle this")) }, fs, async () => "");
    await expect(broken.share({ text: "hi" })).rejects.toThrow("No app can handle this");
  });
});
