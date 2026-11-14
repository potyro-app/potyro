// Who owns this browser's storage: one tab at a time.
//
// ## Why there has to be an owner
//
// Every database lives in one OPFS SAH pool (`sqlite-worker.ts`), and the pool works by holding an
// exclusive sync access handle on every file in its directory for as long as it is open. A second
// tab of the same origin starts a second worker, and that worker's pool asks for the same handles.
// It cannot have them, and sqlite-wasm says so loudly: one `NoModificationAllowedError` per file, then
// `removeVfs() failed with no recovery strategy` — because on a failed install it tries to DELETE the
// pool's directory, and only the first tab still holding the files stops it (see the patch in
// `patches/`). The tab then fell back to other storage: `localStorage` for a local app, a whole-file
// IndexedDB copy for the synced ones. Two tabs, two copies of the same apps, each one missing what was
// written in the other. Reported from two tabs of apps.vaz.io in Firefox; Chromium does the same.
//
// ## Why a lock, and not sharing the first tab's worker
//
// `createSyncAccessHandle` is exposed to dedicated workers only, so a SharedWorker cannot host the
// pool. Routing the second tab through the first tab's worker (a MessagePort over a BroadcastChannel)
// would give it the bytes but not the truth: every tab keeps its own in-memory model of what is
// stored — cojson's nodes, each store's subscriptions — and nothing would tell tab A what tab B just
// wrote. It would also need a hand-over for the moment the first tab closes, in the middle of somebody
// else's transaction. So the storage has ONE owner, decided by a Web Lock (Chromium, Firefox and
// WebKit all offer `navigator.locks` to workers), held by the owning worker for its whole life and let
// go by the browser when that tab goes away. Another tab says, in words, that Potyro is open
// elsewhere, and offers to take it over: `steal` moves the lock, the old owner hears it lost it, closes
// its databases when no transaction is open, and lets go of the files.
//
// ## Why the files are tried as well
//
// The lock says who SHOULD hold the files, not who does. A stolen lock moves at once while the old
// owner is still closing, a reload can start the new worker before the old one is gone, and a tab
// running a build from before this lock takes no lock at all. So before the pool is installed, every
// file it will claim is tried — opened for sync access and let go — and the install only happens when
// all of them are free. A pool install that cannot get its files is what deletes them.

/** The lock every owner of the pool holds. One name for the origin, whatever the database. */
export const STORAGE_LOCK = "potyro-storage";

/** What a worker answers when another tab owns the storage. */
export const ELSEWHERE = "storage-elsewhere";

/** Another tab (or another window of this browser) has the storage. Not a failure to fall back from. */
export class StorageElsewhereError extends Error {
  readonly code = ELSEWHERE;
  constructor(message = "Potyro is open in another tab") {
    super(message);
    this.name = "StorageElsewhereError";
  }
}

export function isStorageElsewhere(err: unknown): err is StorageElsewhereError {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === ELSEWHERE;
}

/** The part of `LockManager` this needs, so tests can drive it without a browser. */
export interface LockManagerLike {
  request(
    name: string,
    options: { mode?: "exclusive"; ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

export interface OwnStorageOpts {
  /** `navigator.locks`, where there is one. Without it only the files are tried. */
  locks?: LockManagerLike;
  /** Take the storage from whoever has it ("Use it here"), instead of waiting for it. */
  takeover: boolean;
  /** How long to wait for a lock that may be on its way out (a reload). */
  waitMs: number;
  /** True when every file the pool will claim can be had right now. */
  filesFree(): Promise<boolean>;
  /** How long to keep trying the files once the lock is ours (a stolen lock's old owner closing). */
  filesWithinMs: number;
  /** The lock was taken by another tab after it had been ours. */
  onLost(): void;
  sleep?(ms: number): Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Become the storage's one owner, or say why not.
 *
 * Resolves once the lock is held AND every file is free, so the pool can be installed without a
 * fight. Rejects with `StorageElsewhereError` when another tab has it; then nothing is held.
 */
export async function ownStorage(o: OwnStorageOpts): Promise<{ release(): void }> {
  const sleep = o.sleep ?? pause;
  let release: () => void = () => {};
  if (o.locks) release = await takeLock(o.locks, o);

  const deadline = Date.now() + o.filesWithinMs;
  try {
    for (;;) {
      if (await o.filesFree()) return { release };
      if (Date.now() >= deadline) break;
      await sleep(100);
    }
  } catch (err) {
    // The files could not even be asked about (storage-rescue.ts). Not ours, then: a lock kept here
    // is one the next open in this same worker waits on, and reports as another tab's.
    release();
    throw err;
  }
  // Somebody holds the files without holding the lock: an older build in another tab, most likely.
  // Hand the lock back, or this tab would keep the next one out while owning nothing.
  release();
  throw new StorageElsewhereError();
}

function takeLock(locks: LockManagerLike, o: OwnStorageOpts): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let held = false;
    let letGo: () => void = () => {};
    const timer = new AbortController();
    const timeout = o.takeover ? undefined : setTimeout(() => timer.abort(), o.waitMs);
    const options = o.takeover ? { mode: "exclusive" as const, steal: true } : { mode: "exclusive" as const, signal: timer.signal };
    locks
      .request(STORAGE_LOCK, options, () => {
        held = true;
        if (timeout) clearTimeout(timeout);
        // Held until `release` is called, or the worker ends: the browser lets go of a dead
        // context's locks, which is what makes a closed tab hand the storage on by itself.
        const holding = new Promise<void>((done) => (letGo = done));
        resolve(() => letGo());
        return holding;
      })
      .catch((err: unknown) => {
        if (timeout) clearTimeout(timeout);
        // After it was ours, a rejection means another tab stole it. Before, it means the wait ran
        // out with someone else holding it.
        if (held) o.onLost();
        else reject(isAbort(err) ? new StorageElsewhereError() : err);
      });
  });
}

const isAbort = (err: unknown): boolean => !!err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError";
