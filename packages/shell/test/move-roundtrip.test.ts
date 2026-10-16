// @vitest-environment happy-dom
//
// Moving everything from one Potyro site to another (move-gather.ts → move-archive.ts →
// move-bring-in.ts), with the two sites played in one test: each has its own localStorage, its own
// secret vault and its own stores, swapped in by `become`. What it pins:
//
//   - an app's records, files, photos and its own state arrive, with their ids;
//   - a synced app arrives from its SPACE, as this site's own copy;
//   - an app from someone else arrives sealed; the person's own arrives trusted — over the window;
//   - Studio conversations come, and who you are comes, with the same recovery words;
//   - doing it twice changes nothing; nothing on the old site is removed;
//   - a saved file brings everything sealed and never who you are, and a damaged or hostile file is
//     refused by name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, type Store } from "@potyro/store";

type Site = { storage: Map<string, string>; stores: Map<string, MemoryStore>; vault: ReturnType<typeof import("@potyro/identity").memoryVault> };
let site: Site;

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string, opts?: { sync?: boolean }): Promise<Store> => {
    const key = `${namespace}|${opts?.sync ? "space" : "local"}`;
    let s = site.stores.get(key);
    if (!s) {
      s = new MemoryStore();
      await s.open(namespace);
      site.stores.set(key, s);
    }
    return s;
  },
}));
vi.mock("../src/app-source.js", () => ({ inspect: async (source: string) => ({ entities: [...source.matchAll(/entity:(\w+)/g)].map((m) => ({ key: m[1] })) }) }));
vi.mock("../src/app-store.js", () => ({ syncAllowedFor: async (app: { sync?: boolean }) => Boolean(app.sync) }));
vi.mock("../src/device-files.js", () => ({ deviceFilesNamespace: (id: string) => `device-files:${id}` }));

const identity = await import("@potyro/identity");
const { packEverything } = await import("../src/move-gather.js");
const { readMoveArchive, MoveArchiveError, packMoveArchive } = await import("../src/move-archive.js");
const { bringInEverything } = await import("../src/move-bring-in.js");
const { saveUserApp, listUserApps, getUserApp } = await import("../src/user-apps.js");
const { appendMessage, listMessages } = await import("../src/studio-chat.js");

function newSite(): Site {
  return { storage: new Map(), stores: new Map(), vault: identity.memoryVault() };
}
const OLD = newSite();
const NEW = newSite();

/** Play one site: its storage in localStorage, its vault, its stores. */
async function become(next: Site): Promise<void> {
  if (site) {
    site.storage.clear();
    for (let i = 0; i < localStorage.length; i++) site.storage.set(localStorage.key(i)!, localStorage.getItem(localStorage.key(i)!)!);
  }
  localStorage.clear();
  for (const [k, v] of next.storage) localStorage.setItem(k, v);
  identity.setSecretVault(next.vault);
  const { resetChatStore } = (await import("../src/studio-chat.js")) as unknown as { resetChatStore?: () => void };
  resetChatStore?.();
  const { resetHistoryStore } = (await import("../src/app-history.js")) as unknown as { resetHistoryStore?: () => void };
  resetHistoryStore?.();
  site = next;
}

const NOW = "2026-10-16T10:00:00.000Z";
const store = (s: Site, ns: string, sync = false): MemoryStore => s.stores.get(`${ns}|${sync ? "space" : "local"}`)!;

async function fileInto(s: Store, path: string, text: string): Promise<void> {
  const blob = `blob-${path}`;
  await s.putBlobWithKey!(blob, new Blob([text], { type: "text/markdown" }));
  await s.setFile({ id: `f-${path}`, path, name: path.split("/").pop()!, mime: "text/markdown", size: text.length, hash: "h", origin: "added", created: NOW, updated: NOW, blob } as never);
}

beforeEach(async () => {
  for (const s of [OLD, NEW]) {
    s.storage.clear();
    s.stores.clear();
    s.vault.map.clear();
  }
  site = undefined as unknown as Site;
  await become(OLD);
  // The person's own app, with records, a photo, a file and its own state.
  await saveUserApp({ id: "notes", name: "Notes", source: "// entity:note", trusted: true }, NOW);
  const notes = (await (await import("../src/open-store.js")).openStore("user:notes")) as MemoryStore;
  await notes.putBlobWithKey("photo-1", new Blob(["jpeg"], { type: "image/jpeg" }));
  await notes.insert("note", { id: "n1", title: "Milk", photo: { key: "photo-1", mime: "image/jpeg" } });
  await notes.insert("note", { id: "n2", title: "Eggs" });
  await notes.kvSet("draft", "half a thought");
  await fileInto(notes, "notes/hello.md", "# Hello");
  // Someone else's app, sealed, with a record.
  await saveUserApp({ id: "tally", name: "Tally", source: "// entity:count", trusted: false, credit: { name: "Tally", by: "Bea" } }, NOW);
  await (await (await import("../src/open-store.js")).openStore("user:tally")).insert("count", { id: "c1", n: 3 });
  // A synced app: its records are in its space; the local copy is stale and must not come.
  await saveUserApp({ id: "trip", name: "Trip", source: "// entity:cost", trusted: true, sync: true }, NOW);
  const { openStore } = await import("../src/open-store.js");
  await (await openStore("user:trip", { sync: false })).insert("cost", { id: "stale", what: "old local copy" });
  await (await openStore("user:trip", { sync: true })).insert("cost", { id: "k1", what: "Hotel" });
  // A Studio conversation, and who they are.
  await appendMessage("notes", { kind: "ask", text: "make me a notes app" }, NOW);
  await identity.ensureIdentity();
  identity.renameIdentity("Ana");
});
afterEach(() => localStorage.clear());

