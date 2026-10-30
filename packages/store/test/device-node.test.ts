// One node per device database in a page (#463).
//
// Every synced app opened in a page, and the boot code reading the account, each opened a cojson
// `LocalNode` of its own over the one device database. In Firefox under load that went wrong on an
// ordinary reload: one node's write to the account, coming back through the relay, was refused by
// the other as `InvalidSignature`, and the account was marked errored for that relay. The fix is
// structural — the page has ONE node there, and everyone is handed it — so that is what this pins.
//
// `openJazzStore` needs a worker for its database, so the worker is played by one in-memory SQLite
// connection answering in order on a later task, which is what the real one does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerFactory } from "../src/sqlite-worker-client.js";

const opens = vi.hoisted(() => ({ count: 0, fail: false }));
/** Every relay connection made, never answered — a relay that is down. */
const sockets = vi.hoisted(() => ({ made: 0 }));

vi.mock("cojson-transport-ws", () => ({
  WebSocketPeerWithReconnection: class {
    connected = false;
    constructor() {
      sockets.made++;
    }
    enable() {}
    disable() {}
    subscribe() {}
    unsubscribe() {}
  },
}));

vi.mock("../src/sqlite-worker-client.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/sqlite-worker-client.js")>();
  const { initSqlite } = await import("../src/sqlite-backend.js");
  const sqlite3 = await initSqlite();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const factory: WorkerFactory = () => {
    const w = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(message: unknown) {
        const m = message as { id: number; op: string; sql?: string; params?: unknown[] };
        setTimeout(() => {
          try {
            const bind = (m.params ?? []) as never;
            let rows: Record<string, unknown>[] | undefined;
            if (m.op === "run") db.exec({ sql: m.sql!, bind });
            else if (m.op === "query") rows = db.selectObjects(m.sql!, bind) as Record<string, unknown>[];
            else if (m.op === "get") rows = (db.selectObjects(m.sql!, bind) as Record<string, unknown>[]).slice(0, 1);
            w.onmessage?.({ data: { id: m.id, ok: true, rows } });
          } catch (err) {
            w.onmessage?.({ data: { id: m.id, ok: false, error: String(err) } });
          }
        }, 0);
      },
      terminate() {},
    };
    return w;
  };
  return {
    ...real,
    workersAvailable: () => true,
    openWorkerSqlite: (name: string) => {
      opens.count++;
      if (opens.fail) return Promise.reject(new real.StorageElsewhereError());
      return real.openWorkerSqlite(name, factory);
    },
  };
});

const { openJazzStore, openAccountNodeInBrowser } = await import("../src/jazz-backend.js");
const { WasmCrypto } = await import("cojson/crypto/WasmCrypto");
const { cojsonInternals } = await import("cojson");

function memoryKeys() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
}

/** What `@potyro/identity` mints: an account id derived from its secret, with no node. */
async function identity(): Promise<{ id: string; secret: string }> {
  const crypto = await WasmCrypto.create();
  const secret = crypto.agentSecretFromSecretSeed(crypto.newRandomSecretSeed());
  const internals = cojsonInternals as unknown as {
    idforHeader(header: unknown, c: unknown): string;
    accountHeaderForInitialAgentSecret(s: unknown, c: unknown): unknown;
  };
  return { id: internals.idforHeader(internals.accountHeaderForInitialAgentSecret(secret, crypto), crypto), secret: secret as unknown as string };
}

beforeEach(() => {
  opens.count = 0;
  opens.fail = false;
  sockets.made = 0;
});

// Each case mints accounts and opens cojson storage, which is seconds of WASM crypto, not 5 s's worth.
describe("the page's node on the device database", { timeout: 30_000 }, () => {
  it("is one node, whichever app or reader asks for it — and the apps stay apart on it", async () => {
    const account = await identity();
    const keys = memoryKeys();

    // The way a reload with a synced app open starts: the app and the boot code's account reader
    // at the same moment.
    const [split, reader] = await Promise.all([
      openJazzStore("user:split", { keys, account }),
      openAccountNodeInBrowser({ keys, account }),
    ]);
    const plants = await openJazzStore("user:plants", { keys, account });

    expect(reader?.node).toBe(split.node);
    expect(plants.node).toBe(split.node);
    expect(opens.count).toBe(1);

    // One node, still two spaces: a record in one app is not in the other.
    expect(plants.groupID).not.toBe(split.groupID);
    await split.store.insert("expense", { description: "Dinner" });
    expect(await plants.store.all("expense")).toHaveLength(0);
    expect(await split.store.all("expense")).toHaveLength(1);
  });

  it("is a different node for a different person on this device", async () => {
    const keys = memoryKeys();
    const one = await openJazzStore("user:split", { keys, account: await identity() });
    const two = await openAccountNodeInBrowser({ keys, account: await identity() });
    expect(two?.node).toBeTruthy();
    expect(two?.node).not.toBe(one.node);
  });

  it("forgets an opening that failed, so the next one tries again", async () => {
    const account = await identity();
    const keys = memoryKeys();

    opens.fail = true; // another tab had the storage
    await expect(openJazzStore("user:split", { keys, account })).rejects.toThrow(/another tab/i);

    opens.fail = false; // …and let go of it
    const handle = await openJazzStore("user:split", { keys, account });
    expect(handle.node).toBeTruthy();
    expect(opens.count).toBe(2);
  });

  it("asks the relay for the account first when a later caller expects it, while the opening is pending", async () => {
    const account = await identity();
    const keys = memoryKeys();
    const relay = "wss://relay.example";

    // An invite accepted at boot registers first, without `expectExisting`; the boot account reader
    // of a device linked with the recovery words arrives while that opening is still under way.
    const [joined, reader] = await Promise.all([
      openJazzStore("user:split", { keys, account, relay }),
      openAccountNodeInBrowser({ keys, account, relay, expectExisting: true }),
    ]);

    expect(reader?.node).toBe(joined.node);
    expect(opens.count).toBe(1);
    // Two connections: the throwaway one that asked the relay for the account before anything was
    // minted, and the node's own. Without the later caller's say it would be the node's alone.
    expect(sockets.made).toBe(2);
  });

  // Apps recorded before the database move (`${appId}-jazz`) still open a node of their own beside
  // the device database's: the two-nodes-on-one-account shape this file pins away. Migrating those
  // spaces into the device database is a follow-up, and until then they keep the hazard.
  it.todo("gives an app on a legacy per-app database the device database's node, once those are migrated");
});
