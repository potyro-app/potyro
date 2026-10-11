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
//   arrive, and a file that can never be opened is worse than one listed as missing.
//
// ## It reports rather than pretends
//
// A target store that cannot write blobs under an existing key would silently drop media. Instead
// of guessing, the result names what could not be moved so the caller can refuse or warn. Nothing
// here deletes from the source: a failed migration must leave the original intact.

import type { PotyroRecord, MediaRef } from "potyro";
import type { Store } from "./types.js";

export interface CopyStoreResult {
  records: number;
  kv: number;
  blobs: number;
  /** Blob keys found in records that could not be copied, with the reason. Empty = clean copy. */
  skippedBlobs: Array<{ key: string; reason: string }>;
  /** Files in the app's folder that were copied. */
  files: number;
  /** Files that could not be, by path, with the reason. */
  skippedFiles: Array<{ path: string; reason: string }>;
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
  opts: { entities: readonly string[] },
): Promise<CopyStoreResult> {
  const result: CopyStoreResult = { records: 0, kv: 0, blobs: 0, skippedBlobs: [], files: 0, skippedFiles: [] };
  const mediaRefs = new Map<string, MediaRef>();

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
      const value = await from.kvGet(key);
      if (value != null) {
        await to.kvSet(key, value);
        result.kv++;
      }
    }
  }

  for (const entry of await from.listFiles()) {
    const blob = await from.getBlob({ key: entry.blob, mime: entry.mime });
    if (!blob) {
      result.skippedFiles.push({ path: entry.path, reason: "its bytes are not on this device" });
      continue;
    }
    if (!to.putBlobWithKey) {
      result.skippedFiles.push({ path: entry.path, reason: "target store cannot write a blob under an existing key" });
      continue;
    }
    await to.putBlobWithKey(entry.blob, blob);
    await to.setFile(entry);
    result.files++;
  }

  return result;
}
