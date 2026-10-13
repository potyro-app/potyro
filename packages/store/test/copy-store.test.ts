// Moving an app's data between stores — what the sync toggle does (ADR 0001 D3).
//
// The two stores keep data in different files, so flipping sync without copying opens the app
// empty. These tests pin the three things a naive copy gets wrong and that all look like success:
// re-generated ids (severing relations), re-keyed blobs (losing every photo), and dropped kv.

import { describe, expect, it } from "vitest";
import { MemoryStore, copyStoreData, fileSpace, isReservedPath } from "../src/index.js";

async function store(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("test");
  return s;
}

describe("copyStoreData", () => {
  it("preserves ids and createdAt, so relations still resolve", async () => {
    const from = await store();
    const to = await store();
    const author = await from.insert("author", { name: "Ana" });
    // A relation field holds the *id* of another record. Re-generating ids on copy would leave
    // this pointing at nothing, while the copy still reported success.
    const book = await from.insert("book", { title: "Soup", author: author.id });

    await copyStoreData(from, to, { entities: ["author", "book"] });

    const copiedBook = await to.get("book", book.id);
    expect(copiedBook?.author).toBe(author.id);
    expect(await to.get("author", author.id)).not.toBeNull();
    expect(copiedBook?.createdAt).toBe(book.createdAt);
  });

  it("copies blobs under their ORIGINAL key so MediaRefs still resolve", async () => {
    const from = await store();
    const to = await store();
    const ref = await from.putBlob(new Blob(["photo-bytes"], { type: "image/png" }));
    await from.insert("place", { name: "Cafe", photo: ref });

    const result = await copyStoreData(from, to, { entities: ["place"] });

    expect(result.blobs).toBe(1);
    expect(result.skippedBlobs).toEqual([]);
    // Resolving the ORIGINAL ref against the NEW store is the whole point.
    expect(await (await to.getBlob(ref))!.text()).toBe("photo-bytes");
  });

  it("finds MediaRefs nested inside list fields", async () => {
    const from = await store();
    const to = await store();
    const ref = await from.putBlob(new Blob(["step-photo"], { type: "image/png" }));
    // recipes/workout nest lists of objects; a top-level-only scan would miss this.
    await from.insert("recipe", { name: "Soup", steps: [{ text: "chop", image: ref }] });

    const result = await copyStoreData(from, to, { entities: ["recipe"] });

    expect(result.blobs).toBe(1);
    expect(await (await to.getBlob(ref))!.text()).toBe("step-photo");
  });

  it("copies kv — an app's own state lives there", async () => {
    const from = await store();
    const to = await store();
    await from.kvSet("workout:active", '{"day":"push"}');

    const result = await copyStoreData(from, to, { entities: [] });

    expect(result.kv).toBe(1);
    expect(await to.kvGet("workout:active")).toBe('{"day":"push"}');
  });

  it("reports blobs it could not move instead of dropping them silently", async () => {
    const from = await store();
    const to = await store();
    const ref = await from.putBlob(new Blob(["x"], { type: "image/png" }));
    await from.insert("place", { photo: ref });
    // A target that cannot write under an existing key: the copy must SAY so, because a silent
    // skip here means every photo in the app is gone and nothing reported a failure.
    const limited = Object.create(to) as typeof to;
    (limited as { putBlobWithKey?: unknown }).putBlobWithKey = undefined;

    const result = await copyStoreData(from, limited, { entities: ["place"] });

    expect(result.blobs).toBe(0);
    expect(result.skippedBlobs).toEqual([
      { key: ref.key, reason: "target store cannot write a blob under an existing key" },
    ]);
  });

  it("leaves the source intact — a failed migration must not lose the original", async () => {
    const from = await store();
    const to = await store();
    await from.insert("task", { title: "a" });

    await copyStoreData(from, to, { entities: ["task"] });

    expect(await from.all("task")).toHaveLength(1);
  });

  it("can leave the app's code out, copying only its data (#282)", async () => {
    const from = await store();
    const to = await store();
    const space = fileSpace(from);
    await space.write("plan.json", new Blob(["{}"]));
    await space.write(".src/plan.ts", new Blob(["export {};"]), { origin: "shipped" });
    await space.write(".modules/" + "a".repeat(64) + ".js", new Blob(["export {};"]), { origin: "shipped" });

    const copied = await copyStoreData(from, to, { entities: [], skipFile: isReservedPath });

    expect(copied.files).toBe(1);
    expect((await to.listFiles()).map((f) => f.path)).toEqual(["plan.json"]);
  });
});
