// Add an app (#253): from files on this device, from a link, or from pasted source.
//
// Three ways in, one way through:
//
//   gather  → an AppPackage (source + shipped files + a one-time seed)
//   inspect → what it would install as, read in the sealed box: name, icon, what it keeps, what it
//             asks for, whether it is valid. Nothing runs with authority to answer that.
//   install → save it, put its shipped files in its folder, seed it the first time.
//
// Trust (owner, 2026-10-11): everything comes in sealed. A file from this device or pasted source may
// be marked "I wrote this, run it as mine" on the card; a link may not, it can be promoted later.
// The same app already installed: Replace is the default, through the ordinary update path, so
// History keeps the old version and the data check runs on the next open.
import { fileSpace, isZip, readAppPackage, sourcePackage, type AppPackage, type PackagedFile, type Store } from "@potyro/store";
import { inspectSource } from "./validate-app.js";
import { freeAppId, getUserApp, saveUserApp, type UserApp } from "./user-apps.js";
import { importChat, parseChatRecord } from "./studio-chat.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { sourceHttp } from "./ask-sources.js";

export type AddSource = "file" | "link" | "paste";

/** A source file, by name: the app module itself rather than something it ships with. */
const SOURCE_RE = /\.(app\.)?[jt]sx?$/i;
const APP_SOURCE_RE = /\.app\.[jt]sx?$/i;

const bytesOf = async (f: Blob): Promise<Uint8Array> => new Uint8Array(await f.arrayBuffer());

/**
 * Files the person picked, as one package. A zip is a package. Otherwise one of them is the app's
 * source — the `*.app.ts(x)` if there is one, else the only script — and the rest ship with it, by
 * name; a `seed.json` among them is the seed.
 */
