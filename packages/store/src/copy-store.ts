// Copy an app's data from one Store to another.
//
// Why this exists: sync is opt-in per app (ADR 0001 D3), and the two stores keep their data in
// DIFFERENT files. Flipping the flag without moving the records would open the app empty —
// indistinguishable from data loss, and the worst possible first impression for a sync feature.
// So the toggle is a copy, not a switch.
//
// ## What it preserves, and why each matters
//
// - `id` / `createdAt` — a record is referenced by id from relation fields and from `MediaRef`s;
//   re-generating ids would quietly sever every relation in the app.
// - blob KEYS — `MediaRef`s embedded in records point at a key. `putBlob` mints a new one, so a
//   naive copy loses every photo while appearing to succeed. Hence `putBlobWithKey`.
// - kv — `ctx.storage`, where apps keep their own state (the workout example keeps an in-progress
//   session there).
// - files — the app's own folder (#252): each entry with its id, and its bytes under the SAME blob
//   key, so a `file` field still points at it. An entry whose bytes are not on this device (a shared
//   app fetches them on demand) is reported, not copied: in a store with no peers it could never
//   arrive, and a file that can never be opened is worse than one listed as missing. Whether they
//   are here is ASKED (`blobHere`), never found out by reading: reading starts a fetch, and an export
//   of a shared app would otherwise pull every member's files through this device (#255). Its
//   earlier copies come along when their bytes are here, and are left out when they are not.
//
// ## It reports rather than pretends
//
// A target store that cannot write blobs under an existing key would silently drop media. Instead
// of guessing, the result names what could not be moved so the caller can refuse or warn. Nothing
// here deletes from the source: a failed migration must leave the original intact.

import type { PotyroRecord, MediaRef } from "potyro";
import type { Store } from "./types.js";
import { PEOPLE_KV, copyPeople } from "./people-log.js";

export interface CopyStoreResult {
  records: number;
  kv: number;
  blobs: number;
  /** Blob keys found in records that could not be copied, with the reason. Empty = clean copy. */
  skippedBlobs: Array<{ key: string; reason: string }>;
  /** Files in the app's folder that were copied. */
  files: number;
  /** Files that could not be, by path and size, with the reason. */
  skippedFiles: Array<{ path: string; size: number; reason: string }>;
  /** Placeholder people carried over (people-log.ts). */
  guests?: number;
}

/** A `MediaRef`-shaped value: `{ key, mime }` with anything else optional. */
function asMediaRef(v: unknown): MediaRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.key === "string" && typeof o.mime === "string" ? (o as unknown as MediaRef) : null;
}

/** Walk a record's values (including nested lists/objects) collecting every MediaRef. */
function collectMediaRefs(value: unknown, out: Map<string, MediaRef>): void {
  const ref = asMediaRef(value);
  if (ref) {
    out.set(ref.key, ref);
    return; // a MediaRef has no nested refs inside it
  }
  if (Array.isArray(value)) {
    for (const v of value) collectMediaRefs(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectMediaRefs(v, out);
  }
}

/**
 * Copy every record, blob and kv entry from `from` into `to`.
 *
 * `entities` must be supplied because the `Store` interface has no "list entities" call — the
 * caller has the app definition and therefore knows them. Passing an incomplete list would copy an
 * incomplete app, so callers should derive it from `definition.entities`, never hand-write it.
 */
export async function copyStoreData(
  from: Store,
  to: Store,
  opts: {
    entities: readonly string[];
    /**
     * Files of the app's folder to leave out, by path. An export leaves out the app's code
     * (`.modules/`, `.src/`): the bundle carries that beside its data, checked against the lock
     * (#282), and a data import must not put an older copy of it over the app's own.
     */
    skipFile?: (path: string) => boolean;
    /**
     * Who is copying, and the app's owners: guests (people-log.ts) are carried as what they add up
     * to, written by `me`. Absent, the local stand-in identity writes them.
     */
    people?: { me: string; admins?: readonly string[] };
  },
): Promise<CopyStoreResult> {
  const result: CopyStoreResult = { records: 0, kv: 0, blobs: 0, skippedBlobs: [], files: 0, skippedFiles: [] };
  const mediaRefs = new Map<string, MediaRef>();

  // Entities in the order given, which the callers take from the definition: an entity whose records
  // are shared one by one is declared before the ones that point at it, so a child finds its
  // parent's group here (record-sharing.ts). A child copied before its parent lands in the space.
  for (const entity of opts.entities) {
    const rows = await from.all(entity);
    for (const row of rows) {
      collectMediaRefs(row, mediaRefs);
      // `insert` honours a supplied id/createdAt, so relations and history survive the move.
      await to.insert(entity, row as Partial<PotyroRecord>);
      result.records++;
    }
  }

  for (const [key, ref] of mediaRefs) {
    const blob = await from.getBlob(ref);
    if (!blob) {
      result.skippedBlobs.push({ key, reason: "not found in the source store" });
      continue;
    }
    if (!to.putBlobWithKey) {
      result.skippedBlobs.push({ key, reason: "target store cannot write a blob under an existing key" });
      continue;
    }
    await to.putBlobWithKey(key, blob);
    result.blobs++;
  }

  // kv enumeration is optional on the interface. Without it the app's own state cannot be moved,
  // and saying so is better than a copy that looks complete.
  if (from.kvKeys) {
    for (const key of await from.kvKeys()) {
      // Guests move as people, below: their log is not the same thing in a synced store.
      if (key === PEOPLE_KV) continue;
      const value = await from.kvGet(key);
      if (value != null) {
        await to.kvSet(key, value);
        result.kv++;
      }
    }
  }

  const me = opts.people?.me ?? "local";
  result.guests = await copyPeople(from, to, me, new Set([me, ...(opts.people?.admins ?? [])]));

  const here = async (key: string, mime: string): Promise<Blob | null> =>
    from.blobHere && !(await from.blobHere({ key, mime })) ? null : from.getBlob({ key, mime });
  for (const entry of await from.listFiles()) {
    if (opts.skipFile?.(entry.path)) continue;
    const blob = await here(entry.blob, entry.mime);
    if (!blob) {
      result.skippedFiles.push({ path: entry.path, size: entry.size, reason: "its bytes are not on this device" });
      continue;
    }
    if (!to.putBlobWithKey) {
      result.skippedFiles.push({ path: entry.path, size: entry.size, reason: "target store cannot write a blob under an existing key" });
      continue;
    }
    await to.putBlobWithKey(entry.blob, blob);
    const earlier: NonNullable<typeof entry.earlier> = [];
    for (const copy of entry.earlier ?? []) {
      const bytes = await here(copy.blob, copy.mime);
      if (!bytes) continue;
      await to.putBlobWithKey(copy.blob, bytes);
      earlier.push(copy);
    }
    const { earlier: _all, ...bare } = entry;
    await to.setFile(earlier.length ? { ...bare, earlier } : bare);
    result.files++;
  }

  return result;
}
