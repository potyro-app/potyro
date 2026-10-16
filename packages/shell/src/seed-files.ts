// Photos in sample records (docs/24 §3): a seed names a picture by the path of a file the app ships
// with, `{ "file": "photos/pancakes.webp" }`, and the device that writes the record turns it into the
// record's own photo.
//
// A photo field's value is a `MediaRef` — a key into the store that took the picture — so a seed, which
// is JSON written on one device and read on another (a demo link, a package's seed.json), cannot hold
// one. It holds the file's path instead; the bytes travel as the package's shipped files, and the
// record gets a copy of them in its own store. A copy, not the file itself: the record's photo then
// lives as long as the record, whatever later happens to the file in the app's folder.

import type { MediaRef } from "potyro";
import { fileSpace, type Store } from "@potyro/store";

/** What a seed holds where a photo goes: the path of a file the app shipped with. */
export interface SeedFile {
  file: string;
}

export function isSeedFile(v: unknown): v is SeedFile {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as SeedFile).file === "string";
}

/** The file at `path` in the app's folder, as a photo of this store's own; undefined when it is not there. */
export async function mediaFromFile(store: Store, path: string): Promise<MediaRef | undefined> {
  const space = fileSpace(store);
  const info = await space.find(path);
  if (!info) return undefined;
  const blob = await space.read({ id: info.id });
  if (!blob) return undefined;
  return store.putBlob(blob.type ? blob : new Blob([blob], { type: info.mime }));
}

/**
 * A seed row with every `{ file }` turned into a photo — alone or in a list (a field of several
 * photos). A file that is not in the folder is left out: the record arrives without that picture.
 */
export async function resolveSeedFiles(store: Store, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isSeedFile(value)) {
      const ref = await mediaFromFile(store, value.file);
      if (ref) out[key] = ref;
    } else if (Array.isArray(value) && value.length > 0 && value.every(isSeedFile)) {
      const refs: MediaRef[] = [];
      for (const v of value) {
        const ref = await mediaFromFile(store, v.file);
        if (ref) refs.push(ref);
      }
      out[key] = refs;
    } else {
      out[key] = value;
    }
  }
  return out;
}
