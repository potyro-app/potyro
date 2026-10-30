// scripts/erase-space.mjs against a relay database made by the real library: cojson's SQLite storage
// (the schema `jazz-run sync --db` writes), on node:sqlite here, as better-sqlite3 there (#119).
//
// The relay node, the devices and their spaces are cojson's own; only the SQLite driver differs from
// jazz-run's, and the driver does not shape the schema (cojson's migrations do).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cojsonInternals, getSqliteStorage, LocalNode } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { JazzStore } from "../src/jazz-store.js";

// Vite does not know node:sqlite yet; Node does (22.13+).
interface Db {
  exec(sql: string): void;
  prepare(sql: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): Record<string, unknown> | undefined; all(...p: unknown[]): Array<Record<string, unknown>> };
  close(): void;
}
// node:sqlite arrived in Node 22.5 (the script says 22.13, the version it was written against). The gate's
// machine runs Node 20, where the module does not exist: loading it here would fail the whole file before
// any suite could be skipped, so it is loaded only where it exists and both suites skip without it. The
// script itself refuses such a Node and says to use the relay's node:22 container.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const hasNodeSqlite = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);
type DatabaseSyncCtor = new (file: string, opts?: { timeout?: number }) => Db;
const DatabaseSync: DatabaseSyncCtor | null = hasNodeSqlite
  ? (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync
  : null;

const SCRIPT = fileURLToPath(new URL("../scripts/erase-space.mjs", import.meta.url));

/** cojson's synchronous SQLite driver, on node:sqlite: what cojson-storage-sqlite is on better-sqlite3. */
function driver(file: string) {
  if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  let depth = 0;
  return {
    run: (sql: string, p: unknown[]) => void db.prepare(sql).run(...p),
    get: <T>(sql: string, p: unknown[]) => db.prepare(sql).get(...p) as T | undefined,
    query: <T>(sql: string, p: unknown[]) => db.prepare(sql).all(...p) as T[],
    transaction(cb: () => unknown) {
      const sp = `sp${depth}`;
      db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${sp}`);
      depth++;
      try {
        cb();
        depth--;
        db.exec(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
      } catch (e) {
        depth--;
        db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}`);
        throw e;
      }
    },
    closeDb: () => db.close(),
  };
}

type Crypto = Awaited<ReturnType<typeof WasmCrypto.create>>;
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** A relay node on the database, as `jazz-run sync --db` makes one. `stop` also lets go of the file. */
function relayOver(file: string, crypto: Crypto): LocalNode & { stop(): Promise<void> } {
  const secret = crypto.newRandomAgentSecret();
  const relay = new LocalNode(secret, crypto.newRandomSessionID(crypto.getAgentID(secret)), crypto);
  const db = driver(file);
  relay.setStorage(getSqliteStorage(db) as never);
  return Object.assign(relay, {
    async stop() {
      await relay.gracefulShutdown();
      db.closeDb();
    },
  });
}

function connect(relay: LocalNode, node: LocalNode, name: string) {
  const [toRelay, toNode] = cojsonInternals.connectedPeers(`relay-${name}`, name, { peer1role: "server", peer2role: "client" });
  node.syncManager.addPeer(toRelay);
  relay.syncManager.addPeer(toNode);
}

interface World {
  dir: string;
  file: string;
  ana: string;
  bo: { accountID: string; accountSecret: string };
  cy: string;
  /** Ana's space, shared with Bo, who wrote in it too. */
  a: { group: string; root: string; secretBytes: string };
  /** Bo's own space. */
  b: { group: string; root: string };
  /** Cy's own space; Cy shares nothing. */
  c: { group: string };
}

let world: World;
let crypto: Crypto;

