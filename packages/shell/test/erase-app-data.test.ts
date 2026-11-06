// @vitest-environment happy-dom
//
// Deleting an app deletes its data on this device — what the question promises ("This deletes the
// app AND its data"). It used to leave the database and the space ids behind, so the same app
// added again opened on the dead one's records, and a link to the app put the device straight back
// into the space it had just left.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appClosed, appOpened, appStorageKeys, eraseAppData, settleOwed } from "../src/erase-app-data.js";

const noOpfs = () => Promise.reject(new Error("no OPFS"));

beforeEach(() => localStorage.clear());

describe("erasing an app's data", () => {
  it("removes the database under the app's namespace", async () => {
    const deleteDatabase = vi.fn(async () => undefined);
    await eraseAppData("notes", { deleteDatabase, opfsRoot: noOpfs });
    expect(deleteDatabase).toHaveBeenCalledWith("user:notes");
    expect(localStorage.getItem("potyro:erase-owed")).toBeNull();
  });

  it("forgets the localStorage copy, where the database lived, and the space it synced through", async () => {
    for (const key of appStorageKeys("user:notes")) localStorage.setItem(key, "x");
    localStorage.setItem("potyro:jazz:group:user:other", "keep");
    localStorage.setItem("potyro:user-apps", "keep");
    await eraseAppData("notes", { deleteDatabase: async () => undefined, opfsRoot: noOpfs });
    for (const key of appStorageKeys("user:notes")) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("potyro:jazz:group:user:other")).toBe("keep");
    expect(localStorage.getItem("potyro:user-apps")).toBe("keep");
  });

  it("names every key the store and the shell write per namespace", () => {
    expect(appStorageKeys("user:notes")).toEqual([
      "potyro:user:notes",
      "potyro:moved:user:notes",
      "potyro:store-home:user:notes",
      "potyro:jazz:group:user:notes",
      "potyro:jazz:root:user:notes",
      "potyro:jazz:db:user:notes",
    ]);
  });

  it("leaves the file of an app that is open in this tab until the app closes", async () => {
    // The Studio deletes an app from inside it: the store is still answering the screen.
    const deleteDatabase = vi.fn(async () => undefined);
    appOpened("notes");
    await eraseAppData("notes", { deleteDatabase, opfsRoot: noOpfs });
    expect(deleteDatabase).not.toHaveBeenCalled();
    // The keys are gone already, and the file is written down as owed.
    expect(localStorage.getItem("potyro:store-home:user:notes")).toBeNull();
    expect(JSON.parse(localStorage.getItem("potyro:erase-owed")!)).toEqual(["notes"]);

    await appClosed("notes", { deleteDatabase, opfsRoot: noOpfs });
    expect(deleteDatabase).toHaveBeenCalledWith("user:notes");
    expect(localStorage.getItem("potyro:erase-owed")).toBeNull();
  });

  it("settles at boot what a tab left owed", async () => {
    localStorage.setItem("potyro:erase-owed", JSON.stringify(["notes", "plants"]));
    const deleteDatabase = vi.fn(async () => undefined);
    await settleOwed({ deleteDatabase, opfsRoot: noOpfs });
    expect(deleteDatabase.mock.calls.map((c) => c[0])).toEqual(["user:notes", "user:plants"]);
    expect(localStorage.getItem("potyro:erase-owed")).toBeNull();
  });

  it("removes the per-app OPFS directory older builds kept, and shrugs when there is none", async () => {
    const removed: string[] = [];
    const root = async () => ({
      getDirectoryHandle: async (name: string) => {
        expect(name).toBe("potyro");
        return { removeEntry: async (entry: string) => void removed.push(entry) };
      },
    });
    await eraseAppData("notes", { deleteDatabase: async () => undefined, opfsRoot: root });
    expect(removed).toEqual(["user:notes"]);
    await expect(eraseAppData("notes", { deleteDatabase: async () => undefined, opfsRoot: noOpfs })).resolves.toBeUndefined();
  });

  it("keeps the file owed when it cannot be removed, says so, and still forgets the keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem("potyro:jazz:group:user:notes", "x");
    const deleteDatabase = async () => {
      throw new Error("another tab has the storage");
    };
    await eraseAppData("notes", { deleteDatabase, opfsRoot: noOpfs });
    expect(localStorage.getItem("potyro:jazz:group:user:notes")).toBeNull();
    expect(JSON.parse(localStorage.getItem("potyro:erase-owed")!)).toEqual(["notes"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not remove the database of "notes"'), expect.any(Error));
    warn.mockRestore();
  });
});
