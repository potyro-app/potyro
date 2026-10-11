// @vitest-environment happy-dom
//
// Moving an app out of localStorage without losing it.
//
// Every local-only app has been writing to localStorage, because the OPFS path it was meant to use
// could never open on the main thread. Switching those apps to a real database is therefore a
// migration, not a swap: without this the app would open empty and years of notes would sit in a
// key that nothing reads any more.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { adoptLocalStorageData } from "../src/open-store.js";

const NS = "user:notes";
const now = "2026-09-18T12:00:00.000Z";

const stored = (records: Record<string, Record<string, unknown>>) =>
  JSON.stringify({ records, blobs: {}, kv: {} });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

async function target(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.open("notes");
  return store;
}

describe("adopting what an app left in localStorage", () => {
  it("brings the records across, ids and dates intact", async () => {
    localStorage.setItem(
      `potyro:${NS}`,
      stored({ note: { n1: { id: "n1", title: "Buy stamps", createdAt: now, updatedAt: now } } }),
    );
    const store = await target();

    await adoptLocalStorageData(store, NS);

    const rows = await store.all("note");
    expect(rows).toHaveLength(1);
    // The id matters as much as the text: relations and history point at it.
    expect(rows[0]).toMatchObject({ id: "n1", title: "Buy stamps", createdAt: now });
  });

  it("does it once, however many times the app is opened", async () => {
    localStorage.setItem(`potyro:${NS}`, stored({ note: { n1: { id: "n1", title: "Buy stamps", createdAt: now, updatedAt: now } } }));
    const store = await target();

    await adoptLocalStorageData(store, NS);
    await adoptLocalStorageData(store, NS);
    await adoptLocalStorageData(store, NS);

    expect(await store.all("note")).toHaveLength(1);
    expect(localStorage.getItem(`potyro:moved:${NS}`)).toBeTruthy();
  });

  it("leaves the old copy where it is", async () => {
    // Until someone is sure the move worked, that key is the only copy of their data.
    const raw = stored({ note: { n1: { id: "n1", title: "Buy stamps", createdAt: now, updatedAt: now } } });
    localStorage.setItem(`potyro:${NS}`, raw);
    await adoptLocalStorageData(await target(), NS);

    expect(localStorage.getItem(`potyro:${NS}`)).toBe(raw);
  });

  it("does nothing for an app that never wrote there", async () => {
    const store = await target();
    await adoptLocalStorageData(store, NS);
    expect(await store.all("note")).toHaveLength(0);
    // And nothing is marked: an app with nothing to move has not been moved.
    expect(localStorage.getItem(`potyro:moved:${NS}`)).toBeNull();
  });

  it("does not choke on a key holding something it did not write", async () => {
    localStorage.setItem(`potyro:${NS}`, "not json at all");
    const store = await target();
    await expect(adoptLocalStorageData(store, NS)).resolves.toBeUndefined();
    expect(await store.all("note")).toHaveLength(0);
  });
});
