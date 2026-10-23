// What travels when a person moves their Potyro to a new site (docs/16 §Moving to a new home).
//
// One zip, `potyro-move/1`:
//
//   move.json            the manifest: every app with its registry record, what it holds, where it
//                        came from; the person's preferences; who they are (only over the window
//                        hand-over, never in a saved file)
//   apps/<id>.sqlite     each app's records, files, photos, `ctx.storage` and its own code, as a real
//                        SQLite file — the same snapshot an export makes (main.tsx `exportApp`)
//   shared/<store>.json  rows of the stores that are the person's rather than one app's: Studio
//                        conversations, version history, recorded cases, diagnoses
//
// Pure: nothing here reads the device or the network. Reading an archive is where everything
// that arrived is checked — a moved archive is data from another origin, and from a file it can be
// from anyone — so `readMoveArchive` refuses, by name, anything that is not exactly what a Potyro
// writes, and keeps what it accepts to the shapes the rest of the shell expects.

import { ICON_IMAGE_MAX } from "potyro";
import { t } from "@lingui/core/macro";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseCredit, parseLock, type AppCredit, type AppLock } from "@potyro/store";
import type { PortableIdentity } from "@potyro/identity";

export const MOVE_FORMAT = "potyro-move/1";

/** The stores that hold the person's things across apps, the record kind in each, and whose a row is. */
export const SHARED_STORES = {
  "studio-chat": { entity: "message", owner: "chatId" },
  "app-history": { entity: "version", owner: "appId" },
  "app-cases": { entity: "case", owner: "appId" },
  "app-diagnoses": { entity: "diagnosis", owner: "appId" },
} as const;
export type SharedStoreName = keyof typeof SHARED_STORES;
export const SHARED_STORE_NAMES = Object.keys(SHARED_STORES) as SharedStoreName[];

/** Preferences that are the person's and mean the same on any site. Nothing secret, nothing per-device. */
const GLOBAL_PREFS = ["potyro:look", "potyro:locale", "potyro:launcher:sort", "potyro:welcome:dismissed", "potyro:look:tiles-hint"];
/** Per-app preferences, `<prefix><appId>…`: what the app's lists are scoped to, its layout, its AI answers. */
export const APP_PREF_PREFIXES = ["potyro:scope:", "potyro:layout:", "potyro:fold:", "potyro:ai:", "potyro:ask-off:"];

/** Is this localStorage key a preference that may move? Checked on BOTH sides. */
export function isMovablePref(key: string): boolean {
  if (GLOBAL_PREFS.includes(key)) return true;
  return APP_PREF_PREFIXES.some((p) => key.startsWith(p) && APP_ID.test(appIdOfPref(key) ?? ""));
}

/** The app a per-app preference belongs to, or null for a global one. */
export function appIdOfPref(key: string): string | null {
  const prefix = APP_PREF_PREFIXES.find((p) => key.startsWith(p));
  if (!prefix) return null;
  return key.slice(prefix.length).split(":")[0] ?? null;
}

/** An app id as the registry makes them (user-apps.ts `slug`). */
export const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What the tile showed on the old site: the person's own labels for it, and how often it was opened. */
export interface MovedTile {
  displayName?: string;
  icon?: string;
  hue?: number;
  pinned?: boolean;
  order?: number;
  lastOpenedAt?: string;
  openCount?: number;
}

export interface MovedApp {
  id: string;
  name: string;
  source: string;
  /** Ran directly on the old site. Whether it does here is decided on arrival (move-bring-in.ts). */
  trusted: boolean;
  joined?: boolean;
  link?: string;
  lock?: AppLock;
  shipped?: string[];
  credit?: AppCredit;
  remixOf?: AppCredit;
  /** It was shared or synced there: it arrives as this site's own copy, with everything in it. */
  wasShared: boolean;
  /** A bundled example, still exactly as it was seeded (`untouched`) or changed since (`edited`). */
  example?: "untouched" | "edited";
  /** Its record kinds, so the data can be copied without running the app. */
  entities: string[];
  records: number;
  files: number;
  /** Files of a shared app whose bytes never reached the old site's device: listed, not carried. */
  missingFiles: number;
  tile?: MovedTile;
}

export interface MoveManifest {
  format: typeof MOVE_FORMAT;
  /** The site it was packed on. */
  from: string;
  createdAt: string;
  apps: MovedApp[];
  /** Rows per shared store. */
  shared: Partial<Record<SharedStoreName, number>>;
  /** Studio conversations, counted by their thread. */
  conversations: number;
  prefs: Record<string, string>;
  /** Over the window hand-over only. */
  identity?: PortableIdentity;
}

export interface MoveArchive {
  manifest: MoveManifest;
  /** Each app's SQLite snapshot, by app id. */
  data: Map<string, Uint8Array>;
  shared: Partial<Record<SharedStoreName, Array<Record<string, unknown>>>>;
}

export class MoveArchiveError extends Error {
  override name = "MoveArchiveError";
}

