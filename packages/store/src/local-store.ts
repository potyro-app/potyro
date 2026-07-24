// LocalStore — a browser-persistent Store backed by localStorage (or any Storage-like object).
// Satisfies M1's "persisted across reload" without OPFS SQLite (SqliteStore lands in WP3
// later). All state (records, blobs, kv, schema version) is serialized under one namespaced
// key and rewritten after each mutation. Personal-scale data only.

import type { Id, KartaRecord } from "karta";
import { MemoryStore } from "./memory-store.js";

/** The subset of the Web Storage API we use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Persisted {
  records: Record<string, Record<Id, KartaRecord>>;
  blobs: Record<string, { mime: string; base64: string }>;
  kv: Record<string, string>;
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
    this.storageKey = `karta:${appId}`;
    this.load();
  }

  private load(): void {
    const raw = this.backend.getItem(this.storageKey);
    if (!raw) {
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
    this.schemaVersion = data.schemaVersion ?? 0;
    this.loaded = true;
  }

  protected override changed(): void {
    if (!this.loaded) return; // don't persist during initial load
    const records: Persisted["records"] = {};
    for (const [entity, m] of this.records) records[entity] = Object.fromEntries(m);
    const blobs: Persisted["blobs"] = {};
    for (const [key, b] of this.blobs) blobs[key] = { mime: b.mime, base64: bytesToBase64(b.bytes) };
    const data: Persisted = { records, blobs, kv: Object.fromEntries(this.kv), schemaVersion: this.schemaVersion };
    this.backend.setItem(this.storageKey, JSON.stringify(data));
  }
}
