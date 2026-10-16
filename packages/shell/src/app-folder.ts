// An app's folder, as the shell's Files surfaces handle it (#254): the Files tab on the Data page,
// the Studio's list of what an app ships with, and a file dropped on Potyro or opened with it.
//
// Over the same `fileSpace` an app's `ctx.files` reads (#252), so a file added here is the one the
// app sees, with the same rules: a path is taken by one file, an id survives a rename, and the
// folders that hold the app's own code (`.modules/`, `.src/`) are neither listed nor writable.
//
// One rule is the shell's own: a file the PERSON brings in never lands on top of one already there.
// It gets a free name beside it ("notes 2.md"). Overwriting is what Replace is for, asked by name.
import { t } from "@lingui/core/macro";
import type { FileInfo, FileOrigin } from "potyro";
import { FileSpaceError, fileSpace, isReservedPath, normalisePath, packAppPackage, type AppDeclaration, type AppLock, type EarlierCopy, type PackagedFile, type SpaceUsage, type Store } from "@potyro/store";

/** The person's files, by path: everything in the folder but the app's code. */
export async function listFolder(store: Store): Promise<FileInfo[]> {
  return (await fileSpace(store).list()).filter((f) => !isReservedPath(f.path));
}

/** `notes.md`, or `notes 2.md`, `notes 3.md`… — the first of them nobody has. */
export function freePath(taken: ReadonlySet<string>, path: string): string {
  if (!taken.has(path)) return path;
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  // The extension is everything after the first dot that is not the first character: "b.tar.gz".
  const dot = name.indexOf(".", 1);
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const next = `${folder}${stem} ${n}${ext}`;
    if (!taken.has(next)) return next;
  }
}

/** A path a person may use: normalised, and not one of the app's code folders. Throws in plain words. */
function personPath(raw: string): string {
  let path: string;
  try {
    path = normalisePath(raw);
  } catch (e) {
    throw new Error(e instanceof FileSpaceError && e.code === "invalid-path" && !raw.trim() ? t`A file needs a name` : t`“${raw}” cannot be a file’s name`);
  }
  if (isReservedPath(path)) throw new Error(t`“${path}” is kept for the app’s own code`);
  return path;
}

export interface BringInOptions {
  /** A folder inside the app's folder, `notes`; the top when absent. */
  folder?: string;
  /** `imported` (the default) for the person's own; `shipped` from the Studio, for what the app comes with. */
  origin?: FileOrigin;
}

/** Put files the person chose into the app's folder, each under a name nobody has yet. */
export async function bringIn(store: Store, files: readonly File[], opts: BringInOptions = {}): Promise<FileInfo[]> {
  const space = fileSpace(store);
  const taken = new Set((await space.list()).map((f) => f.path));
  const folder = (opts.folder ?? "").trim().replace(/^\/+|\/+$/g, "");
  const landed: FileInfo[] = [];
  for (const file of files) {
    const path = freePath(taken, personPath(folder ? `${folder}/${file.name}` : file.name));
    taken.add(path);
    landed.push(await space.write(path, file, { origin: opts.origin ?? "imported", mime: file.type || undefined }));
  }
  return landed;
}

async function mustFind(store: Store, id: string) {
  const f = await fileSpace(store).find({ id });
  if (!f || isReservedPath(f.path)) throw new Error(t`That file is no longer in this app`);
  return f;
}

/**
 * New bytes for a file, under its own name and id. The person brought them, so they are theirs
 * (`imported`) — which is also what keeps a replaced shipped file through an app update — unless the
 * Studio says they are what the app ships with.
 */
export async function replaceFile(store: Store, id: string, file: Blob, opts: { origin?: FileOrigin } = {}): Promise<FileInfo> {
  const f = await mustFind(store, id);
  return fileSpace(store).write(f.path, file, { origin: opts.origin ?? "imported", mime: file.type || undefined });
}

export async function renameFile(store: Store, id: string, to: string): Promise<FileInfo> {
  const f = await mustFind(store, id);
  const path = personPath(to);
  try {
    return await fileSpace(store).rename({ id: f.id }, path);
  } catch (e) {
    if (e instanceof FileSpaceError && e.code === "taken") throw new Error(t`There is already a file called ${path}`);
    throw e;
  }
}

export async function removeFile(store: Store, id: string): Promise<void> {
  const f = await mustFind(store, id);
  await fileSpace(store).remove({ id: f.id });
}

/** The bytes, or null when they are not on this device. */
export async function readFile(store: Store, id: string): Promise<Blob | null> {
  const f = await mustFind(store, id);
  return fileSpace(store).read({ id: f.id });
}

// ---- a shared app's files (#255) ----------------------------------------------------------------
//
// In a shared app every member has the LIST; the bytes come to a device when someone there reads the
// file, and stay. So the surfaces say which files are here — asking the store, never reading, since
// reading is what fetches — and a file that is not here arrives when it is opened.

/** Which of these files are on this device, by id. */
export async function filesHere(store: Store, files: readonly FileInfo[]): Promise<Map<string, boolean>> {
  const space = fileSpace(store);
  const out = new Map<string, boolean>();
  for (const f of files) out.set(f.id, await space.here({ id: f.id }).catch(() => false));
  return out;
}