const LIMITS = {
  apps: 1000,
  /** One entry, uncompressed: a photo-heavy app's database. */
  entry: 1024 * 1024 * 1024,
  source: 5 * 1024 * 1024,
  pref: 200 * 1024,
  text: 200,
};

/** Pack an archive. Rows and snapshots are written as given; the manifest says what they are. */
export function packMoveArchive(archive: MoveArchive): Uint8Array {
  const files: Record<string, Uint8Array> = { "move.json": strToU8(JSON.stringify(archive.manifest)) };
  for (const [id, bytes] of archive.data) files[`apps/${id}.sqlite`] = bytes;
  for (const name of SHARED_STORE_NAMES) {
    const rows = archive.shared[name];
    if (rows?.length) files[`shared/${name}.json`] = strToU8(JSON.stringify(rows));
  }
  // Stored, not deflated: SQLite pages and photos barely compress, and this runs on the main thread.
  return zipSync(files, { level: 0 });
}

const ENTRY = /^(move\.json|apps\/[a-z0-9][a-z0-9-]{0,63}\.sqlite|shared\/[a-z-]+\.json)$/;

/** Read an archive back, refusing anything that is not exactly what `packMoveArchive` writes. */
export function readMoveArchive(bytes: Uint8Array): MoveArchive {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => ENTRY.test(f.name) && f.originalSize <= LIMITS.entry });
  } catch {
    throw new MoveArchiveError(t`This is not a file Potyro saved for moving.`);
  }
  const raw = files["move.json"];
  if (!raw) throw new MoveArchiveError(t`This is not a file Potyro saved for moving.`);
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(raw));
  } catch {
    throw new MoveArchiveError(t`The list of what is in this file is damaged.`);
  }
  const manifest = readManifest(json);
  const data = new Map<string, Uint8Array>();
  for (const app of manifest.apps) {
    const db = files[`apps/${app.id}.sqlite`];
    const name = app.name;
    if (!db) throw new MoveArchiveError(t`The records of “${name}” are missing from this file.`);
    data.set(app.id, db);
  }
  const shared: MoveArchive["shared"] = {};
  for (const name of SHARED_STORE_NAMES) {
    const entry = files[`shared/${name}.json`];
    if (!entry) continue;
    shared[name] = readRows(entry, SHARED_STORES[name].owner);
  }
  return { manifest, data, shared };
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = LIMITS.text): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

function readRows(bytes: Uint8Array, owner: string): Array<Record<string, unknown>> {
  let rows: unknown;
  try {
    rows = JSON.parse(strFromU8(bytes));
  } catch {
    throw new MoveArchiveError(t`Part of this file is damaged.`);
  }
  if (!Array.isArray(rows)) throw new MoveArchiveError(t`Part of this file is damaged.`);
  return rows.filter((r): r is Record<string, unknown> => isObject(r) && typeof r.id === "string" && typeof r[owner] === "string");
}

function readManifest(json: unknown): MoveManifest {
  if (!isObject(json) || json.format !== MOVE_FORMAT) throw new MoveArchiveError(t`This is not a file Potyro saved for moving.`);
  const from = str(json.from);
  if (!from) throw new MoveArchiveError(t`This file does not say which Potyro it came from.`);
  if (!Array.isArray(json.apps) || json.apps.length > LIMITS.apps) throw new MoveArchiveError(t`The list of apps in this file is damaged.`);
  const seen = new Set<string>();
  const apps = json.apps.map((a) => {
    const app = readApp(a);
    const name = app.name;
    if (seen.has(app.id)) throw new MoveArchiveError(t`“${name}” is in this file twice.`);
    seen.add(app.id);
    return app;
  });
  const prefs: Record<string, string> = {};
  if (isObject(json.prefs)) {
    for (const [k, v] of Object.entries(json.prefs)) {
      const value = str(v, LIMITS.pref);
      if (value !== undefined && isMovablePref(k)) prefs[k] = value;
    }
  }
  const shared: MoveManifest["shared"] = {};
  if (isObject(json.shared)) for (const name of SHARED_STORE_NAMES) if (count(json.shared[name])) shared[name] = count(json.shared[name]);
  const identity = readIdentity(json.identity);
  return {
    format: MOVE_FORMAT,
    from,
    createdAt: str(json.createdAt) ?? new Date(0).toISOString(),
    apps,
    shared,
    conversations: count(json.conversations),
    prefs,
    ...(identity ? { identity } : {}),
  };
}

