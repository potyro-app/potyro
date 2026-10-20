// Files in sample records (docs/24 §3): a seed names a picture or a document by the path of a file
// the app ships with, `{ "file": "photos/pancakes.webp" }`, and the device that writes the record
// turns it into what the field holds.
//
// A photo field's value is a `MediaRef` — a key into the store that took the picture — so a seed, which
// is JSON written on one device and read on another (a demo link, a package's seed.json), cannot hold
// one. It holds the file's path instead; the bytes travel as the package's shipped files, and the
// record gets a copy of them in its own store. A copy, not the file itself: the record's photo then
// lives as long as the record, whatever later happens to the file in the app's folder.
//
// A `file` field points AT a file in the app's folder (`FileRef`, #251): there the seed's path becomes
// the reference to the shipped file itself — a note's markdown, a plan — with the id the folder gave
// it, so the app reads it back with `ctx.files.text(ref)` as it reads any file of its own.

import type { FileRef, MediaRef } from "potyro";
import { fileSpace, type Store } from "@potyro/store";

/** What a seed holds where a photo or a document goes: the path of a file the app shipped with. */
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

/** The file at `path` in the app's folder, as a `file` field points at it; undefined when it is not there. */
export async function fileRefFromFile(store: Store, path: string): Promise<FileRef | undefined> {
  const info = await fileSpace(store).find(path);
  return info ? { id: info.id, path: info.path, name: info.name, mime: info.mime } : undefined;
}

/**
 * A seed row with every `{ file }` turned into what its field holds — a photo, or for a field named in
 * `fileFields` a reference to the shipped file — alone or in a list (a field of several). A file that
 * is not in the folder is left out: the record arrives without it.
 */
export async function resolveSeedFiles(store: Store, row: Record<string, unknown>, fileFields: ReadonlySet<string> = new Set()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const resolve = (path: string) => (fileFields.has(key) ? fileRefFromFile(store, path) : mediaFromFile(store, path));
    if (isSeedFile(value)) {
      const ref = await resolve(value.file);
      if (ref) out[key] = ref;
    } else if (Array.isArray(value) && value.length > 0 && value.every(isSeedFile)) {
      const refs: Array<MediaRef | FileRef> = [];
      for (const v of value) {
        const ref = await resolve(v.file);
        if (ref) refs.push(ref);
      }
      out[key] = refs;
    } else {
      out[key] = value;
    }
  }
  return out;
}
