// Storage the browser will not open: set aside, and put back once it will.
//
// ## What happens
//
// Firefox keeps its own record of every file an origin has in OPFS, and of which of them are open.
// When that record is left saying "open" by a session that ended badly, a later Firefox can fail to
// reconcile it — and from then on answers every `createSyncAccessHandle` for the origin, on old files
// and new ones alike, with "UnknownError: Unknown failure". Measured on Firefox 157 against a copy of
// a profile it happened to (the same files opened in 153, and a plain kill of 157 does not cause it):
//
//   - restarting the browser changes nothing, and neither does reloading;
//   - READING still works: `getFile()` returns every file whole;
//   - removing the files works, and a file created afterwards still cannot be written — in that
//     browser session. After the files are gone AND the browser has been restarted, the origin's
//     storage works again.
//
// So nobody could get back into Potyro without editing the browser's profile by hand, with every
// record intact on disk the whole time.
//
// ## What this does about it
//
// `setAside` copies every pool file, byte for byte, into IndexedDB (which is a different store and
// keeps working), reads each one back to be sure of it, and only then removes the files from OPFS.
// The tab says the browser has to be restarted (`StorageStuckError`). On the next start `putBack`
// writes the files where they were — the pool keeps each database's name inside its file, so the
// same bytes are the same databases — and empties the stash. While the browser still refuses to
// write, the stash stays as it is and the tab says the same thing again: an app is never opened on
// an empty pool while its records wait in the stash.
//
// The order is what makes it safe to be interrupted anywhere: nothing is removed before the stash is
// marked whole, a stash without the mark is thrown away (the files are all still there), and putting
// back writes every file again from the start, so doing it twice is the same as doing it once.

/** What a worker answers when the browser's storage is stuck. */
export const STUCK = "storage-stuck";

/** The browser will not open its own storage until it is restarted. Not a failure to fall back from. */
export class StorageStuckError extends Error {
  readonly code = STUCK;
  constructor(message = "The browser's storage for Potyro is stuck until the browser is restarted") {
    super(message);
    this.name = "StorageStuckError";
  }
}

export function isStorageStuck(err: unknown): err is StorageStuckError {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === STUCK;
}

/**
 * The browser's own words for the state above. Deliberately only these: a file someone else holds
 * (`NoModificationAllowedError`) is another tab's, and anything else is not known to be cured by
 * setting the files aside.
 */
export function looksStuck(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: unknown }).name === "UnknownError";
}

/** One pool's files, as much of a directory as the rescue uses. */
export interface RescueDir {
  names(): Promise<string[]>;
  /** The whole file. Works while the browser refuses to open it for writing. */
  read(name: string): Promise<ArrayBuffer>;
  /** Make the file exactly these bytes, creating it if it is not there. */
  write(name: string, bytes: ArrayBuffer): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Where the files wait: IndexedDB in the browser. */
export interface RescueStash {
  put(key: string, bytes: ArrayBuffer): Promise<void>;
  get(key: string): Promise<ArrayBuffer | undefined>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** Written last: every file is in the stash and was read back the same. No "/" in it, so never a file's key. */
const WHOLE = "whole";
const keyOf = (directory: string, name: string): string => `${directory}/${name}`;

function same(a: ArrayBuffer, b: ArrayBuffer | undefined): boolean {
  if (!b || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * Copy every file of every pool into the stash, then remove them from where they were.
 *
 * `dirs` is keyed by the pool's directory ("/potyro"). Throws, with every file still in place, when
 * the stash cannot take them all or does not hand one back as it went in.
 */
export async function setAside(dirs: Record<string, RescueDir>, stash: RescueStash): Promise<void> {
  await stash.clear(); // a stash that was never finished: its files are all still in their pools
  const kept: Array<{ dir: RescueDir; name: string }> = [];
  for (const [directory, dir] of Object.entries(dirs)) {
    for (const name of await dir.names()) {
      const bytes = await dir.read(name);
      const key = keyOf(directory, name);
      await stash.put(key, bytes);
      if (!same(bytes, await stash.get(key))) throw new Error(`"${key}" did not come back from the stash as it went in`);
      kept.push({ dir, name });
    }
  }
  await stash.put(WHOLE, new ArrayBuffer(0));
  for (const { dir, name } of kept) await dir.remove(name);
}

/**
 * Write what was set aside back where it was. Answers whether there was anything.
 *
 * Throws what the browser throws while it still will not write; the stash is then exactly as it was.
 */
export async function putBack(dirOf: (directory: string) => Promise<RescueDir>, stash: RescueStash): Promise<boolean> {
  const keys = await stash.keys();
  if (keys.length === 0) return false;
  if (!keys.includes(WHOLE)) {
    await stash.clear();
    return false;
  }
  for (const key of keys) {
    if (key === WHOLE) continue;
    const cut = key.lastIndexOf("/");
    const bytes = await stash.get(key);
    if (!bytes) throw new Error(`"${key}" is no longer in the stash`);
    await (await dirOf(key.slice(0, cut))).write(key.slice(cut + 1), bytes);
  }
  await stash.clear();
  return true;
}