function readApp(a: unknown): MovedApp {
  if (!isObject(a)) throw new MoveArchiveError(t`The list of apps in this file is damaged.`);
  const id = str(a.id);
  const name = str(a.name)?.trim();
  const source = str(a.source, LIMITS.source);
  if (!id || !APP_ID.test(id) || !name || !source) throw new MoveArchiveError(t`An app in this file is damaged.`);
  if (!Array.isArray(a.entities) || !a.entities.every((e) => typeof e === "string" && /^[A-Za-z_$][\w$-]{0,99}$/.test(e))) {
    throw new MoveArchiveError(t`“${name}” in this file is damaged.`);
  }
  let lock: AppLock | undefined;
  if (a.lock !== undefined) {
    try {
      lock = parseLock(JSON.stringify(a.lock));
    } catch {
      throw new MoveArchiveError(t`The libraries of “${name}” in this file are damaged.`);
    }
  }
  const shipped = Array.isArray(a.shipped) ? a.shipped.filter((p): p is string => typeof p === "string" && p.length <= 500) : undefined;
  const credit = parseCredit(a.credit);
  const remixOf = parseCredit(a.remixOf);
  const link = str(a.link, 4096);
  const example = a.example === "untouched" || a.example === "edited" ? a.example : undefined;
  const tile = readTile(a.tile);
  return {
    id,
    name,
    source,
    trusted: a.trusted === true,
    ...(a.joined === true ? { joined: true } : {}),
    ...(link ? { link } : {}),
    ...(lock ? { lock } : {}),
    ...(shipped?.length ? { shipped } : {}),
    ...(credit ? { credit } : {}),
    ...(remixOf ? { remixOf } : {}),
    wasShared: a.wasShared === true,
    ...(example ? { example } : {}),
    entities: [...new Set(a.entities as string[])],
    records: count(a.records),
    files: count(a.files),
    missingFiles: count(a.missingFiles),
    ...(tile ? { tile } : {}),
  };
}

function readTile(t: unknown): MovedTile | undefined {
  if (!isObject(t)) return undefined;
  const out: MovedTile = {};
  const displayName = str(t.displayName);
  const icon = str(t.icon, ICON_IMAGE_MAX);
  if (displayName) out.displayName = displayName;
  if (icon) out.icon = icon;
  if (typeof t.hue === "number" && Number.isInteger(t.hue) && t.hue >= 0 && t.hue < 360) out.hue = t.hue;
  if (t.pinned === true) out.pinned = true;
  if (typeof t.order === "number" && Number.isInteger(t.order) && t.order >= 0) out.order = t.order;
  const lastOpenedAt = str(t.lastOpenedAt, 40);
  if (lastOpenedAt && !Number.isNaN(Date.parse(lastOpenedAt))) out.lastOpenedAt = lastOpenedAt;
  if (count(t.openCount)) out.openCount = count(t.openCount);
  return Object.keys(out).length ? out : undefined;
}

function readIdentity(v: unknown): PortableIdentity | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  const secret = str(v.secret, 1000);
  const name = str(v.name) ?? "";
  const seed = str(v.seed, 1000);
  if (!id || !/^co_\w+$/.test(id) || !secret) return undefined;
  return { id, name, secret, ...(seed ? { seed } : {}) };
}

/** What a person is shown before anything comes in. Computed from the manifest alone. */
export interface MoveSummary {
  from: string;
  apps: Array<{ id: string; name: string; records: number; files: number; wasShared: boolean; sealed: boolean }>;
  records: number;
  files: number;
  missingFiles: number;
  conversations: number;
  /** Who they are comes too — the window hand-over carries it, a saved file never does. */
  identity: boolean;
}

/**
 * The summary, given how each app will run here (`sealed`, decided by move-bring-in.ts `arrivesTrusted`).
 * Sorted by name so the list reads the same on both sites.
 */
export function summarize(manifest: MoveManifest, sealed: (app: MovedApp) => boolean): MoveSummary {
  const apps = manifest.apps
    .map((a) => ({ id: a.id, name: a.name, records: a.records, files: a.files, wasShared: a.wasShared, sealed: sealed(a) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    from: manifest.from,
    apps,
    records: manifest.apps.reduce((n, a) => n + a.records, 0),
    files: manifest.apps.reduce((n, a) => n + a.files, 0),
    missingFiles: manifest.apps.reduce((n, a) => n + a.missingFiles, 0),
    conversations: manifest.conversations,
    identity: Boolean(manifest.identity),
  };
}

/** What the window hand-over offers before anything is sent: the manifest, and who — never the secrets. */
export interface MoveOffer {
  manifest: MoveManifest;
  identity: { id: string; name: string } | null;
}

export function offerOf(manifest: MoveManifest): MoveOffer {
  const { identity, ...rest } = manifest;
  return { manifest: rest, identity: identity ? { id: identity.id, name: identity.name } : null };
}

/** Read an offer that arrived by message, as strictly as an archive. Null when it is not one. */
export function readOffer(raw: unknown): MoveOffer | null {
  if (!isObject(raw)) return null;
  try {
    const manifest = readManifest(raw.manifest);
    if (manifest.identity) return null; // an offer never carries secrets
    const who = isObject(raw.identity) ? raw.identity : null;
    const id = who ? str(who.id) : undefined;
    const identity = id && /^co_\w+$/.test(id) ? { id, name: str(who?.name) ?? "" } : null;
    return { manifest, identity };
  } catch {
    return null;
  }
}

/** Does the archive that came hold exactly what was offered? */
export function matchesOffer(archive: MoveArchive, offer: MoveOffer): boolean {
  return JSON.stringify(offerOf(archive.manifest)) === JSON.stringify(offer);
}

/** SHA-256 of the archive, hex: what the offer promises and the archive must match. */
export async function archiveDigest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}
