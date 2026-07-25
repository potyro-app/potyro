import { describe, expect, it } from "vitest";
import { createMemorySqliteStore, packBundle, rowsToCsv, unpackBundle, type ExportManifest } from "../src/index.js";
import type { KartaRecord } from "karta";

// Data-export bundle (KA-04): CSV rendering, and a full pack → unpack → reopen round-trip proving
// the exported SQLite file is a real, self-contained database.

const manifest = (over: Partial<ExportManifest> = {}): ExportManifest => ({
  format: "karta-bundle/1",
  appId: "demo",
  appVersion: "1.0.0",
  schemaVersion: 1,
  provenance: "trusted",
  grantedCaps: ["geo"],
  mode: "snapshot",
  exportedAt: "2026-07-25T00:00:00Z",
  entities: ["note"],
  ...over,
});

describe("rowsToCsv", () => {
  it("emits a sorted-column header and escapes commas/quotes", () => {
    const rows = [{ id: "1", title: "a,b", note: 'he said "hi"' }] as unknown as KartaRecord[];
    const csv = rowsToCsv(rows);
    const [header] = csv.split("\n");
    expect(header).toBe("id,note,title"); // sorted union of keys
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"he said ""hi"""');
  });
});

describe("export bundle round-trip", () => {
  it("packs and re-opens as a working store with data intact", async () => {
    const first = await createMemorySqliteStore("demo");
    const a = await first.store.insert("note", { title: "Hello" });
    await first.store.insert("note", { title: "World" });
    const sqlite = first.store.exportSqlite();
    const rows = await first.store.all("note");
    first.destroy();

    const zip = packBundle({
      sqlite,
      manifest: manifest(),
      appSource: "export default defineApp({ id: 'demo' })",
      rowsByEntity: { note: rows },
    });

    const unpacked = unpackBundle(zip);
    expect(unpacked.manifest.appId).toBe("demo");
    expect(unpacked.manifest.mode).toBe("snapshot");
    expect(unpacked.appSource).toContain("defineApp");

    // Reopen the exported SQLite bytes on a "different device" → data survives.
    const reopened = await createMemorySqliteStore("demo", { bytes: unpacked.sqlite });
    const back = await reopened.store.all("note");
    expect(back.map((r) => r.title)).toEqual(["Hello", "World"]);
    expect(back[0]!.id).toBe(a.id);
    reopened.destroy();
  });

  it("rejects a malformed bundle", () => {
    expect(() => unpackBundle(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