export async function gatherFromFiles(files: File[]): Promise<AppPackage> {
  if (!files.length) throw new Error("No file was chosen");
  if (files.length === 1) {
    const bytes = await bytesOf(files[0]!);
    if (isZip(bytes)) return readAppPackage(bytes);
  }
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  if (zips.length) throw new Error("Choose a package zip on its own, or the app's source with the files it uses");
  const apps = files.filter((f) => APP_SOURCE_RE.test(f.name));
  const scripts = files.filter((f) => SOURCE_RE.test(f.name));
  const source = apps.length === 1 ? apps[0] : apps.length === 0 && scripts.length === 1 ? scripts[0] : undefined;
  if (!source) {
    throw new Error(
      apps.length > 1 || scripts.length > 1
        ? "More than one of these could be the app. Name the app's own file *.app.ts or *.app.tsx."
        : "None of these is an app: choose its source (a .ts or .tsx file) or a package zip.",
    );
  }
  const rest = files.filter((f) => f !== source);
  const seedFile = rest.find((f) => f.name === "seed.json");
  let seed: AppPackage["seed"];
  if (seedFile) {
    try {
      seed = JSON.parse(await seedFile.text());
    } catch (e) {
      throw new Error(`seed.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const shipped: PackagedFile[] = [];
  for (const f of rest) if (f !== seedFile) shipped.push({ path: f.name, data: await bytesOf(f), mime: f.type || undefined });
  return { source: await source.text(), sourceName: source.name, files: shipped, seed, kind: "package" };
}

/**
 * A link to a source file or a package zip.
 *
 * The browser's own fetch first: it can carry a zip's bytes. If the host refuses a browser (CORS),
 * the native app's HTTP stack is tried, which has no CORS but returns text — enough for a source,
 * not for a zip, and a zip that arrives as text is said to be one rather than misread.
 */
export async function gatherFromLink(url: string): Promise<AppPackage> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("That is not a link");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http and https links can be fetched");
  let bytes: Uint8Array;
  try {
    const res = await globalThis.fetch(parsed.href, { redirect: "follow" });
    if (!res.ok) throw new Error(`The link answered ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (first) {
    let text: string;
    try {
      const res = await sourceHttp(parsed.href, { method: "GET" });
      if (!res.ok) throw new Error(`The link answered ${res.status}`);
      text = await res.text();
    } catch {
      throw first instanceof Error && /answered/.test(first.message) ? first : new Error("The link could not be fetched from here");
    }
    if (text.startsWith("PK")) throw new Error("This link is a package zip, which this device can only fetch from a host that allows it. Download it and add it as a file.");
    return sourcePackage(text, parsed.pathname.split("/").pop() || "app.tsx");
  }
  if (isZip(bytes)) return readAppPackage(bytes);
  return sourcePackage(new TextDecoder().decode(bytes), parsed.pathname.split("/").pop() || "app.tsx");
}

export function gatherFromPaste(text: string): AppPackage {
  if (!text.trim()) throw new Error("Paste the app's source first");
  return sourcePackage(text);
}

/** What the card shows. */
export interface Inspected {
  id: string;
  name: string;
  icon?: string;
  /** The entities it keeps, by label. */
  keeps: string[];
  /** The same, by id: what a seed may fill. */
  entityIds: string[];
  /** The device capabilities it declares. */
  asks: string[];
  /** Structure problems. Non-empty means it would not install. */
  issues: string[];
  /** The installed app with the same id, if any. */
  installed?: UserApp;
  files: Array<{ path: string; size: number }>;
  seedRows: number;
}

const CAP_WORDS: Record<string, string> = {
  camera: "camera",
  notifications: "notifications",
  geo: "location",
  geolocation: "location",
  filesystem: "files outside the app",
  network: "the internet",
  haptics: "vibration",
  sync: "sharing",
};

export async function inspectPackage(pkg: AppPackage): Promise<Inspected> {
  let definition: unknown;
  let issues: string[];
  try {
    ({ definition, issues } = await inspectSource(pkg.source));
  } catch (e) {
    throw new Error(`This app does not load: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  const def = (definition ?? {}) as {
    id?: string;
    name?: string;
    icon?: string;
    entities?: Record<string, { label?: string }>;
    permissions?: Record<string, unknown>;
  };
  if (!def.id) throw new Error("This source does not define an app (no `defineApp` with an id)");
  const asks = Object.entries(def.permissions ?? {})
    .filter(([, v]) => v)
    .map(([k]) => CAP_WORDS[k] ?? k);
  return {
    id: def.id,
    name: def.name ?? def.id,
    icon: def.icon,
    keeps: Object.entries(def.entities ?? {}).map(([k, e]) => e?.label ?? k),
    entityIds: Object.keys(def.entities ?? {}),
    asks: [...new Set(asks)],
    issues,
    installed: getUserApp(def.id),
    files: pkg.files.map((f) => ({ path: f.path, size: f.data.byteLength })),
    seedRows: Object.values(pkg.seed ?? {}).reduce((n, rows) => n + rows.length, 0),
  };
}

export interface ShippedResult {
  written: string[];
  /** Shipped files the person changed since install: kept as they are. */
  kept: string[];
  /** Shipped files the new version no longer has. */
  removed: string[];
}

/**
 * Put a package's files in the app's folder as `shipped`. On an update, a shipped file is replaced
 * unless the person changed it since (it is then `app`, not `shipped`), and a shipped file the new
 * version dropped goes, unless the person changed it.
 */
export async function applyShippedFiles(store: Store, files: PackagedFile[], opts: { update: boolean }): Promise<ShippedResult> {
  const space = fileSpace(store);
  const result: ShippedResult = { written: [], kept: [], removed: [] };
  const incoming = new Set<string>();
  for (const f of files) {
    const existing = await space.find(f.path);
    incoming.add(existing?.path ?? f.path);
    if (existing && existing.origin !== "shipped") {
      result.kept.push(existing.path);
      continue;
    }
    const info = await space.write(f.path, new Blob([f.data as BlobPart], f.mime ? { type: f.mime } : {}), { origin: "shipped", mime: f.mime });
    result.written.push(info.path);
  }
  if (opts.update) {
    for (const f of await space.list()) {
      if (f.origin === "shipped" && !incoming.has(f.path)) {
        await space.remove(f.path);
        result.removed.push(f.path);
      }
    }
  }
  return result;
}

/** Insert a package's first records. Only entities the app declares; a row's own fields as given. */
export async function applySeed(store: Store, seed: AppPackage["seed"], entities: readonly string[]): Promise<number> {
  let n = 0;
  for (const [entity, rows] of Object.entries(seed ?? {})) {
    if (!entities.includes(entity)) continue;
    for (const row of rows) {
      await store.insert(entity, row as never);
      n++;
    }
  }
  return n;
}

export interface InstallOptions {
  source: AddSource;
  /** "I wrote this, run it as mine". Ignored for a link: a link is never trusted on the way in. */
  mine: boolean;
  /** When the app is already installed. */
  mode: "replace" | "copy";
  link?: string;
  /** Where its data opens. Injected in tests. */
  openStore?: (app: UserApp, opts: { sync: boolean }) => Promise<Store>;
  now?: string;
}

export interface Installed {
  app: UserApp;
  updated: boolean;
  files: ShippedResult;
  seeded: number;
}

export async function installPackage(pkg: AppPackage, inspected: Inspected, opts: InstallOptions): Promise<Installed> {
  if (inspected.issues.length) throw new Error(`This app has problems and was not added:\n${inspected.issues.join("\n")}`);
  const now = opts.now ?? new Date().toISOString();
  const existing = inspected.installed;
  const update = !!existing && opts.mode === "replace";
  const trusted = opts.source !== "link" && opts.mine;
  const from = opts.source === "link" ? (opts.link ?? "a link") : opts.source === "file" ? "a file" : "pasted source";
  const app = await saveUserApp(
    {
      id: update ? existing!.id : existing ? freeAppId(inspected.name) : inspected.id,
      name: inspected.name,
      source: pkg.source,
      // An update from a file or paste keeps the trust the app had: replacing your own app with a
      // newer build of it must not drop it into the sealed box. From a link it never does — a link
      // must not be able to put new code into an app that runs with full authority.
      trusted: update && opts.source !== "link" ? existing!.trusted === true || trusted : trusted,
      link: opts.source === "link" ? opts.link : undefined,
      origin: "imported",
      note: update ? `Updated from ${from}` : `Added from ${from}`,
    },
    now,
  );
  const open = opts.openStore ?? ((a: UserApp, o: { sync: boolean }) => openAppStore(a, o));
  const store = await open(app, { sync: await syncAllowedFor(app) });
  const files = await applyShippedFiles(store, pkg.files, { update });
  const seeded = update ? 0 : await applySeed(store, pkg.seed, inspected.entityIds);
  // How it was made, when its author chose to send that too (#261). Only on a first install: an
  // update must not overwrite the conversation the person has had with it since. Anything that is
  // not a conversation is ignored rather than refusing the app.
  const chat = pkg.chat === undefined || update ? null : parseChatRecord(pkg.chat);
  if (chat) await importChat(app.id, chat, now);
  return { app, updated: update, files, seeded };
}
