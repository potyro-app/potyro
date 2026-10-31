// Where Potyro's gallery is (docs/24 §10): a static page of apps to try and make your own, served on
// potyro.com (docs/16). A build may name another (`VITE_POTYRO_GALLERY`), as the browser tests do.
//
// The gallery opens in THIS tab, never one of its own (#487). Its Make it mine comes back into
// Potyro, and only one tab at a time holds your apps (storage-elsewhere.tsx): from a second tab the
// copy was refused as "open in another tab" while the first still held them. Leaving loses nothing —
// every record is saved, and words typed in the Studio are kept for it (kept-idea.ts).

/** The gallery's address, when the build names none. */
export const GALLERY_URL = "https://potyro.com/";

export function galleryUrl(): string {
  const configured = import.meta.env?.VITE_POTYRO_GALLERY?.trim();
  return configured || GALLERY_URL;
}

/** Go to the gallery, in this tab: its Make it mine lands back here, where your apps are. */
export function openGallery(): void {
  globalThis.location?.assign(galleryUrl());
}

/**
 * Leaving a page for the gallery, in this tab. What can be kept is kept (`keep`, the words in a box)
 * only once the page really goes; what cannot be (`unkept`: a version not kept, code not saved) is
 * asked about first, never lost in silence. `true`: go now. A promise: go if it settles `true`.
 */
export function leaveForGallery(opts: { unkept: boolean; keep: () => void; ask: () => Promise<boolean> }): true | Promise<boolean> {
  if (!opts.unkept) {
    opts.keep();
    return true;
  }
  return opts.ask().then((go) => {
    if (go) opts.keep();
    return go;
  });
}
