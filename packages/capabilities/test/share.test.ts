import { describe, expect, it } from "vitest";
import { webShare } from "../src/index.js";

// The Web Share API behind `ShareCap` (docs/04 §Share): files go only where `canShare({ files })` says.

const file = () => new File([new Uint8Array([137, 80, 78, 71])], "card.png", { type: "image/png" });

describe("webShare", () => {
  it("offers nothing where the browser has no share sheet (desktop Firefox)", async () => {
    const share = webShare(() => ({}) as Navigator);
    expect(share.canShare({ text: "hi" })).toBe(false);
    expect(share.canShare({ files: [file()] })).toBe(false);
    await expect(share.share({ text: "hi" })).rejects.toMatchObject({ name: "NotSupportedError" });
  });

  it("words always, files only where canShare({ files }) says yes", () => {
    const words = webShare(() => ({ share: async () => undefined }) as unknown as Navigator);
    expect(words.canShare({ text: "hi", url: "https://example.org/" })).toBe(true);
    expect(words.canShare({ files: [file()] })).toBe(false); // no canShare at all: no files
    const no = webShare(() => ({ share: async () => undefined, canShare: (d: ShareData) => !d.files }) as unknown as Navigator);
    expect(no.canShare({ files: [file()] })).toBe(false);
    const yes = webShare(() => ({ share: async () => undefined, canShare: () => true }) as unknown as Navigator);
    expect(yes.canShare({ files: [file()] })).toBe(true);
    const throws = webShare(() => ({ share: async () => undefined, canShare: () => { throw new TypeError("bad"); } }) as unknown as Navigator);
    expect(throws.canShare({ files: [file()] })).toBe(false);
  });

  it("hands the sheet only what is there", async () => {
    const seen: ShareData[] = [];
    const share = webShare(() => ({ share: async (d: ShareData) => void seen.push(d), canShare: () => true }) as unknown as Navigator);
    const f = file();
    await share.share({ title: "Card", files: [f] });
    await share.share({ text: "Daily #1" });
    expect(seen).toEqual([{ title: "Card", files: [f] }, { text: "Daily #1" }]);
  });
});
