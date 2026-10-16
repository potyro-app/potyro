// Placeholder people — guests (docs/04 §Guests). What carries the design, pinned:
//
//   - The rules are applied when the log is READ, so a copy that wrote past them changes nothing:
//     a rename by someone who did not add the guest, a second claim, a claim of a claimed guest.
//   - In a shared app the author is the SIGNING account, never a field — so "Ana claimed Tom" cannot
//     be written by anyone but Ana.
//   - Guests move with the app when it starts syncing, claims included.

import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  claimOf,
  copyStoreData,
  createPeerPair,
  finalPerson,
  foldPeople,
  openGuests,
  readPeople,
  writePeople,
  PEOPLE_THREAD,
  type PeopleOp,
  type PeopleOpInput,
} from "../src/index.js";

const at = (n: number): Date => new Date(Date.UTC(2026, 9, 16, 12, 0, n));
const op = (o: PeopleOpInput & { by: string }, n: number): PeopleOp => ({ ...o, at: at(n) }) as PeopleOp;

describe("folding the log", () => {
  it("adds, renames by the creator, ignores a rename by anyone else", () => {
    const state = foldPeople(
      [
        op({ kind: "add", guest: "guest_tom", name: "Tom", by: "ana" }, 1),
        op({ kind: "rename", guest: "guest_tom", name: "Tommy", by: "bob" }, 2),
        op({ kind: "rename", guest: "guest_tom", name: "Tomás", by: "ana" }, 3),
      ],
      new Set(["owner"]),
    );
    expect(openGuests(state)).toEqual([{ id: "guest_tom", name: "Tomás", guest: true }]);
  });

  it("lets an owner rename and remove someone else's guest", () => {
    const state = foldPeople(
      [op({ kind: "add", guest: "guest_tom", name: "Tom", by: "bob" }, 1), op({ kind: "rename", guest: "guest_tom", name: "Tom B.", by: "owner" }, 2), op({ kind: "remove", guest: "guest_tom", by: "owner" }, 3)],
      new Set(["owner"]),
    );
    expect(state.guests.get("guest_tom")).toMatchObject({ name: "Tom B.", removed: true });
    expect(openGuests(state)).toEqual([]);
  });

  it("a claim is for yourself, first one wins, and one guest per person", () => {
    const state = foldPeople(
      [
        op({ kind: "add", guest: "guest_tom", name: "Tom", by: "ana" }, 1),
        op({ kind: "add", guest: "guest_eve", name: "Eve", by: "ana" }, 2),
        op({ kind: "claim", guest: "guest_tom", by: "tom" }, 3),
        op({ kind: "claim", guest: "guest_tom", by: "mallory" }, 4), // already claimed
        op({ kind: "claim", guest: "guest_eve", by: "tom" }, 5), // one guest per person
      ],
      new Set(["ana"]),
    );
    expect(finalPerson(state, "guest_tom")).toEqual({ id: "tom" });
    expect(finalPerson(state, "guest_eve").guest?.name).toBe("Eve");
    expect(claimOf(state, "tom")?.id).toBe("guest_tom");
    expect(claimOf(state, "mallory")).toBeUndefined();
    expect(openGuests(state).map((g) => g.name)).toEqual(["Eve"]);
  });

  it("folds a duplicate into another guest, and never into a loop", () => {
    const state = foldPeople(
      [
        op({ kind: "add", guest: "guest_a", name: "Tom", by: "ana" }, 1),
        op({ kind: "add", guest: "guest_b", name: "Tommy", by: "ana" }, 2),
        op({ kind: "link", guest: "guest_b", to: "guest_a", by: "ana" }, 3),
        op({ kind: "link", guest: "guest_a", to: "guest_b", by: "ana" }, 4), // would loop
        op({ kind: "link", guest: "guest_a", to: "x", by: "bob" }, 5), // not bob's to fold
      ],
      new Set(),
    );
    expect(finalPerson(state, "guest_b")).toMatchObject({ id: "guest_a", guest: { name: "Tom" } });
    expect(state.guests.get("guest_a")?.linkedTo).toBeUndefined();
    // Claiming the original then names whoever claimed it from both.
    const claimed = foldPeople(
      [
        op({ kind: "add", guest: "guest_a", name: "Tom", by: "ana" }, 1),
        op({ kind: "add", guest: "guest_b", name: "Tommy", by: "ana" }, 2),
        op({ kind: "link", guest: "guest_b", to: "guest_a", by: "ana" }, 3),
        op({ kind: "claim", guest: "guest_a", by: "tom" }, 6),
      ],
      new Set(),
    );
    expect(finalPerson(claimed, "guest_b")).toEqual({ id: "tom" });
  });
});

