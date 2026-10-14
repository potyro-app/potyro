// Text and files shared to Potyro from another app — a list, a plan, a table another AI made (#213),
// or a file someone wants in one of their apps (#254) — reach the shell through
// @capgo/capacitor-share-target. The plugin keeps a share until JavaScript listens, so sharing into
// Potyro while it is closed still arrives. It copies each shared file into the app's cache and names
// it by path; `readSharedFile` reads it back through the WebView's own address for local files.
//
// "Open with Potyro" is a different intent (ACTION_VIEW), which arrives as an opened URL through
// `@capacitor/app` — the same channel as an invite link (deep-links.ts). `isOpenedFile` tells the two
// apart; a content:// address is read the same way, through the WebView.
//
// Boxed: an awaited Capacitor plugin hangs forever on Android (see deep-links.ts), so this never
// returns the plugin itself.

export interface SharedText {
  title?: string;
  text: string;
}

/** A file in a share: where the plugin put it, its name and its type. */
export interface SharedFileRef {
  uri: string;
  name: string;
  mimeType: string;
}

interface ShareEvent {
  title?: string;
  texts?: string[];
  files?: Array<{ uri?: string; name?: string; mimeType?: string }>;
}

interface SharePlugin {
  addListener(event: "shareReceived", cb: (e: ShareEvent) => void): Promise<{ remove: () => Promise<void> }>;
}

/** The text of a share, or null when it carries none. */
export function textOfShare(e: ShareEvent): SharedText | null {
  const text = (e.texts ?? []).map((t) => t.trim()).filter(Boolean).join("\n\n");
  if (!text) return null;
  return { ...(e.title?.trim() ? { title: e.title.trim() } : {}), text };
}

/** The files of a share; none when it carries only text. */
export function filesOfShare(e: ShareEvent): SharedFileRef[] {
  return (e.files ?? [])
    .filter((f): f is { uri: string; name?: string; mimeType?: string } => typeof f?.uri === "string" && f.uri !== "")
    .map((f) => ({ uri: f.uri, name: f.name?.trim() || nameFromUri(f.uri), mimeType: f.mimeType ?? "" }));
}

/**
 * Listen on a plugin; split out so it can be tested without a device. A share with files goes to
 * `onFiles` — any text beside them is a caption, not something to add — and one with only text to
 * `onShare`.
 */
export async function listenOn(plugin: SharePlugin, onShare: (s: SharedText) => void, onFiles?: (files: SharedFileRef[]) => void): Promise<{ stop: () => void }> {
  const handle = await plugin.addListener("shareReceived", (e) => {
    const files = filesOfShare(e);
    if (files.length && onFiles) return onFiles(files);
    const s = textOfShare(e);
    if (s) onShare(s);
  });
  return { stop: () => void handle.remove() };
}

/** Shares, when running inside the native shell; nothing in a browser. */
export async function listenForShares(onShare: (s: SharedText) => void, onFiles?: (files: SharedFileRef[]) => void): Promise<{ stop: () => void } | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const { CapacitorShareTarget } = await import("@capgo/capacitor-share-target");
  return listenOn(CapacitorShareTarget as unknown as SharePlugin, onShare, onFiles);
}

/** A URL Android opened Potyro with that is a file, not an invite (`content://…`, `file://…`). */
export function isOpenedFile(url: string): boolean {
  return /^(content|file):\/\//i.test(url);
}

/** The last part of a file's address, decoded: what to call a file Android did not name. */
export function nameFromUri(uri: string): string {
  const last = uri.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "";
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  // A document id can carry a whole path ("raw:/storage/…/a.json"): keep its last part.
  return name.split(/[/:]/).filter(Boolean).pop() || "file";
}

interface ReadDeps {
  /** `Capacitor.convertFileSrc`: the WebView's address for a local file or a content:// URI. */
  convert?: (uri: string) => string;
  fetch?: (url: string) => Promise<Response>;
}

/** The bytes of a shared or opened file, as a `File` with its name and type. */
export async function readSharedFile(ref: SharedFileRef, deps: ReadDeps = {}): Promise<File> {
  const cap = (globalThis as unknown as { Capacitor?: { convertFileSrc?: (u: string) => string } }).Capacitor;
  const convert = deps.convert ?? cap?.convertFileSrc ?? ((u: string) => u);
  const get = deps.fetch ?? ((url: string) => globalThis.fetch(url));
  const local = /^[a-z]+:\/\//i.test(ref.uri) ? ref.uri : `file://${ref.uri}`;
  const res = await get(convert(local));
  if (!res.ok) throw new Error(`Could not read ${ref.name} (${res.status})`);
  const blob = await res.blob();
  const type = ref.mimeType || blob.type.split(";")[0] || "";
  return new File([blob], ref.name, type ? { type } : {});
}
