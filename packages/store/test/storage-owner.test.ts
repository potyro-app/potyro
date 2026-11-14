// One tab owns the storage: the rules of `ownStorage`, over a lock manager that behaves like the
// browser's (exclusive, queued, `steal`, `signal`). The browsers themselves are in
// e2e/storage-owner-trusted.spec.ts; this is what can be pinned without one.

import { describe, expect, it } from "vitest";
import { isStorageElsewhere, ownStorage, StorageElsewhereError, STORAGE_LOCK, type LockManagerLike } from "../src/storage-owner.js";

/** Web Locks, one exclusive name, as much of them as `ownStorage` uses. */
function fakeLocks(): LockManagerLike & { holders(): number } {
  type Entry = { cb: (lock: unknown) => unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal };
  let holder: Entry | null = null;
  const queue: Entry[] = [];
  const abort = () => Object.assign(new Error("aborted"), { name: "AbortError" });
  const grant = (e: Entry) => {
    holder = e;
    Promise.resolve(e.cb({ name: STORAGE_LOCK })).then(
      (v) => {
        if (holder === e) {
          holder = null;
          e.resolve(v);
          const next = queue.shift();
          if (next) grant(next);
        }
      },
      (err) => e.reject(err),
    );
  };
  return {
    holders: () => (holder ? 1 : 0),
    request(name, options, cb) {
      expect(name).toBe(STORAGE_LOCK);
      return new Promise((resolve, reject) => {
        const e: Entry = { cb, resolve, reject, signal: options.signal };
        if (options.steal) {
          const old = holder;
          holder = null;
          old?.reject(abort()); // the browser rejects the old holder's request with AbortError
          grant(e);
          return;
        }
        if (!holder) return grant(e);
        if (options.ifAvailable) return void Promise.resolve(cb(null)).then(resolve, reject);
        queue.push(e);
        options.signal?.addEventListener("abort", () => {
          const i = queue.indexOf(e);
          if (i >= 0) queue.splice(i, 1);
          reject(abort());
        });
      });
    },
  };
}

const free = async () => true;
const base = { waitMs: 50, filesWithinMs: 50, filesFree: free, onLost: () => {}, sleep: async () => {} };

describe("one owner for the storage", () => {
  it("takes the lock when nobody has it, and keeps it until released", async () => {
    const locks = fakeLocks();
    const owner = await ownStorage({ ...base, locks, takeover: false });
    expect(locks.holders()).toBe(1);
    owner.release();
    await Promise.resolve();
    expect(locks.holders()).toBe(0);
  });

  it("says another tab has it when the lock is not let go of in time", async () => {
    const locks = fakeLocks();
    await ownStorage({ ...base, locks, takeover: false });
    const second = ownStorage({ ...base, locks, takeover: false });
    await expect(second).rejects.toBeInstanceOf(StorageElsewhereError);
    await expect(second).rejects.toSatisfy(isStorageElsewhere);
  });

  it("waits for a lock that is on its way out (a reload)", async () => {
    const locks = fakeLocks();
    const first = await ownStorage({ ...base, locks, takeover: false });
    const second = ownStorage({ ...base, waitMs: 1000, locks, takeover: false });
    setTimeout(() => first.release(), 20);
    await expect(second).resolves.toBeDefined();
  });

  it("takes it over when asked to, and tells the old owner it lost it", async () => {
    const locks = fakeLocks();
    let lost = 0;
    await ownStorage({ ...base, locks, takeover: false, onLost: () => lost++ });
    await ownStorage({ ...base, locks, takeover: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(lost).toBe(1);
    expect(locks.holders()).toBe(1);
  });

  it("does not install over files someone else still holds, and gives the lock back", async () => {
    // The lock moved but the old owner has not closed yet — or an older build, which takes no lock.
    const locks = fakeLocks();
    const owner = ownStorage({ ...base, locks, takeover: false, filesFree: async () => false });
    await expect(owner).rejects.toBeInstanceOf(StorageElsewhereError);
    await Promise.resolve();
    expect(locks.holders()).toBe(0);
  });

  it("gives the lock back when the files could not even be asked about", async () => {
    // Firefox, with its own bookkeeping for the origin's files stuck, answers every open with
    // "UnknownError: Unknown failure". The lock stayed held by a worker that owned nothing, the next
    // open in the same worker waited on it, and the tab said "Potyro is open in another tab" with no
    // other tab anywhere.
    const locks = fakeLocks();
    const failure = Object.assign(new Error("Unknown failure"), { name: "UnknownError" });
    const owner = ownStorage({ ...base, locks, takeover: false, filesFree: async () => Promise.reject(failure) });
    await expect(owner).rejects.toBe(failure);
    await Promise.resolve();
    expect(locks.holders()).toBe(0);
    await expect(ownStorage({ ...base, locks, takeover: false })).resolves.toBeDefined();
  });

  it("keeps trying the files while a stolen lock's old owner closes", async () => {
    let tries = 0;
    const owner = await ownStorage({ ...base, filesWithinMs: 5000, locks: fakeLocks(), takeover: true, filesFree: async () => ++tries >= 3 });
    expect(owner).toBeDefined();
    expect(tries).toBe(3);
  });

  it("without Web Locks, the files alone decide", async () => {
    await expect(ownStorage({ ...base, takeover: false })).resolves.toBeDefined();
    await expect(ownStorage({ ...base, takeover: false, filesFree: async () => false })).rejects.toBeInstanceOf(StorageElsewhereError);
  });
});

// sqlite-wasm, on a pool install that fails, calls `removeVfs()` — which deletes the pool's directory,
// every database in it, whenever the handles happen to be free. patches/@sqlite.org__sqlite-wasm*.patch
// makes it let go of the handles and keep the files. This fails the day an upgrade drops the patch.
describe("the patched sqlite-wasm", () => {
  it("keeps a pool's files when the pool could not be installed", async () => {
    const { readFileSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const pkg = createRequire(import.meta.url).resolve("@sqlite.org/sqlite-wasm/package.json");
    const browserBuild = readFileSync(pkg.replace(/package\.json$/, "dist/index.mjs"), "utf8");
    expect(browserBuild).toContain("await thePool.removeVfs(true).catch(() => {});");
    expect(browserBuild).not.toContain("await thePool.removeVfs().catch(() => {});");
    expect(browserBuild).toContain("if (keepFiles) return true;");
  });
});