beforeAll(async () => {
  if (!hasNodeSqlite) return;
  crypto = await WasmCrypto.create();
  const dir = mkdtempSync(join(tmpdir(), "erase-space-"));
  const file = join(dir, "sync.db");
  const relay = relayOver(file, crypto);

  const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
  const bo = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bo" }, crypto });
  const cy = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Cy" }, crypto });
  connect(relay, ana.node, "ana");
  connect(relay, bo.node, "bo");
  connect(relay, cy.node, "cy");

  const groupA = ana.node.createGroup();
  groupA.addMember((await ana.node.load(bo.accountID as never)) as never, "writer");
  const a = new JazzStore({ node: ana.node as never, group: groupA as never });
  await a.open("a");
  await a.insert("plant", { name: "Fern" });
  await a.putBlob(new Blob([new Uint8Array(150_000).fill(7)], { type: "image/png" }));
  await a.postMessage("t", "hello");
  await settle();
  const groupAforBo = await bo.node.load(groupA.id);
  const aForBo = new JazzStore({ node: bo.node as never, group: groupAforBo as never, rootId: a.rootId });
  await aForBo.open("a");
  await aForBo.insert("plant", { name: "Bo's cactus" });

  const groupB = bo.node.createGroup();
  const b = new JazzStore({ node: bo.node as never, group: groupB as never });
  await b.open("b");
  await b.insert("note", { text: "Bo's own note" });

  const groupC = cy.node.createGroup();
  const c = new JazzStore({ node: cy.node as never, group: groupC as never });
  await c.open("c");
  await c.insert("note", { text: "Cy's note" });
  await settle(1200);

  await Promise.all([ana.node.gracefulShutdown(), bo.node.gracefulShutdown(), cy.node.gracefulShutdown()]);
  await relay.stop();

  // A piece of A's ciphertext, to look for in the file's bytes after. Everything into the main file
  // first, so a copy of it is the whole database.
  if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const binary = db.prepare(`SELECT id FROM coValues WHERE header LIKE '%"binary"%' AND header LIKE ?`).get(`%${groupA.id}%`)!.id as string;
  const tx = db.prepare("SELECT t.tx FROM transactions t JOIN sessions s ON s.rowID = t.ses JOIN coValues c ON c.rowID = s.coValue WHERE c.id = ? ORDER BY LENGTH(t.tx) DESC").get(binary)!.tx as string;
  db.close();
  const secretBytes = /encrypted_U([A-Za-z0-9_-]{60})/.exec(tx)![1]!;

  world = {
    dir,
    file,
    ana: ana.accountID,
    bo: { accountID: bo.accountID, accountSecret: bo.accountSecret as string },
    cy: cy.accountID,
    a: { group: groupA.id, root: a.rootId!, secretBytes },
    b: { group: groupB.id, root: b.rootId! },
    c: { group: groupC.id },
  };
}, 60_000);

afterAll(() => {
  if (!hasNodeSqlite) return;
  if (world?.dir) rmSync(world.dir, { recursive: true, force: true });
});

let copies = 0;
/** A fresh copy of the relay's database, for one test. */
function copyOfDb(): string {
  const to = join(world.dir, `copy-${copies++}.db`);
  copyFileSync(world.file, to);
  return to;
}

function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--no-warnings", SCRIPT, ...args], (e, out, err) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(out), err: String(err) }),
    );
  });
}

function ids(file: string): Set<string> {
  if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
  const out = new Set(db.prepare("SELECT id FROM coValues").all().map((r) => r.id as string));
  db.close();
  return out;
}

function counts(file: string): Record<string, number> {
  if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
  const n = (t: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n);
  const out = { coValues: n("coValues"), sessions: n("sessions"), transactions: n("transactions"), signatureAfter: n("signatureAfter") };
  db.close();
  return out;
}

function ownedIds(file: string, group: string): string[] {
  if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
  const out = db.prepare("SELECT id FROM coValues WHERE header LIKE ?").all(`%"ownedByGroup","group":"${group}"%`).map((r) => r.id as string);
  db.close();
  return out;
}

describe.skipIf(!hasNodeSqlite)("erasing a space from the relay's database", () => {
  it("a dry run lists the space and everything it owns, and changes nothing", async () => {
    const file = copyOfDb();
    const before = counts(file);
    const r = await run(["--db", file, "--space", world.a.group, "--dry-run", "--json"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out) as { wouldErase: string[]; erased: string[]; notes: { otherMembers: number } };
    expect(out.erased).toEqual([]);
    expect(new Set(out.wouldErase)).toEqual(new Set([world.a.group, ...ownedIds(file, world.a.group)]));
    expect(out.wouldErase).toContain(world.a.root);
    // Shared with Bo: the plan says so.
    expect(out.notes.otherMembers).toBe(1);
    expect(counts(file)).toEqual(before);
  });

  it("erases the space, its records, its chat and its files' bytes, and nothing else", async () => {
    const file = copyOfDb();
    const all = ids(file);
    const going = new Set([world.a.group, ...ownedIds(file, world.a.group)]);
    expect(going.size).toBeGreaterThan(5);
    expect(readFileSync(file).toString("latin1")).toContain(world.a.secretBytes);

    const r = await run(["--db", file, "--space", world.a.group]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/erased: \d+ CoValues/);
    expect(r.out).toMatch(/sends it back when it next connects/);

    const left = ids(file);
    for (const id of going) expect(left.has(id)).toBe(false);
    expect(left).toEqual(new Set([...all].filter((id) => !going.has(id))));
    // No session, edit or signature of theirs is left behind, and the bytes are out of the file.
    if (!DatabaseSync) throw new Error("node:sqlite is not available on this Node");
  const db = new DatabaseSync(file);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE coValue NOT IN (SELECT rowID FROM coValues)").get()!.n)).toBe(0);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE ses NOT IN (SELECT rowID FROM sessions)").get()!.n)).toBe(0);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM signatureAfter WHERE ses NOT IN (SELECT rowID FROM sessions)").get()!.n)).toBe(0);
    db.close();
    expect(readFileSync(file).toString("latin1")).not.toContain(world.a.secretBytes);
  });

  it("leaves a database the real library opens: the other spaces still load and read, the erased one is gone", async () => {
    const file = copyOfDb();
    expect((await run(["--db", file, "--space", world.a.group])).code).toBe(0);

    const relay = relayOver(file, crypto);
    const [toRelay, toBo] = cojsonInternals.connectedPeers("relay-bo-again", "bo-again", { peer1role: "server", peer2role: "client" });
    relay.syncManager.addPeer(toBo);
    const bo = await LocalNode.withLoadedAccount({ accountID: world.bo.accountID as never, accountSecret: world.bo.accountSecret as never, sessionID: undefined, peers: [toRelay], crypto });
    const groupB = await bo.load(world.b.group as never);
    expect(groupB).not.toBe("unavailable");
    const b = new JazzStore({ node: bo as never, group: groupB as never, rootId: world.b.root });
    await b.open("b");
    expect((await b.all("note")).map((n) => n.text)).toEqual(["Bo's own note"]);
    expect(await relay.load(world.a.group as never)).toBe("unavailable");
    expect(await relay.load(world.a.root as never)).toBe("unavailable");
    await bo.gracefulShutdown();
    await relay.stop();
  }, 30_000);

  it("refuses while the relay has the database open, and changes nothing", async () => {
    const file = copyOfDb();
    const before = counts(file);
    const relay = new DatabaseSync!(file);
    relay.exec("PRAGMA journal_mode = WAL");
    relay.prepare("SELECT COUNT(*) FROM coValues").get();
    const r = await run(["--db", file, "--space", world.a.group]);
    relay.close();
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/Stop it first/);
    expect(counts(file)).toEqual(before);
  });

  it("says what an id is when it is not a space", async () => {
    const file = copyOfDb();
    const inside = await run(["--db", file, "--space", world.a.root]);
    expect(inside.code).toBe(1);
    expect(inside.err).toContain(`its space is ${world.a.group}`);
    const account = await run(["--db", file, "--space", world.ana]);
    expect(account.err).toMatch(/is an account/);
    const missing = await run(["--db", file, "--space", "co_z1111111111111111111111"]);
    expect(missing.err).toMatch(/not on this relay/);
    expect((await run(["--db", file, "--space", "../etc"])).code).toBe(2);
    expect((await run(["--db", file])).code).toBe(2);
  });
});

