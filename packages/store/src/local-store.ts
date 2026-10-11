// LocalStore — a browser-persistent Store backed by localStorage (or any Storage-like object).
// Satisfies M1's "persisted across reload" without OPFS SQLite (SqliteStore lands in WP3
// later). All state (records, blobs, kv, schema version) is serialized under one namespaced
// key and rewritten after each mutation. Personal-scale data only.

import type { Id, PotyroRecord } from "potyro";
import { MemoryStore } from "./memory-store.js";
import type { StoredFile } from "./types.js";

/** The subset of the Web Storage API we use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Persisted {
  records: Record<string, Record<Id, PotyroRecord>>;
  blobs: Record<string, { mime: string; base64: string }>;
  kv: Record<string, string>;
  /** Absent in data written before files existed (#252). */
  files?: Record<string, StoredFile>;
  schemaVersion: number;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  const g = globalThis as { btoa?: (s: string) => string };
  return g.btoa ? g.btoa(bin) : Buffer.from(u8).toString("base64");
}

function base64ToBytes(b64: string): ArrayBuffer {
  const g = globalThis as { atob?: (s: string) => string };
  const bin = g.atob ? g.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

export class LocalStore extends MemoryStore {
  private backend: StorageLike;
  private storageKey = "";
  private loaded = false;

  constructor(backend?: StorageLike) {
    super();
    const g = globalThis as { localStorage?: StorageLike };
    const resolved = backend ?? g.localStorage;
    if (!resolved) throw new Error("LocalStore: no Storage backend available (pass one explicitly)");
    this.backend = resolved;
  }

  override async open(appId: string): Promise<void> {
    await super.open(appId);
    this.storageKey = `potyro:${appId}`;
    this.load();
  }

  private load(): void {
    const raw = this.backend.getItem(this.storageKey);
    if (!raw) {
      // Nothing stored means nothing is in this store — which matters on the path back from a
      // failed write, where memory is ahead of storage and has to be put back.
      this.records = new Map();
      this.blobs = new Map();
      this.kv = new Map();
      this.files = new Map();
      this.loaded = true;
      return;
    }
    const data = JSON.parse(raw) as Persisted;
    this.records = new Map(
      Object.entries(data.records).map(([entity, rows]) => [entity, new Map(Object.entries(rows))]),
    );
    this.blobs = new Map(
      Object.entries(data.blobs).map(([key, b]) => [key, { mime: b.mime, bytes: base64ToBytes(b.base64) }]),
    );
    this.kv = new Map(Object.entries(data.kv));
    this.files = new Map(Object.entries(data.files ?? {}));
    this.schemaVersion = data.schemaVersion ?? 0;
    this.loaded = true;
  }

  protected override changed(): void {
    if (!this.loaded) return; // don't persist during initial load
    const records: Persisted["records"] = {};
    for (const [entity, m] of this.records) records[entity] = Object.fromEntries(m);
    const blobs: Persisted["blobs"] = {};
    for (const [key, b] of this.blobs) blobs[key] = { mime: b.mime, base64: bytesToBase64(b.bytes) };
    const data: Persisted = { records, blobs, kv: Object.fromEntries(this.kv), files: Object.fromEntries(this.files), schemaVersion: this.schemaVersion };
    try {
      this.backend.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      // Everything lives under one key, so a write that does not fit leaves memory holding a change
      // storage never took. Left alone, the store is then wrong AND every later write fails on the
      // same overflowing photo — the app stops being able to save anything at all. So put memory
      // back to what is actually stored, and say something a person can act on: the browser's own
      // "The quota has been exceeded" names neither what failed nor what to do about it.
      this.load();
      throw new QuotaError(
        "There is no room left for that on this device. This browser keeps the whole app in a small store (a few megabytes), and one photo from a camera usually fills it.",
      );
    }
  }
}

/** Thrown when a write does not fit in the browser's storage. Named so callers can tell it apart. */
export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

/** Every browser signals a full store differently; none of them agree on a name or a code. */
function isQuotaError(e: unknown): boolean {
  if (e instanceof QuotaError) return true;
  const err = e as { name?: string; code?: number; message?: string } | null;
  if (!err) return false;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message ?? "")
  );
}
