// Where Potyro's gallery is (docs/24 §9): a static page of apps to try and make your own, served on
// potyro.com (docs/16). A build may name another (`VITE_POTYRO_GALLERY`), as the browser tests do.

/** The gallery's address, when the build names none. */
export const GALLERY_URL = "https://potyro.com/";

export function galleryUrl(): string {
  const configured = import.meta.env?.VITE_POTYRO_GALLERY?.trim();
  return configured || GALLERY_URL;
}

/** Open the gallery beside Potyro: a page of its own, so nothing here is left behind. */
export function openGallery(): void {
  globalThis.open?.(galleryUrl(), "_blank", "noopener");
}
