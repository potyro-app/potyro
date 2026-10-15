// @vitest-environment happy-dom
//
// When an app's database cannot be opened, a stand-in store is NOT opened in its place unless the
// browser simply has no storage for it. A second tab used to get a fresh localStorage store while the
// first held the database: the app opened there without its records and its shipped files ("No file
// levels.json in this app"), and whatever it wrote was stranded.
import { beforeEach, describe, expect, it } from "vitest";
import { mayFallBack, StoreBusyError } from "../src/open-store.js";

const HELD = new Error("Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.");

beforeEach(() => localStorage.clear());

describe("falling back to another store", () => {
  it("never when the database is held by someone else (another tab)", () => {
    expect(mayFallBack("user:breakout", HELD)).toBe(false);
    const named = new Error("An attempt was made to modify an object where modifications are not allowed.");
    named.name = "NoModificationAllowedError";
    expect(mayFallBack("user:breakout", named)).toBe(false);
  });

  it("never for an app whose database this device has already opened in the worker, whatever the error", () => {
    localStorage.setItem("potyro:store-home:user:breakout", "worker");
    expect(mayFallBack("user:breakout", new Error("this worker has no OPFS SAH-pool VFS"))).toBe(false);
    expect(mayFallBack("user:other", new Error("this worker has no OPFS SAH-pool VFS"))).toBe(true);
  });

  it("still where the browser has no storage for the worker at all", () => {
    expect(mayFallBack("user:breakout", new Error("SecurityError: the storage is not available in a private window"))).toBe(true);
  });

  it("says so in words, naming the other tab", () => {
    const e = new StoreBusyError("user:breakout", HELD);
    expect(e.message).toMatch(/open in another Potyro tab or window/);
    expect(e.cause).toBe(HELD);
  });
});
