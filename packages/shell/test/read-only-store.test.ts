import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryStore, type Store } from "@potyro/store";
import { readOnlyStore } from "../src/read-only-store.js";

// The wrapper forwards each method by name. A method it does not know is simply missing on the
// wrapped store — and for an OPTIONAL one that is not an error anywhere: the host takes "absent" as
// "this store cannot do that" and falls back. `editText` fell through that way once: the synced
// store could merge, the wrapper said it could not, and two devices doubled the text.

/** A store with EVERY optional method present, so the wrapper has to know each one. */
class FullStore extends MemoryStore {
  increment = async () => 0;
  editText = async () => "";
  textRuns = async () => [];
  textAnchor = async () => "end";
  textIndex = async () => 0;
  recordAccess = async () => "admin" as const;
  createRecordInvite = async () => ({ entity: "doc", id: "1", group: "g", map: "m", secret: "s" });
  joinRecord = async () => null;
  subscribeBlob = () => () => {};
  blobHere = async () => true;
  spaceUsage = async () => ({ used: 0, budget: 1 });
  memberIds = () => [];
  editHistory = async () => [];
  messages = async () => [];
  subscribeMessages = () => () => {};
  postMessage = async () => ({ id: "m", thread: "t", text: "", by: "me", at: new Date() });
  kvKeys = async () => [];
  subscribeKv = () => () => {};
  putBlobWithKey = async (key: string) => ({ key, mime: "" });
}

/**
 * Every method of `Store`, read off the interface's own source: a list kept by hand went stale the
 * moment the interface grew (the record methods were forwarded nowhere, and the link could not be
 * made), and a type-level check is never compiled, since the shell's tsconfig covers `src` alone.
 */
function storeMethods(): string[] {
  const source = readFileSync(new URL("../../store/src/types.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export interface Store {"));
  const end = body.indexOf("\n}\n");
  return [...body.slice(0, end).matchAll(/^  (\w+)\??(?:<[^>]*>)?\(/gm)].map((m) => m[1]!);
}
const METHODS = storeMethods();

describe("readOnlyStore", () => {
  it("forwards every method the Store interface has, optional ones included", () => {
    expect(METHODS.length).toBeGreaterThan(30);
    expect(METHODS).toContain("joinRecord");
    const full = new FullStore() as unknown as Record<string, unknown>;
    const wrapped = readOnlyStore(full as unknown as Store, "behind") as unknown as Record<string, unknown>;
    const missing = METHODS.filter((k) => typeof full[k] === "function" && typeof wrapped[k] !== "function");
    expect(missing).toEqual([]);
  });

  it("refuses the text edits, and lets the text reads through", async () => {
    const wrapped = readOnlyStore(new FullStore() as unknown as Store, "behind");
    await expect(wrapped.editText!("doc", "1", "body", [])).rejects.toThrow("behind");
    expect(await wrapped.textRuns!("doc", "1", "body")).toEqual([]);
    expect(await wrapped.textAnchor!("doc", "1", "body", 0)).toBe("end");
    expect(await wrapped.textIndex!("doc", "1", "body", "end")).toBe(0);
  });
});
