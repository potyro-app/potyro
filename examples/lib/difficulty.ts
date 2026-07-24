// A plain helper imported by recipes.app.ts — "full code, your own module" (docs/03).
import type { Resolved } from "karta";

/** Rough difficulty from the amount of prep + steps. */
export function scoreDifficulty(r: Resolved): "easy" | "medium" | "hard" {
  const steps = Array.isArray(r.steps) ? r.steps.length : 0;
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
  const score = steps + ingredients;
  if (score <= 6) return "easy";
  if (score <= 12) return "medium";
  return "hard";
}
