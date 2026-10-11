import { describe, expect, it } from "vitest";
import { listenOn, textOfShare } from "../src/share-target.js";

// Text shared into Potyro from another app (#213), with a fake plugin.

describe("share target", () => {
  it("joins the shared texts, and ignores a share with no text", () => {
    expect(textOfShare({ title: " Plan ", texts: ["Push day", "", "Pull day "] })).toEqual({ title: "Plan", text: "Push day\n\nPull day" });
    expect(textOfShare({ texts: [] })).toBeNull();
  });

  it("hands each text share on, and stops when asked", async () => {
    let cb: ((e: { texts?: string[] }) => void) | null = null;
    let removed = false;
    const plugin = { addListener: async (_: "shareReceived", f: (e: { texts?: string[] }) => void) => ((cb = f), { remove: async () => void (removed = true) }) };
    const got: string[] = [];
    const { stop } = await listenOn(plugin, (s) => got.push(s.text));
    cb!({ texts: ["1. Bench press 4×6"] });
    cb!({ texts: [] });
    expect(got).toEqual(["1. Bench press 4×6"]);
    stop();
    expect(removed).toBe(true);
  });
});
