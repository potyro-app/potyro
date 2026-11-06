import { describe, expect, it } from "vitest";
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

/** Every method of `Store`. The type below fails to compile when the interface gains one this list lacks. */
const METHODS = [
  "open", "close", "describe", "all", "get", "byIndex", "insert", "update", "delete", "increment",
  "editText", "textRuns", "textAnchor", "textIndex", "transaction", "subscribe", "putBlob", "putBlobWithKey",
  "getBlob", "subscribeBlob", "blobHere", "spaceUsage", "deleteBlob", "listFiles", "getFile", "setFile",
  "deleteFile", "subscribeFiles", "kvGet", "kvSet", "kvDelete", "kvKeys", "subscribeKv", "memberIds",
  "storedSchemaVersion", "runMigrations", "editHistory", "messages", "subscribeMessages", "postMessage",
] as const satisfies readonly (keyof Store)[];
type Listed = (typeof METHODS)[number];
type Unlisted = Exclude<keyof Store, Listed>;
const everyMethodListed: Unlisted extends never ? true : Unlisted = true;

describe("readOnlyStore", () => {
  it("forwards every method the Store interface has, optional ones included", () => {
    expect(everyMethodListed).toBe(true);
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
