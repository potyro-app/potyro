// Data-export bundle (KA-04). Packs an app's logic + data into a portable `.potyro.zip`:
//   data.sqlite   — a real SQLite file (opens in any SQLite browser / Datasette / CLI)
//   manifest.json — schemaVersion, provenance, granted caps, mode
//   app.ts        — the app's logic source, when available
//   data.json     — all entity rows as JSON (universal)
//   csv/<entity>.csv — per-entity CSV (universal)
// Re-import reads the bundle back and reopens the SQLite bytes as a working store. This is the
// on-ethos anti-lock-in guarantee: your data is a plain file you fully own.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { PotyroRecord } from "potyro";
import type { AppDeclaration } from "./app-declaration.js";

export type ExportMode = "snapshot" | "mergeable";

export interface ExportManifest {
  format: "potyro-bundle/1";
  appId: string;
  appVersion: string;
  schemaVersion: number;
  provenance: string;
  grantedCaps: string[];
  /** `snapshot` = stripped, human-friendly, one-way. `mergeable` = full state (CRDT once KA-08). */
  mode: ExportMode;
  exportedAt: string;
  entities: string[];
  /** What the app declares, as data (#271), so a device adding the bundle can describe it unrun. */
  app?: AppDeclaration;
}

export interface BundleInputs {
  sqlite: Uint8Array;
  manifest: ExportManifest;
  appSource?: string;
  /** All entity rows keyed by entity, for the universal JSON + CSV exports. */
  rowsByEntity?: Record<string, PotyroRecord[]>;
  /** The Studio conversation that made the app, when the person chose to include it (#261). */
  chat?: unknown;
}

export interface UnpackedBundle {
  manifest: ExportManifest;
  sqlite: Uint8Array;
  appSource?: string;
}

const MANIFEST = "manifest.json";
const SQLITE = "data.sqlite";
const APP = "app.ts";

function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render records as CSV. Columns are the sorted union of all keys across the rows. */
export function rowsToCsv(rows: PotyroRecord[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  const header = columns.map(csvCell).join(",");
  const lines = rows.map((r) => columns.map((c) => csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}

/** Assemble a `.potyro.zip` bundle from its parts. */
export function packBundle(input: BundleInputs): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [SQLITE]: input.sqlite,
    [MANIFEST]: strToU8(JSON.stringify(input.manifest, null, 2)),
  };
  if (input.appSource) files[APP] = strToU8(input.appSource);
  if (input.chat !== undefined) files["chat.json"] = strToU8(JSON.stringify(input.chat, null, 2));
  if (input.rowsByEntity) {
    files["data.json"] = strToU8(JSON.stringify(input.rowsByEntity, null, 2));
    for (const [entity, rows] of Object.entries(input.rowsByEntity)) {
      files[`csv/${entity}.csv`] = strToU8(rowsToCsv(rows));
    }
  }
  return zipSync(files);
}

/** Read a bundle back to its manifest + SQLite bytes (for reopening) + optional app source. */
export function unpackBundle(zip: Uint8Array): UnpackedBundle {
  const files = unzipSync(zip);
  const sqlite = files[SQLITE];
  if (!sqlite) throw new Error("bundle: missing data.sqlite");
  const manifestBytes = files[MANIFEST];
  if (!manifestBytes) throw new Error("bundle: missing manifest.json");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ExportManifest;
  if (manifest.format !== "potyro-bundle/1") throw new Error(`bundle: unsupported format "${manifest.format}"`);
  const app = files[APP];
  return { manifest, sqlite, appSource: app ? strFromU8(app) : undefined };
}
