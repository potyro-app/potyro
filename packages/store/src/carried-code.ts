// An app's code beyond its source, as it travels WITH the source (#281).
//
// A share link and your account each carry an app's source. An app that imports libraries (#266) or
// has modules of its own (#258) needs more than that to open, and before this it arrived without it:
// "this app uses chart.js, which is not part of this app yet". Two additive fields fix that, beside
// the source in the shared space's published app (`app-sync.ts`) and in the account registry
// (`account-apps.ts`):
//
//   lock     the whole lock: each library by URL, each module by `src/<path>`, with the digest of
//            the bytes. Small JSON. The receiver fetches the libraries ONCE, with consent, and keeps
//            only bytes that match it — a URL no longer serving them is refused by name.
//   modules  the app's own modules, `src/<path>` → their text. They travel here, not through a
//            fetch, because there is nowhere else to get them: they have no upstream, they are part
//            of the app's code in the same way its source is (an edit to the app may change both),
//            and they are a few KB. Carried in the SAME record as the source, a new source can never
//            arrive ahead of the module it imports. They are checked against the lock on arrival
//            like every other byte of code.
//
// Library bytes do NOT travel: p5 alone is megabytes, and they have an address that serves them.
//
// Older clients ignore both fields, and a record without them — written by one — reads as an app with
// no code beyond its source, which is exactly what it was.
import { LockError, matchesLock, parseLock, srcKey, SRC_DIR, type AppLock } from "./app-lock.js";
import type { PackagedFile } from "./app-package.js";

export interface CarriedCode {
  lock?: AppLock;
  modules?: Record<string, string>;
}

const isSrc = (key: string): boolean => key.startsWith(srcKey(""));
const hasEntries = (lock: AppLock | undefined): lock is AppLock => !!lock && Object.keys(lock).length > 0;

/**
 * The code to carry for an app whose lock is `lock`, its modules read through `read` (the bytes of a
 * file in its space, or null when they are not on this device). A module that is not here, or no
 * longer matches the lock, is left out: the receiver hears it is missing rather than gets a copy that
 * would be refused.
 */
export async function carryCode(lock: AppLock | undefined, read: (file: string) => Promise<Uint8Array | null>): Promise<CarriedCode> {
  if (!hasEntries(lock)) return {};
  const modules: Record<string, string> = {};
  for (const [key, entry] of Object.entries(lock)) {
    if (!isSrc(key)) continue;
    const bytes = await read(entry.file);
    if (bytes && (await matchesLock(entry, bytes))) modules[key] = new TextDecoder().decode(bytes);
  }
  return Object.keys(modules).length ? { lock, modules } : { lock };
}

/**
 * The carried code on a stored record, read leniently: a missing or malformed lock reads as none, and
 * only text modules the lock names are kept. A broken field must never stop the app itself arriving.
 */
export function readCarriedCode(raw: Record<string, unknown>): CarriedCode {
  let lock: AppLock | undefined;
  if (raw.lock && typeof raw.lock === "object" && !Array.isArray(raw.lock)) {
    try {
      lock = parseLock(JSON.stringify(raw.lock));
    } catch {
      lock = undefined;
    }
  }
  if (!hasEntries(lock)) return {};
  const modules: Record<string, string> = {};
  const given = raw.modules && typeof raw.modules === "object" && !Array.isArray(raw.modules) ? (raw.modules as Record<string, unknown>) : {};
  for (const [key, text] of Object.entries(given)) if (isSrc(key) && lock[key] && typeof text === "string") modules[key] = text;
  return Object.keys(modules).length ? { lock, modules } : { lock };
}

/**
 * The modules that arrived, as files for the app's `.src/` folder — each checked against the lock
 * first. One that does not match is refused by name and nothing is kept.
 */
export async function carriedModuleFiles(code: CarriedCode): Promise<PackagedFile[]> {
  const files: PackagedFile[] = [];
  for (const [key, text] of Object.entries(code.modules ?? {})) {
    const entry = code.lock?.[key];
    if (!entry) continue;
    const data = new TextEncoder().encode(text);
    if (!(await matchesLock(entry, data))) {
      throw new LockError(`Its file ${key.slice(srcKey("").length)} is not the copy this app was saved with, so it was not added.`);
    }
    files.push({ path: SRC_DIR + key.slice(srcKey("").length), data, mime: "text/plain" });
  }
  return files;
}

const canonical = (lock: AppLock | undefined): string =>
  JSON.stringify(
    Object.keys(lock ?? {})
      .sort()
      .map((k) => {
        const e = lock![k]!;
        return [k, e.file, e.integrity, e.size, e.base ?? null];
      }),
  );

/** Whether two locks name the same code. No lock and an empty one are the same: no code beyond the source. */
export function sameCode(a: AppLock | undefined, b: AppLock | undefined): boolean {
  return canonical(a) === canonical(b);
}
