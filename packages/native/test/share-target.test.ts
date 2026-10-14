import { describe, expect, it } from "vitest";
import { filesOfShare, isOpenedFile, listenOn, nameFromUri, readSharedFile, textOfShare } from "../src/share-target.js";

// Text and files shared into Potyro from another app (#213, #254), with a fake plugin.

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

  it("lists the files of a share, by name and type", () => {
    expect(filesOfShare({ files: [{ uri: "/cache/shared_files/notes.md", name: "notes.md", mimeType: "text/markdown" }, { uri: "", name: "x", mimeType: "" }] })).toEqual([
      { uri: "/cache/shared_files/notes.md", name: "notes.md", mimeType: "text/markdown" },
    ]);
    expect(filesOfShare({ texts: ["hi"] })).toEqual([]);
  });

  it("hands a share with files to the files listener — its text is only their caption", async () => {
    let cb: ((e: { texts?: string[]; files?: Array<{ uri: string; name: string; mimeType: string }> }) => void) | null = null;
    const plugin = { addListener: async (_: "shareReceived", f: typeof cb & object) => ((cb = f), { remove: async () => {} }) };
    const texts: string[] = [];
    const files: string[][] = [];
    await listenOn(plugin, (s) => texts.push(s.text), (f) => files.push(f.map((x) => x.name)));
    cb!({ texts: ["look at this"], files: [{ uri: "/c/a.md", name: "a.md", mimeType: "text/markdown" }] });
    cb!({ texts: ["just text"] });
    expect(files).toEqual([["a.md"]]);
    expect(texts).toEqual(["just text"]);
  });

  it("reads a shared file through the WebView's own address for it", async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return new Response("# hi", { headers: { "content-type": "text/plain" } });
    };
    const file = await readSharedFile({ uri: "/data/cache/shared_files/a.md", name: "a.md", mimeType: "text/markdown" }, { convert: (u) => `http://localhost/_capacitor_file_${u.replace(/^file:\/\//, "")}`, fetch: fetcher });
    expect(seen).toEqual(["http://localhost/_capacitor_file_/data/cache/shared_files/a.md"]);
    expect(file.name).toBe("a.md");
    expect(file.type).toBe("text/markdown");
    expect(await file.text()).toBe("# hi");
  });

  it("knows a file opened with Potyro from an invite link, and names it from its address", () => {
    expect(isOpenedFile("content://com.android.providers.downloads.documents/document/notes%20week.md")).toBe(true);
    expect(isOpenedFile("file:///sdcard/Download/a.md")).toBe(true);
    expect(isOpenedFile("https://apps.vaz.io/#join=abc")).toBe(false);
    expect(nameFromUri("content://x/document/notes%20week.md")).toBe("notes week.md");
    expect(nameFromUri("content://x/document/raw%3A%2Fstorage%2Fa.json")).toBe("a.json");
    expect(nameFromUri("content://x/document/1234")).toBe("1234");
  });
});