async function moveOver(via: "window" | "file") {
  await become(OLD);
  const packed = await packEverything({ from: "https://apps.vaz.io", withIdentity: via === "window" });
  await become(NEW);
  const archive = readMoveArchive(packed.bytes);
  return { packed, result: await bringInEverything(archive, { via }) };
}

describe("moving to a new home", () => {
  it("brings every app with its records, photos, files and state, over the window", async () => {
    await become(OLD);
    const me = identity.peekIdentity()!;
    const words = await identity.recoveryPassphrase();
    const { result } = await moveOver("window");

    expect(listUserApps().map((a) => a.id).sort()).toEqual(["notes", "tally", "trip"]);
    const notes = store(NEW, "user:notes");
    expect((await notes.all("note")).map((r) => r.title).sort()).toEqual(["Eggs", "Milk"]);
    expect(await (await notes.getBlob({ key: "photo-1", mime: "image/jpeg" }))?.text()).toBe("jpeg");
    expect(await notes.kvGet("draft")).toBe("half a thought");
    expect((await notes.listFiles()).map((f) => f.path)).toEqual(["notes/hello.md"]);

    // Trust: the person's own runs directly; someone else's stays sealed.
    expect(getUserApp("notes")?.trusted).toBe(true);
    expect(getUserApp("tally")?.trusted).toBe(false);

    // The synced app comes from its space, as a local copy here.
    expect(getUserApp("trip")?.sync).toBe(false);
    expect((await store(NEW, "user:trip").all("cost")).map((r) => r.id)).toEqual(["k1"]);

    // The conversation, and the person.
    expect((await listMessages("notes")).map((m) => m.text)).toEqual(["make me a notes app"]);
    expect(result.identity).toBe("adopted");
    expect(identity.peekIdentity()).toEqual({ id: me.id, name: "Ana" });
    expect(await identity.recoveryPassphrase()).toBe(words);
    expect(result).toMatchObject({ apps: 3, records: 4, files: 1, failed: [] });
  });

  it("is a merge: doing it twice doubles nothing, and the old site keeps everything", async () => {
    await moveOver("window");
    const second = await moveOver("window");
    expect(second.result.plans.map((p) => p.kind)).toEqual(["merge", "merge", "merge"]);
    expect(listUserApps()).toHaveLength(3);
    expect(await store(NEW, "user:notes").all("note")).toHaveLength(2);
    expect(await listMessages("notes")).toHaveLength(1);
    // Nothing removed there.
    await become(OLD);
    expect(listUserApps()).toHaveLength(3);
    expect(await store(OLD, "user:notes").all("note")).toHaveLength(2);
  });

  it("keeps an app the new site already has changed, and brings the other beside it", async () => {
    await become(NEW);
    await saveUserApp({ id: "notes", name: "Notes", source: "// entity:note — changed here", trusted: true }, NOW);
    const { result } = await moveOver("window");
    const plan = result.plans.find((p) => p.app.id === "notes")!;
    expect(plan.kind).toBe("copy");
    expect(getUserApp("notes")?.source).toContain("changed here");
    expect(getUserApp(plan.id)?.name).toBe("Notes (from apps.vaz.io)");
    expect(await store(NEW, `user:${plan.id}`).all("note")).toHaveLength(2);
  });

  it("from a saved file: every app sealed, and who you are does not come", async () => {
    const { packed, result } = await moveOver("file");
    expect(packed.manifest.identity).toBeUndefined();
    expect(listUserApps().every((a) => a.trusted === false)).toBe(true);
    expect(result.identity).toBe("none");
    expect(identity.peekIdentity()).toBeNull();
  });

  it("refuses a damaged or hostile file by name, and brings nothing in", async () => {
    await become(OLD);
    const packed = await packEverything({ from: "https://apps.vaz.io", withIdentity: false });
    await become(NEW);
    expect(() => readMoveArchive(new Uint8Array([1, 2, 3]))).toThrow(MoveArchiveError);
    const archive = readMoveArchive(packed.bytes);
    const hostile = (patch: (m: Record<string, unknown>) => void): Uint8Array => {
      const manifest = JSON.parse(JSON.stringify(archive.manifest)) as Record<string, unknown>;
      patch(manifest);
      return packMoveArchive({ ...archive, manifest: manifest as never });
    };
    // A path where an app id goes, a missing database, an app listed twice.
    expect(() => readMoveArchive(hostile((m) => ((m.apps as Array<Record<string, unknown>>)[0]!.id = "../../etc")))).toThrow(MoveArchiveError);
    expect(() =>
      readMoveArchive(packMoveArchive({ ...archive, data: new Map([...archive.data].filter(([id]) => id !== "notes")) })),
    ).toThrow(/Notes/);
    expect(() => readMoveArchive(hostile((m) => (m.apps = [...(m.apps as unknown[]), (m.apps as unknown[])[0]])))).toThrow(MoveArchiveError);
    // A preference that is not one: dropped, not set.
    const prefs = readMoveArchive(hostile((m) => (m.prefs = { "potyro:identity:secret": "x", "potyro:user-apps": "[]", "potyro:look": "{}" })));
    expect(Object.keys(prefs.manifest.prefs)).toEqual(["potyro:look"]);
    expect(listUserApps()).toHaveLength(0);
  });
});
