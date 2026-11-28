// The account on disk: `<dir>/key.pem` (the private key, readable by the service only) and one JSON
// file per part (`feed.json`, `notes.json`, `followers.json`, `outgoing.json`). A part is written to a file
// beside it and moved into place, so a crash mid-write leaves the old file whole.
//
// `key.pem` IS the account: other servers know it by this key. Losing it means every follower has
// to follow again; it is in the backup (docs/16).
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newPrivateKey, type FediStore, type Parts } from "./store.ts";

const KEY_FILE = "key.pem";

const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "ENOENT";

export function diskStore(dir: string): FediStore {
  const file = (part: keyof Parts): string => join(dir, `${part}.json`);
  // One write of a part at a time, in the order they were asked for.
  let last: Promise<void> = Promise.resolve();
  const replace = async (path: string, text: string, mode: number): Promise<void> => {
    await mkdir(dir, { recursive: true });
    const draft = `${path}.new`;
    await writeFile(draft, text, { mode });
    await rename(draft, path);
  };
  return {
    async read<K extends keyof Parts>(part: K): Promise<Parts[K] | null> {
      try {
        return JSON.parse(await readFile(file(part), "utf8")) as Parts[K];
      } catch (e) {
        if (missing(e)) return null;
        // A part that is there and cannot be read stops the service: starting empty would forget
        // every follower, or post everything again.
        throw new Error(`${file(part)} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    write(part, value) {
      const text = JSON.stringify(value);
      last = last.catch(() => undefined).then(() => replace(file(part), text, 0o600));
      return last;
    },
    async privateKey() {
      const path = join(dir, KEY_FILE);
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if (!missing(e)) throw e;
      }
      const pem = newPrivateKey();
      await replace(path, pem, 0o600);
      await chmod(path, 0o600);
      return pem;
    },
  };
}