describe("a solo app's guests", () => {
  it("live in the store, authored by this device", async () => {
    const store = new MemoryStore();
    await store.open("solo");
    await writePeople(store, { kind: "add", guest: "guest_tom", name: "  Tom  ", }, "me");
    const ops = await readPeople(store);
    expect(ops).toMatchObject([{ kind: "add", guest: "guest_tom", name: "Tom", by: "me" }]);
    // Not app data: nothing under ctx.storage's prefix.
    expect(await store.kvKeys?.("kv:")).toEqual([]);
  });

  it("refuse a change that does not make sense", async () => {
    const store = new MemoryStore();
    await store.open("solo");
    await expect(writePeople(store, { kind: "add", guest: "not-a-guest", name: "Tom" } as never, "me")).rejects.toThrow(/does not make sense/);
  });

  it("move with the app when it starts syncing, claims included", async () => {
    const solo = new MemoryStore();
    await solo.open("app");
    await writePeople(solo, { kind: "add", guest: "guest_tom", name: "Tom" }, "me");
    await writePeople(solo, { kind: "add", guest: "guest_eve", name: "Eve" }, "me");
    await writePeople(solo, { kind: "link", guest: "guest_eve", to: "acct_eve" }, "me");
    const pair = await createPeerPair("guests-copy");
    try {
      const copied = await copyStoreData(solo, pair.a, { entities: [], people: { me: "me" } });
      expect(copied.guests).toBe(2);
      await pair.settle();
      const state = foldPeople(await readPeople(pair.b), new Set());
      expect(openGuests(state).map((g) => g.name)).toEqual(["Tom"]);
      expect(finalPerson(state, "guest_eve")).toEqual({ id: "acct_eve" });
    } finally {
      await pair.close();
    }
  });
});

describe("a shared app's guests", () => {
  it("ride the signed log: the author is the account that wrote it, whatever the entry says", async () => {
    const pair = await createPeerPair("guests-signed");
    try {
      await writePeople(pair.a, { kind: "add", guest: "guest_tom", name: "Tom" }, "ignored");
      await pair.settle();
      // B says it is A in the "me" it passes — a synced store does not listen.
      await writePeople(pair.b, { kind: "claim", guest: "guest_tom" }, "whoever");
      await pair.settle();
      const ops = await readPeople(pair.a);
      const [add, claim] = ops;
      expect(add!.by).not.toBe("ignored");
      expect(claim!.by).not.toBe("whoever");
      expect(claim!.by).not.toBe(add!.by);
      const state = foldPeople(ops, new Set([add!.by]));
      expect(finalPerson(state, "guest_tom")).toEqual({ id: claim!.by });
      // Riding the message log under its own thread: not a conversation anyone sees.
      expect(await pair.a.messages!("room")).toEqual([]);
      expect((await pair.a.messages!(PEOPLE_THREAD)).length).toBe(2);
    } finally {
      await pair.close();
    }
  });

  it("a rename from someone who did not add the guest does not take, on any device", async () => {
    const pair = await createPeerPair("guests-rename");
    try {
      await writePeople(pair.a, { kind: "add", guest: "guest_tom", name: "Tom" }, "");
      await pair.settle();
      await writePeople(pair.b, { kind: "rename", guest: "guest_tom", name: "Not Tom" }, "");
      await pair.settle();
      for (const s of [pair.a, pair.b]) expect(openGuests(foldPeople(await readPeople(s), new Set())).map((g) => g.name)).toEqual(["Tom"]);
    } finally {
      await pair.close();
    }
  });
});
