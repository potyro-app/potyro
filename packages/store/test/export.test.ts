import { describe, expect, it } from "vitest";
import { createMemorySqliteStore, importSqliteStore, packBundle, rowsToCsv, unpackBundle, type ExportManifest } from "../src/index.js";
import type { PotyroRecord } from "potyro";

// Data-export bundle (KA-04): CSV rendering, and a full pack → unpack → reopen round-trip proving
// the exported SQLite file is a real, self-contained database.

const manifest = (over: Partial<ExportManifest> = {}): ExportManifest => ({
  format: "potyro-bundle/1",
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
    const rows = [{ id: "1", title: "a,b", note: 'he said "hi"' }] as unknown as PotyroRecord[];
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

  it("reads a manifest that says mergeable, or names no mode, as a snapshot", () => {
    const sqlite = new Uint8Array([1, 2, 3]);
    for (const mode of ["mergeable", undefined]) {
      const legacy = { ...manifest(), mode } as unknown as ExportManifest;
      const unpacked = unpackBundle(packBundle({ sqlite, manifest: legacy }));
      expect(unpacked.manifest.mode).toBe("snapshot");
    }
  });

  it("still opens a bundle exported before the rename, as karta-bundle/1", async () => {
    const first = await createMemorySqliteStore("demo");
    await first.store.insert("note", { title: "Kept" });
    const zip = packBundle({ sqlite: first.store.exportSqlite(), manifest: manifest({ format: "karta-bundle/1" as never }) });
    first.destroy();

    const unpacked = unpackBundle(zip);
    expect(unpacked.manifest.format).toBe("potyro-bundle/1");
    const reopened = await createMemorySqliteStore("demo", { bytes: unpacked.sqlite });
    expect((await reopened.store.all("note")).map((r) => r.title)).toEqual(["Kept"]);
    reopened.destroy();
    expect(() => unpackBundle(packBundle({ sqlite: new Uint8Array([1]), manifest: manifest({ format: "other/1" as never }) }))).toThrow(/unsupported format/);
  });

  it("rejects a malformed bundle", () => {
    expect(() => unpackBundle(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("importSqliteStore reopens exported bytes as a working store (memory fallback in Node)", async () => {
    const first = await createMemorySqliteStore("demo");
    await first.store.insert("note", { title: "Imported" });
    const bytes = first.store.exportSqlite();
    first.destroy();

    const store = await importSqliteStore("demo", unpackBundle(packBundle({ sqlite: bytes, manifest: manifest() })).sqlite);
    expect((await store.all("note")).map((r) => r.title)).toEqual(["Imported"]);
  });
});