/** Call `cb` when the file's bytes arrive on this device. A store with nothing to wait for never calls. */
export async function watchArrival(store: Store, id: string, cb: () => void): Promise<() => void> {
  const f = await mustFind(store, id);
  return store.subscribeBlob?.({ key: f.blob, mime: f.mime }, cb) ?? (() => {});
}

/** The copies of a file that newer writes replaced, newest first: kept for a while, then let go. */
export async function earlierCopies(store: Store, id: string): Promise<EarlierCopy[]> {
  const f = await mustFind(store, id);
  return fileSpace(store).earlier({ id: f.id });
}

/** Make an earlier copy the file again. What it replaces becomes an earlier copy in turn. */
export async function restoreCopy(store: Store, id: string, copy: EarlierCopy): Promise<FileInfo> {
  const f = await mustFind(store, id);
  return fileSpace(store).restoreEarlier({ id: f.id }, copy);
}

/**
 * Past this (10 MB, owner 2026-10-14), adding a file to a SHARED app is asked first. It is not the
 * limit — that is the space's budget on the relay (`SPACE_BUDGET`) — but a file there is kept,
 * encrypted, on the relay for good, and anyone in the app may fetch it: a film should not get there
 * by a slip of the thumb.
 */
export const LARGE_FOR_SHARING = 10 * 1024 * 1024;

/** A shared space's use of its relay budget, or null where nothing leaves the device (#255). */
export async function spaceUsageOf(store: Store): Promise<SpaceUsage | null> {
  return store.spaceUsage ? store.spaceUsage().catch(() => null) : null;
}

/** The files that are worth a question before they go into an app, given whether it is shared. */
export function largeForSharing(files: readonly File[], shared: boolean): File[] {
  return shared ? files.filter((f) => f.size > LARGE_FOR_SHARING) : [];
}

export type ViewKind = "text" | "image" | "audio" | "video" | "none";

const TEXTISH = /^(text\/|application\/(json|xml|yaml|javascript)|image\/svg\+xml$)/;

/** What the viewer can show of a file, from its type. */
export function viewKind(f: Pick<FileInfo, "name" | "mime">): ViewKind {
  const mime = f.mime.toLowerCase();
  if (mime === "image/svg+xml") return "image";
  if (TEXTISH.test(mime)) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "none";
}

export type FileView =
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "image" | "audio" | "video"; url: string }
  | { kind: "none" }
  | { kind: "missing" };

/** How much text the viewer shows before saying the rest is in the file. */
export const VIEW_LIMIT = 256 * 1024;

/** A file, read for the viewer: its text (up to `limit` characters), or a URL for a picture or a sound. */
export async function readForView(store: Store, id: string, opts: { limit?: number } = {}): Promise<FileView> {
  const f = await mustFind(store, id);
  const space = fileSpace(store);
  // Not here yet (a shared app, #255): ask for it — reading is what fetches — and say so now, rather
  // than wait on a network that may not be there. `watchArrival` tells when it lands.
  if (!(await space.here({ id: f.id }))) {
    void space.read({ id: f.id }).catch(() => {});
    return { kind: "missing" };
  }
  const blob = await space.read({ id: f.id });
  if (!blob) return { kind: "missing" };
  const kind = viewKind(f);
  if (kind === "text") {
    const limit = opts.limit ?? VIEW_LIMIT;
    const text = await blob.slice(0, limit * 4).text();
    return text.length > limit || blob.size > limit * 4 ? { kind: "text", text: text.slice(0, limit), cut: true } : { kind: "text", text, cut: false };
  }
  if (kind === "none") return { kind: "none" };
  return { kind, url: URL.createObjectURL(blob) };
}

/** The total size of some files, for a line under a heading. */
export const totalSize = (files: ReadonlyArray<{ size: number }>): number => files.reduce((n, f) => n + f.size, 0);

/**
 * The package the Studio saves (#253 format): the source, the files the app ships with, and its code
 * (libraries' bytes under `files/.modules/`, its own modules under `src/`, and their lock). What the
 * person added and what the app wrote are data, and stay with the person.
 */
export async function shippedPackage(
  store: Store,
  app: { source: string; sourceName?: string; lock: AppLock | undefined; code?: ReadonlyArray<{ path: string; data: Uint8Array }>; declared?: AppDeclaration; line?: string },
): Promise<Uint8Array> {
  const space = fileSpace(store);
  const files: PackagedFile[] = [];
  for (const f of await listFolder(store)) {
    if (f.origin !== "shipped") continue;
    const blob = await space.read({ id: f.id });
    if (blob) files.push({ path: f.path, data: new Uint8Array(await blob.arrayBuffer()), mime: f.mime });
  }
  const modules: PackagedFile[] = [];
  for (const c of app.code ?? []) {
    if (c.path.startsWith(".modules/")) files.push({ path: c.path, data: c.data, mime: "text/javascript" });
    else if (c.path.startsWith(".src/")) modules.push({ path: c.path.slice(".src/".length), data: c.data });
  }
  // Which app it is (docs/24 §11): a copy made from this package opens from the same links.
  return packAppPackage({ source: app.source, sourceName: app.sourceName ?? "app.tsx", files, modules, lock: app.lock, seed: undefined, chat: undefined, ...(app.declared ? { declared: app.declared } : {}), ...(app.line ? { line: app.line } : {}) });
}
