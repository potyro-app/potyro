// The app's own folder (#252), on top of any Store.
//
// A store keeps two things for files: an index of entries by id (`listFiles` / `setFile` / …) and the
// bytes, as blobs. Everything that makes those a folder lives here, once, so the three stores cannot
// disagree about it:
//
//   - a path is normalised the same way everywhere, and is taken by one file at a time;
//   - the id is the identity and survives a rename, which is what lets a `file` field keep pointing
//     at a note after it moves;
//   - replacing a file's bytes keeps its id, created time and (unless it was shipped) its origin;
//   - a type comes from the caller, else the blob, else the extension;
//   - every write records a digest of the bytes, which is how an app update will tell a shipped file
//     the person changed from one they did not (#253).
//
// Bytes are written BEFORE the entry that points at them, and the old bytes are dropped AFTER the
// entry moved off them: an entry pointing at nothing would read as a broken file, while unreferenced
// bytes are only wasted space.
//
// In a shared app (#255) two members can write the same file. The last write wins, at the file level
// — nothing merges two versions of a text — and what it replaced is kept as an EARLIER COPY, for a
// while: the last few, from the last month. Two members who each made the same path while apart
// meet as two entries at one path; the folder shows the newer one, and the other is its earlier
// copy until the next write folds it in. Earlier copies are the folder's, never the app's: `ctx.files`
// sees a file as `FileInfo`, without them.
import type { FileInfo, FileOrigin, FileRef } from "potyro";
import type { EarlierCopy, Store, StoredFile } from "./types.js";
import { ulid } from "./ulid.js";

/** A file named by its path, or by the `FileRef` a `file` field holds. */
export type FileTarget = string | FileRef;

export type FileSpaceErrorCode = "invalid-path" | "no-file" | "taken" | "space-full";

export class FileSpaceError extends Error {
  constructor(
    readonly code: FileSpaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FileSpaceError";
  }
}

/**
 * A write a shared space has no room for (#255): what it holds on the relay, its budget, and what
 * the write needed. Nothing was written.
 */
export class SpaceFullError extends FileSpaceError {
  constructor(
    readonly used: number,
    readonly budget: number,
    readonly needed: number,
  ) {
    const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
    super("space-full", `This app's shared space is full: ${mb(used)} of ${mb(budget)} is used, and this file needs ${mb(needed)}.`);
    this.name = "SpaceFullError";
  }
}

/**
 * A path as the folder keeps it: `/`-separated, no leading slash, no empty, `.` or `..` segment.
 * Backslashes are read as slashes, so a path typed on Windows lands in the same place.
 */
export function normalisePath(input: string): string {
  if (typeof input !== "string") throw new FileSpaceError("invalid-path", "a file path must be a string");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(input)) throw new FileSpaceError("invalid-path", `"${input}" has a control character in it`);
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  if (trimmed.endsWith("/")) throw new FileSpaceError("invalid-path", `"${input}" names a folder, not a file`);
  const parts = trimmed.split("/").filter((p) => p !== "");
  if (!parts.length) throw new FileSpaceError("invalid-path", "a file path cannot be empty");
  for (const p of parts) {
    if (p === "." || p === "..") throw new FileSpaceError("invalid-path", `"${input}" may not use "${p}"`);
  }
  return parts.join("/");
}

/** A folder prefix for `list`: `""` for everything, otherwise `notes/`. */
function folderPrefix(folder: string | undefined): string {
  const bare = (folder ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (bare === "" || bare === ".") return "";
  return `${normalisePath(bare)}/`;
}

const MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mid: "audio/midi",
  midi: "audio/midi",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  zip: "application/zip",
};

