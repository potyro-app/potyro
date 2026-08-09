import { humanizeKey } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import type { View } from "karta";

/** Human-format a resolved value for display in built-in views. */
export function formatValue(v: unknown): string {
  if (v == null) return "–";
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? "•" : String(x))).join(", ");
  if (typeof v === "object") return "…";
  return String(v);
}

export function toBadges(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "boolean") return v ? ["✓"] : [];
  if (v == null) return [];
  return [String(v)];
}

/** The view object for a page (typed loosely — declarative fields only guaranteed present). */
export function getView(runtime: KartaRuntime, pageId: string): View {
  const page = runtime.definition.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`view: page ${pageId} not found`);
  return page.view;
}

/** The field an entity uses as its human label (relation pickers, list rows). */
export function displayFieldFor(runtime: KartaRuntime, entity: string): string {
  const def = runtime.definition.entities[entity];
  if (!def) return "id";
  if (def.displayField) return def.displayField;
  if ("name" in def.fields) return "name";
  return Object.keys(def.fields)[0] ?? "id";
}

/** Humanize a field/computed key: "caloriesPerServing" → "Calories Per Serving". */
// Re-exported, not reimplemented — see `humanizeKey` in `karta` for why. Imported as well as
// re-exported, because `fieldLabel` below calls it and `export … from` does not bring it into scope.
export { humanizeKey };

/** A readable label for a field/computed key on an entity. */
export function fieldLabel(runtime: KartaRuntime, entity: string, key: string): string {
  return runtime.definition.entities[entity]?.fields[key]?.label ?? humanizeKey(key);
}