describe.skipIf(!hasNodeSqlite)("what erasing on the relay cannot do", () => {
  it("a device that still holds the space puts it back when it next connects", async () => {
    const file = join(world.dir, "returning.db");
    const first = relayOver(file, crypto);
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    connect(first, ana.node, "ana");
    const group = ana.node.createGroup();
    const store = new JazzStore({ node: ana.node as never, group: group as never });
    await store.open("a");
    await store.insert("plant", { name: "Fern" });
    await settle(800);
    await first.stop();

    expect((await run(["--db", file, "--space", group.id])).code).toBe(0);
    expect(ids(file).has(group.id)).toBe(false);

    // The relay starts again; Ana's device, which kept its copy, reconnects and edits.
    const again = relayOver(file, crypto);
    connect(again, ana.node, "ana-again");
    await store.insert("plant", { name: "Moss" });
    await settle(1200);
    await again.stop();
    expect(ids(file).has(group.id)).toBe(true);
    await ana.node.gracefulShutdown();
  }, 30_000);
});

describe("erasing an account from the relay's database", () => {
  it("an account that shares nothing: the account, its profile and its spaces all go", async () => {
    const file = copyOfDb();
    const all = ids(file);
    const r = await run(["--db", file, "--account", world.cy, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out) as { erased: string[]; kept: unknown[] };
    expect(out.kept).toEqual([]);
    expect(out.erased).toContain(world.cy);
    expect(out.erased).toContain(world.c.group);
    const left = ids(file);
    for (const id of out.erased) expect(left.has(id)).toBe(false);
    // Only Cy's: everyone else's is all still there.
    expect(left).toEqual(new Set([...all].filter((id) => !out.erased.includes(id))));
    expect(left.has(world.ana)).toBe(true);
    expect(left.has(world.b.group)).toBe(true);
  });

  it("an account in a space others are in: that space and the account are kept, and the plan says why", async () => {
    const file = copyOfDb();
    const r = await run(["--db", file, "--account", world.ana, "--dry-run", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out) as { wouldErase: string[]; kept: Array<{ id: string; why: string }> };
    expect(out.kept.map((k) => k.id)).toEqual(expect.arrayContaining([world.a.group, world.ana]));
    expect(out.kept.find((k) => k.id === world.a.group)!.why).toMatch(/others are in it/);
    expect(out.wouldErase).not.toContain(world.a.group);
    expect(out.wouldErase).not.toContain(world.ana);
    // Bo wrote in Ana's space: Bo's account is named there, so Bo's is kept for the same reason.
    const bo = JSON.parse((await run(["--db", file, "--account", world.bo.accountID, "--dry-run", "--json"])).out) as { wouldErase: string[]; kept: Array<{ id: string }> };
    expect(bo.kept.map((k) => k.id)).toContain(world.bo.accountID);
    expect(bo.wouldErase).toContain(world.b.group);
  });
});
