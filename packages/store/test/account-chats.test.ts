// Your Studio conversations, kept on your ACCOUNT (#283).
//
// Each app's chat follows you to your other devices through a map only your account can read —
// never through the app's shared space, which the people you share the app with are in. Two NODES
// over one account is "my laptop wrote it, my phone read it"; a second ACCOUNT on the same relay is
// the collaborator, who must not read it.
import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, publishChatMessages, readAccountChat, removeChatMessages, watchAccountChats, type JazzKeyStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

function memoryKeys(): JazzKeyStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

async function memoryDb() {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "c");
}

const ASK = { id: "m1", n: 1, at: "2026-10-13T10:00:00.000Z", kind: "ask", text: "make the buttons bigger" };
const QUESTION = { id: "m2", n: 2, at: "2026-10-13T10:00:05.000Z", kind: "question", text: "Which buttons?" };

describe("a Studio conversation on your account", () => {
  it("is read back on another device of yours, message by message", async () => {
    const keys = memoryKeys();
    const db = await memoryDb();
    const laptop = await createJazzStore("notes", { db, crypto, keys });
    expect(await publishChatMessages(laptop.node, "notes", [ASK, QUESTION])).toBe(true);
    await laptop.whenDurable();

    const phone = await createJazzStore("groceries", { db, crypto, keys });
    const chat = await readAccountChat(phone.node, "notes");
    expect(chat.messages).toEqual(expect.arrayContaining([ASK, QUESTION]));
    expect(chat.messages).toHaveLength(2);
    expect(chat.removed).toEqual([]);
  });

  it("keeps each app's conversation to itself", async () => {
    const handle = await createJazzStore("notes", { db: await memoryDb(), crypto, keys: memoryKeys() });
    await publishChatMessages(handle.node, "notes", [ASK]);
    await publishChatMessages(handle.node, "notes-2", [QUESTION]);
    expect((await readAccountChat(handle.node, "notes")).messages).toEqual([ASK]);
    expect((await readAccountChat(handle.node, "notes-2")).messages).toEqual([QUESTION]);
  });

  it("is empty — not an error — before anything was said", async () => {
    const handle = await createJazzStore("notes", { db: await memoryDb(), crypto, keys: memoryKeys() });
    expect(await readAccountChat(handle.node, "notes")).toEqual({ messages: [], removed: [] });
  });

  it("writing the same message twice keeps one", async () => {
    const handle = await createJazzStore("notes", { db: await memoryDb(), crypto, keys: memoryKeys() });
    await publishChatMessages(handle.node, "notes", [ASK]);
    await publishChatMessages(handle.node, "notes", [ASK, QUESTION]);
    expect((await readAccountChat(handle.node, "notes")).messages).toHaveLength(2);
  });

  it("a forgotten message is gone for every device, and says so", async () => {
    const handle = await createJazzStore("notes", { db: await memoryDb(), crypto, keys: memoryKeys() });
    await publishChatMessages(handle.node, "notes", [ASK, QUESTION]);
    expect(await removeChatMessages(handle.node, "notes", ["m1"])).toBe(true);
    expect(await readAccountChat(handle.node, "notes")).toEqual({ messages: [QUESTION], removed: ["m1"] });
    // And it is not brought back by a device that had not heard yet.
    await publishChatMessages(handle.node, "notes", [ASK]);
    expect((await readAccountChat(handle.node, "notes")).messages).toEqual([QUESTION]);
  });

  it("says when the conversations change, from the first message on", async () => {
    const handle = await createJazzStore("notes", { db: await memoryDb(), crypto, keys: memoryKeys() });
    let changes = 0;
    const stop = await watchAccountChats(handle.node, () => changes++);
    await publishChatMessages(handle.node, "notes", [ASK]);
    await new Promise((r) => setTimeout(r, 50));
    const afterFirst = changes;
    expect(afterFirst).toBeGreaterThan(0);
    await publishChatMessages(handle.node, "notes", [QUESTION]);
    await new Promise((r) => setTimeout(r, 50));
    expect(changes).toBeGreaterThan(afterFirst);
    stop();
  });

  it("is not readable by anyone else, even one who has the map's id", async () => {
    const db = await memoryDb();
    const mine = await createJazzStore("notes", { db, crypto, keys: memoryKeys() });
    await publishChatMessages(mine.node, "notes", [ASK]);
    await mine.whenDurable();
    // The collaborator: another account on the same storage, which is as close as they can get.
    const theirs = await createJazzStore("notes", { db, crypto, keys: memoryKeys() });
    expect((await readAccountChat(theirs.node, "notes")).messages).toEqual([]);

    const account = await (mine.node as unknown as { expectCurrentAccount(h: string): Promise<{ get(k: string): unknown }> }).expectCurrentAccount("test");
    const id = account.get("potyroChats") as string;
    const loaded = await (theirs.node as unknown as { load(id: string): Promise<unknown> }).load(id);
    const text = loaded === "unavailable" ? undefined : (loaded as { get(k: string): unknown }).get(`notes\u0000m1`);
    expect(text).toBeUndefined();
  });
});
