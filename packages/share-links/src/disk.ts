// Shares on disk: one folder per share, `<dir>/<first two of id>/<id>/`, holding `meta.json`,
// `payload.bin` and `preview` (when there is one). Taking a share down is removing its folder — the
// same for the sharer's "stop sharing" and for an operator acting on a notice (docs/16).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ShareStore, StoredShare } from "./store.ts";
import { ID_RE } from "./wire.ts";

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
  return {
    async put(id, share, payload, image) {
      const at = folder(id);
      await mkdir(at, { recursive: true });
      await writeFile(join(at, "payload.bin"), payload);
      if (image) await writeFile(join(at, "preview"), image);
      // Last: a share with a meta is a whole share.
      await writeFile(join(at, "meta.json"), JSON.stringify(share));
    },
    async get(id) {
      const raw = await read(id, "meta.json");
      if (!raw) return null;
      try {
        return JSON.parse(raw.toString("utf8")) as StoredShare;
      } catch {
        return null;
      }
    },
    payload: async (id) => {
      const b = await read(id, "payload.bin");
      return b ? new Uint8Array(b) : null;
    },
    image: async (id) => {
      const b = await read(id, "preview");
      return b ? new Uint8Array(b) : null;
    },
    remove: (id) => rm(folder(id), { recursive: true, force: true }),
  };
}
