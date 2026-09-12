// Where a view lives once a page can hold several (#105). A layout's items are addressed as
// `<pageId>#<index>` wherever a page id used to name one view — a query, a binding, a filter —
// so the runtime, both hosts and the views resolve a "page ref" through this one function.

import type { AppDefinition, View } from "./types/app.js";

/** The page part of a ref: `"today#2"` → `"today"`. */
export function basePageId(ref: string): string {
  const at = ref.indexOf("#");
  return at < 0 ? ref : ref.slice(0, at);
}

/** The ref of a layout item. */
export const layoutItemId = (pageId: string, index: number): string => `${pageId}#${index}`;

/** The view a page ref names: a layout item's, or the page's own (its first item's, for a layout). */
export function resolveView(def: Pick<AppDefinition, "pages">, ref: string): View {
  const at = ref.indexOf("#");
  const pageId = at < 0 ? ref : ref.slice(0, at);
  const page = def.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`page ${pageId} not found`);
  // A definition that did not pass through `defineApp` (one read back out of the isolate as
  // plain data) still has its layout: the page's view is the first item's.
  if (at < 0) return page.view ?? page.layout?.items[0]?.view ?? page.view;
  const index = Number(ref.slice(at + 1));
  const item = page.layout?.items[index];
  if (!item) throw new Error(`page ${pageId} has no layout item ${index}`);
  return item.view;
}
