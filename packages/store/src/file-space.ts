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
import type { FileInfo, FileOrigin, FileRef } from "potyro";
import type { Store, StoredFile } from "./types.js";
import { ulid } from "./ulid.js";

/** A file named by its path, or by the `FileRef` a `file` field holds. */
export type FileTarget = string | FileRef;

export type FileSpaceErrorCode = "invalid-path" | "no-file" | "taken";

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

/** What the app sees: the entry without the store's blob key. */
export function fileInfo(entry: StoredFile): FileInfo {
  const { blob: _blob, ...info } = entry;
  return info;
}

export interface FileSpace {
  list(folder?: string): Promise<FileInfo[]>;
  /** The entry, or `null` when there is no such file. */
  find(target: FileTarget): Promise<StoredFile | null>;
  /** The bytes, or `null` when they have not reached this device yet. Throws when there is no such file. */
  read(target: FileTarget): Promise<Blob | null>;
  write(path: string, data: Blob, opts?: { mime?: string; origin?: FileOrigin }): Promise<FileInfo>;
  rename(target: FileTarget, to: string): Promise<FileInfo>;
  remove(target: FileTarget): Promise<void>;
}

export function fileSpace(store: Store, opts: { now?: () => Date } = {}): FileSpace {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();

  const byPath = async (path: string): Promise<StoredFile | null> =>
    (await store.listFiles()).find((f) => f.path === path) ?? null;

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

  return {
    async list(folder) {
      const prefix = folderPrefix(folder);
      return (await store.listFiles())
        .filter((f) => f.path.startsWith(prefix))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(fileInfo);
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
      const existing = await byPath(path);
      const ref = await store.putBlob(new Blob([bytes], { type: mime }));
      const stamp = now();
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
      };
      await store.setFile(entry);
      if (existing && existing.blob !== ref.key) await store.deleteBlob(existing.blob);
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
      await store.deleteFile(f.id);
      await store.deleteBlob(f.blob);
    },
  };
}

function describe(target: FileTarget): string {
  return typeof target === "string" ? `"${target}"` : `"${target.path ?? target.name ?? target.id}"`;
}
