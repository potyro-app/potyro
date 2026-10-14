// Files that arrive from outside Potyro (#254): dropped on its window, shared to it from another app,
// or opened with it on Android. One way through, whatever the door:
//
//   an app (a package zip, an `.app.ts`, a script that defines one) → Add an app, as if it had been
//                                                                       chosen there (#253);
//   anything else                                                    → "Add to which app?", and then
//                                                                       that app's folder, as the
//                                                                       person's own (`imported`).
//
// The files are held here, in memory, from the moment they arrive until the person has chosen: a
// `File` cannot survive a reload, and does not need to — a drop or a share happens in front of them.
import type { FileInfo } from "potyro";
import { AppPackageError, isZip, readAppPackage, type Store } from "@potyro/store";
import { matchesAccept } from "@potyro/views";
import { bringIn } from "./app-folder.js";
import { declaredEntities } from "./source-declared.js";
import { readSharedFile, type SharedFileRef } from "@potyro/native";

const APP_SOURCE = /\.app\.[jt]sx?$/i;
const SCRIPT = /\.[jt]sx?$/i;

/** Whether what arrived is an app to add, rather than files for one. */
export async function isAppArrival(files: readonly File[]): Promise<boolean> {
  if (!files.length) return false;
  if (files.some((f) => APP_SOURCE.test(f.name))) return true;
  if (files.length === 1) {
    const only = files[0]!;
    const head = new Uint8Array(await only.slice(0, 4).arrayBuffer());
    if (isZip(head)) {
      try {
        readAppPackage(new Uint8Array(await only.arrayBuffer()));
        return true;
      } catch (e) {
        if (e instanceof AppPackageError) return false; // a zip, but of something else: a file like any other
        throw e;
      }
    }
    if (SCRIPT.test(only.name)) return /\bdefineApp\s*\(/.test(await only.text());
  }
  return false;
}

interface AppLike {
  id: string;
  source: string;
}

/**
 * The apps that say they take files like these — a `file` field whose `accept` matches every one of
 * them — in the order given. Read from each app's source, never by running it.
 */
export async function fitsFor(files: readonly File[], apps: readonly AppLike[]): Promise<string[]> {
  const fits: string[] = [];
  for (const app of apps) {
    const entities = await declaredEntities(app.source).catch(() => null);
    const accepts: string[] = [];
    for (const e of Object.values(entities ?? {})) {
      for (const f of Object.values(e.fields)) if (f.type === "file") accepts.push(typeof f.accept === "string" ? f.accept : "");
    }
    const takes = (file: File): boolean => accepts.some((a) => a !== "" && matchesAccept({ name: file.name, mime: file.type }, a));
    if (accepts.length && files.every(takes)) fits.push(app.id);
  }
  return fits;
}

// ---- where they land ---------------------------------------------------------------------------

/** How long files that just landed are pointed out for: long enough for the page that shows them to open. */
const ARRIVED_FOR_MS = 10_000;
const arrived = new Map<string, { ids: string[]; at: number }>();

/** Put the files in the app's folder as the person's, and remember them so its Files tab can point them out. */
export async function landFiles(store: Store, appId: string, files: readonly File[], now: () => number = Date.now): Promise<FileInfo[]> {
  const landed = await bringIn(store, files);
  arrived.set(appId, { ids: landed.map((f) => f.id), at: now() });
  return landed;
}

/** The files that just landed in this app, while they are new. Read, not taken: a render may run twice. */
export function arrivedIn(appId: string, now: () => number = Date.now): string[] {
  const hit = arrived.get(appId);
  if (!hit || now() - hit.at > ARRIVED_FOR_MS) return [];
  return hit.ids;
}

// ---- the offer ---------------------------------------------------------------------------------

let pending: File[] | null = null;
const listeners = new Set<(files: File[]) => void>();

/** Files arrived: hold them, and tell whoever is showing the question. */
export function offerFiles(files: File[]): void {
  if (!files.length) return;
  pending = files;
  for (const l of listeners) l(files);
}

export function onOffer(cb: (files: File[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The files waiting for an answer, once. */
export function takeOffer(): File[] | null {
  const files = pending;
  pending = null;
  return files;
}

/**
 * Files Android handed over — shared to Potyro, or opened with it — read and offered like a drop.
 * One that cannot be read is said so, and the rest still arrive.
 */
export async function receiveSharedFiles(refs: readonly SharedFileRef[], read: (ref: SharedFileRef) => Promise<File> = readSharedFile): Promise<void> {
  const files: File[] = [];
  for (const ref of refs) {
    try {
      files.push(await read(ref));
    } catch (e) {
      console.warn(`[potyro] could not read the shared file ${ref.name}:`, e);
    }
  }
  offerFiles(files);
}