/** The type a file is stored with: the caller's, else the blob's own, else from the extension. */
export function mimeOf(path: string, given?: string): string {
  if (given && given.trim()) return given.trim();
  const ext = path.split("/").pop()?.split(".").slice(1).pop()?.toLowerCase();
  return (ext && MIME[ext]) || "application/octet-stream";
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A digest of the bytes. SHA-256 where the platform has it. `crypto.subtle` exists only in a secure
 * context, and the shell is sometimes served over plain http on a LAN, so there is a fallback: two
 * FNV-1a passes. The digest only has to tell changed from unchanged, and the prefix says which one
 * was used, so two devices never compare one kind against the other as if they matched.
 */
export async function digest(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) return `sha256-${hex(new Uint8Array(await subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)))}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i]!, 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[bytes.length - 1 - i]!, 0x01000193) >>> 0;
  }
  return `fnv-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}${bytes.length.toString(16)}`;
}

/** What the app sees: the entry without the store's blob key or its earlier copies. */
export function fileInfo(entry: StoredFile): FileInfo {
  const { blob: _blob, earlier: _earlier, ...info } = entry;
  return info;
}

/** How many earlier copies of a file are kept, and for how long after they were replaced. */
export const KEEP_EARLIER = 3;
export const EARLIER_FOR_MS = 30 * 24 * 3600 * 1000;

/** Of several entries at one path, the one the folder shows: the newest write, then the larger id. */
function newest(a: StoredFile, b: StoredFile): StoredFile {
  if (a.updated !== b.updated) return a.updated > b.updated ? a : b;
  return a.id > b.id ? a : b;
}

const asEarlier = (f: StoredFile, replaced: string): EarlierCopy => ({ blob: f.blob, hash: f.hash, size: f.size, mime: f.mime, updated: f.updated, replaced });

export interface FileSpace {
  list(folder?: string): Promise<FileInfo[]>;
  /** The entry, or `null` when there is no such file. */
  find(target: FileTarget): Promise<StoredFile | null>;
  /** The bytes, or `null` when they have not reached this device yet. Throws when there is no such file. */
  read(target: FileTarget): Promise<Blob | null>;
  write(path: string, data: Blob, opts?: { mime?: string; origin?: FileOrigin }): Promise<FileInfo>;
  rename(target: FileTarget, to: string): Promise<FileInfo>;
  remove(target: FileTarget): Promise<void>;
  /**
   * Whether the file's bytes are on this device — without fetching them. Always true where nothing
   * syncs; in a shared app, false until someone here has read the file (#255).
   */
  here(target: FileTarget): Promise<boolean>;
  /** The copies a newer write replaced, newest first (#255). */
  earlier(target: FileTarget): Promise<EarlierCopy[]>;
  /** An earlier copy's bytes, or `null` when they are not on this device. */
  readEarlier(target: FileTarget, copy: EarlierCopy): Promise<Blob | null>;
  /** Make an earlier copy the file again; what it replaces becomes an earlier copy in turn. */
  restoreEarlier(target: FileTarget, copy: EarlierCopy): Promise<FileInfo>;
}

export function fileSpace(store: Store, opts: { now?: () => Date } = {}): FileSpace {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();

  /** Every entry at a path: one, normally; more when members made it apart. */
  const allAt = async (path: string): Promise<StoredFile[]> => (await store.listFiles()).filter((f) => f.path === path);
  const byPath = async (path: string): Promise<StoredFile | null> => (await allAt(path)).reduce<StoredFile | null>((w, f) => (w ? newest(w, f) : f), null);

  /** Earlier copies to keep, newest first: the last few, none older than the window. Returns the rest too. */
  const prune = (copies: EarlierCopy[], at: string): { keep: EarlierCopy[]; drop: EarlierCopy[] } => {
    const sorted = [...copies].sort((a, b) => (a.replaced < b.replaced ? 1 : a.replaced > b.replaced ? -1 : 0));
    const cutoff = new Date(new Date(at).getTime() - EARLIER_FOR_MS).toISOString();
    const keep = sorted.filter((c) => c.replaced >= cutoff).slice(0, KEEP_EARLIER);
    return { keep, drop: sorted.filter((c) => !keep.includes(c)) };
  };

  /** The entry's earlier copies, with any stray entries at its path read as earlier copies too. */
  const earlierOf = async (f: StoredFile): Promise<EarlierCopy[]> => {
    const strays = (await allAt(f.path)).filter((o) => o.id !== f.id).map((o) => asEarlier(o, o.updated));
    return prune([...(f.earlier ?? []), ...strays], f.updated).keep;
  };

  const find = async (target: FileTarget): Promise<StoredFile | null> => {
    if (typeof target === "string") return byPath(normalisePath(target));
    if (target && typeof target === "object" && typeof target.id === "string") return store.getFile(target.id);
    throw new FileSpaceError("invalid-path", "a file is named by its path or by the value of a file field");
  };

  const mustFind = async (target: FileTarget): Promise<StoredFile> => {
    const f = await find(target);
    if (!f) throw new FileSpaceError("no-file", `No file ${describe(target)} in this app`);
    return f;
  };

  const space: FileSpace = {
    async list(folder) {
      const prefix = folderPrefix(folder);
      const shown = new Map<string, StoredFile>();
      for (const f of await store.listFiles()) {
        if (!f.path.startsWith(prefix)) continue;
        const other = shown.get(f.path);
        shown.set(f.path, other ? newest(other, f) : f);
      }
      return [...shown.values()].sort((a, b) => a.path.localeCompare(b.path)).map(fileInfo);
    },

    find,

    async read(target) {
      const f = await mustFind(target);
      return store.getBlob({ key: f.blob, mime: f.mime });
    },

    async write(rawPath, data, o = {}) {
      const path = normalisePath(rawPath);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = mimeOf(path, o.mime ?? data.type);
      const hash = await digest(bytes);
      const at = await allAt(path);
      const existing = at.reduce<StoredFile | null>((w, f) => (w ? newest(w, f) : f), null);
      // A shared space has a budget on the relay (#255). Checked before a byte is written; replacing a
      // file does not make room, since the relay keeps what it replaced.
      const usage = await store.spaceUsage?.();
      if (usage && usage.used + bytes.byteLength > usage.budget) throw new SpaceFullError(usage.used, usage.budget, bytes.byteLength);
      const ref = await store.putBlob(new Blob([bytes], { type: mime }));
      const stamp = now();
      // What this write replaces — the file as it was, and any entry a member made here apart — is
      // kept as earlier copies; past the last few, or the window, its bytes go.
      const strays = at.filter((f) => f !== existing);
      const replaced = existing && existing.blob !== ref.key ? [asEarlier(existing, stamp)] : [];
      const { keep, drop } = prune([...replaced, ...(existing?.earlier ?? []), ...strays.map((f) => asEarlier(f, f.updated))], stamp);
      const entry: StoredFile = {
        id: existing?.id ?? ulid(),
        path,
        name: path.split("/").pop()!,
        mime,
        size: bytes.byteLength,
        hash,
        origin: o.origin ?? (existing ? (existing.origin === "shipped" ? "app" : existing.origin) : "app"),
        created: existing?.created ?? stamp,
        updated: stamp,
        blob: ref.key,
        ...(keep.length ? { earlier: keep } : {}),
      };
      try {
        await store.setFile(entry);
      } catch (e) {
        // Refused (a shared space does not take the app's code): the bytes just written are no one's.
        await store.deleteBlob(ref.key).catch(() => {});
        throw e;
      }
      for (const f of strays) await store.deleteFile(f.id);
      for (const c of drop) if (c.blob !== ref.key) await store.deleteBlob(c.blob);
      return fileInfo(entry);
    },

    async rename(target, to) {
      const f = await mustFind(target);
      const path = normalisePath(to);
      if (path === f.path) return fileInfo(f);
      const other = await byPath(path);
      if (other) throw new FileSpaceError("taken", `There is already a file at "${path}"`);
      const entry: StoredFile = { ...f, path, name: path.split("/").pop()!, updated: now() };
      await store.setFile(entry);
      return fileInfo(entry);
    },

    async remove(target) {
      const f = await mustFind(target);
      // The file goes, with every copy of it: earlier ones, and entries members made at its path apart.
      const strays = (await allAt(f.path)).filter((o) => o.id !== f.id);
      await store.deleteFile(f.id);
      for (const o of strays) await store.deleteFile(o.id);
      for (const key of new Set([f.blob, ...(f.earlier ?? []).map((c) => c.blob), ...strays.flatMap((o) => [o.blob, ...(o.earlier ?? []).map((c) => c.blob)])])) {
        await store.deleteBlob(key);
      }
    },

    async here(target) {
      const f = await mustFind(target);
      return store.blobHere ? store.blobHere({ key: f.blob, mime: f.mime }) : true;
    },

    async earlier(target) {
      return earlierOf(await mustFind(target));
    },

    async readEarlier(target, copy) {
      await mustFind(target);
      return store.getBlob({ key: copy.blob, mime: copy.mime });
    },

    async restoreEarlier(target, copy) {
      const f = await mustFind(target);
      // The copy's bytes are already in the space (and on the relay): point the file back at them
      // rather than write them again, which would cost a shared space the same bytes twice (#255).
      const stamp = now();
      const others = (f.earlier ?? []).filter((c) => !(c.blob === copy.blob && c.hash === copy.hash));
      const { keep, drop } = prune([asEarlier(f, stamp), ...others], stamp);
      const entry: StoredFile = { ...f, blob: copy.blob, hash: copy.hash, size: copy.size, mime: copy.mime, updated: stamp, ...(keep.length ? { earlier: keep } : {}) };
      if (!keep.length) delete entry.earlier;
      await store.setFile(entry);
      for (const c of drop) if (c.blob !== copy.blob) await store.deleteBlob(c.blob);
      return fileInfo(entry);
    },
  };
  return space;
}

function describe(target: FileTarget): string {
  return typeof target === "string" ? `"${target}"` : `"${target.path ?? target.name ?? target.id}"`;
}
