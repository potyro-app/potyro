// Shares on disk: one folder per share, `<dir>/<first two of id>/<id>/`, holding `meta.json`,
// `payload.bin` and `preview` (when there is one). The sharer's "stop sharing" removes those three, and
// then the folder only if nothing else is in it.
// An operator's takedown (docs/16, "Taking a link down") writes `taken-down.json` into it FIRST — so
// the link answers 410 from that moment — and then removes the other three. The record is what stays.
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ShareStore, StoredShare, TakenDown } from "./store.ts";
import { ID_RE } from "./wire.ts";

export const TAKEN_DOWN_FILE = "taken-down.json";
const SHARE_FILES = ["meta.json", "payload.bin", "preview"] as const;

export function diskShareStore(dir: string): ShareStore {
  const folder = (id: string): string => {
    // The handler checks ids already; checked again here because this is where a path is built.
    if (!ID_RE.test(id)) throw new Error("bad share id");
    return join(dir, id.slice(0, 2), id);
  };
  const read = async (id: string, file: string): Promise<Buffer | null> => {
    try {
      return await readFile(join(folder(id), file));
    } catch {
      return null;
    }
  };
  const readJson = async <T>(id: string, file: string): Promise<T | null> => {
    const raw = await read(id, file);
    if (!raw) return null;
    try {
      return JSON.parse(raw.toString("utf8")) as T;
    } catch {
      return null;
    }
  };
  return {
    async put(id, share, payload, image) {
      const at = folder(id);
      await mkdir(at, { recursive: true });
      await writeFile(join(at, "payload.bin"), payload);
      if (image) await writeFile(join(at, "preview"), image);
      // Last: a share with a meta is a whole share.
      await writeFile(join(at, "meta.json"), JSON.stringify(share));
    },
    get: (id) => readJson<StoredShare>(id, "meta.json"),
    payload: async (id) => {
      const b = await read(id, "payload.bin");
      return b ? new Uint8Array(b) : null;
    },
    image: async (id) => {
      const b = await read(id, "preview");
      return b ? new Uint8Array(b) : null;
    },
    // The share's own files, then the folder only when it is empty: a takedown that lands while the
    // sharer's delete is under way leaves `taken-down.json`, which an `rm -rf` would have taken with it.
    async remove(id) {
      const at = folder(id);
      for (const file of SHARE_FILES) await rm(join(at, file), { force: true });
      try {
        await rmdir(at);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT") throw e;
      }
    },
    async takeDown(id, record) {
      const at = folder(id);
      await mkdir(at, { recursive: true });
      await writeFile(join(at, TAKEN_DOWN_FILE), JSON.stringify(record));
      for (const file of SHARE_FILES) await rm(join(at, file), { force: true });
    },
    takenDown: (id) => readJson<TakenDown>(id, TAKEN_DOWN_FILE),
  };
}
