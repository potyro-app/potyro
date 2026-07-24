import type { ComponentType } from "react";
import type { View } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { DetailView, GalleryView, ListView, PlaceholderView, TableView } from "./builtins.js";
import { CustomView } from "./custom.js";

/** The default view registry (docs/05 view contract). Extendable by the shell. */
export const defaultRegistry: Record<View["type"], ComponentType<BuiltinViewProps>> = {
  list: ListView,
  gallery: GalleryView,
  table: TableView,
  detail: DetailView,
  custom: CustomView,
  calendar: PlaceholderView,
  map: PlaceholderView,
  steps: PlaceholderView,
};

export function resolveViewComponent(
  type: View["type"],
  registry: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>> = {},
): ComponentType<BuiltinViewProps> {
  return registry[type] ?? defaultRegistry[type];
}
