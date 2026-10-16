// What a page sits on (`Page.background`, `theme.background`): a named treatment of the app's colour,
// or a picture from the app's own files. A page's own wins over the app's; with neither, `"wash"` —
// the app's colour glowing softly behind the top of the page, so no page is plain beige by default.

import { basePageId, type Backdrop } from "potyro";

/** The treatment a page uses when nothing is declared. */
export const DEFAULT_BACKDROP = "wash" as const;

interface WithBackdrops {
  theme?: { background?: Backdrop };
  pages: ReadonlyArray<{ id: string; background?: Backdrop }>;
}

/** The page a page ref belongs to: a layout item (`today#1`) is part of its page (`today`). */
export function pageOf<P extends { id: string }>(def: { pages: ReadonlyArray<P> }, pageId: string): P | undefined {
  const base = basePageId(pageId);
  return def.pages.find((p) => p.id === base);
}

/** The page's backdrop: its own, else the app's, else the default. */
export function backdropOf(def: WithBackdrops, page: { background?: Backdrop } | undefined): Backdrop {
  return page?.background ?? def.theme?.background ?? DEFAULT_BACKDROP;
}

/** The picture a page's backdrop names, if it names one. */
export function backdropImage(def: WithBackdrops, page: { background?: Backdrop } | undefined): string | undefined {
  const b = backdropOf(def, page);
  return typeof b === "object" && b !== null && typeof b.image === "string" && b.image.trim() ? b.image.trim() : undefined;
}

/** The treatment's name for the stylesheet (`data-backdrop`): an image page is `"image"`. */
export function backdropKind(b: Backdrop): "plain" | "wash" | "dots" | "grain" | "image" {
  return typeof b === "string" ? b : "image";
}
