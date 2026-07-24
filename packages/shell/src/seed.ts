// First-run seed data so the app isn't empty. Writes directly through the Store (shell-owned),
// independent of the loaded app's trust. Per-app seeders keyed by app id.
import type { Store } from "@karta/store";

const DAY = 86_400_000;

export async function seedIfEmpty(store: Store, appId = "recipes"): Promise<void> {
  const seeder = SEEDERS[appId];
  if (seeder) await seeder(store);
}

const SEEDERS: Record<string, (store: Store) => Promise<void>> = {
  recipes: seedRecipes,
  workout: seedWorkout,
};

async function seedRecipes(store: Store): Promise<void> {
  const existing = await store.all("recipe");
  if (existing.length > 0) return;

  interface IngSeed {
    diet: string;
    category: string;
    seasons?: string[];
    pricePerKg?: number;
    inStock?: boolean;
    caloriesPer100: number;
    proteinPer100: number;
    fatPer100: number;
    carbsPer100: number;
  }
  const mk = (name: string, data: IngSeed) => store.insert("ingredient", { name, inStock: false, ...data });

  // Pancake ingredients start in stock → "Ready to cook" has something to show.
  const flour = await mk("Flour", { diet: "vegan", category: "grain", pricePerKg: 1.2, inStock: true, caloriesPer100: 364, proteinPer100: 10, fatPer100: 1, carbsPer100: 76 });
  const egg = await mk("Egg", { diet: "vegetarian", category: "protein", pricePerKg: 4, inStock: true, caloriesPer100: 155, proteinPer100: 13, fatPer100: 11, carbsPer100: 1 });
  const milk = await mk("Milk", { diet: "vegetarian", category: "dairy", pricePerKg: 1.1, inStock: true, caloriesPer100: 42, proteinPer100: 3, fatPer100: 1, carbsPer100: 5 });
  const lettuce = await mk("Lettuce", { diet: "vegan", category: "vegetable", seasons: ["spring", "summer"], pricePerKg: 3, caloriesPer100: 15, proteinPer100: 1, fatPer100: 0, carbsPer100: 3 });
  const chicken = await mk("Chicken breast", { diet: "animal-based", category: "protein", pricePerKg: 9, caloriesPer100: 165, proteinPer100: 31, fatPer100: 4, carbsPer100: 0 });

  await store.insert("recipe", {
    name: "Fluffy Pancakes",
    tags: ["breakfast", "vegetarian"],
    servings: 2,
    ingredients: [
      { ingredient: flour.id, quantity: 200, unit: "g" },
      { ingredient: egg.id, quantity: 100, unit: "g" },
      { ingredient: milk.id, quantity: 300, unit: "ml" },
    ],
    steps: [
      { text: "Whisk flour with a pinch of salt.", durationSec: 60 },
      { text: "Beat in eggs, then whisk in the milk until smooth.", durationSec: 120 },
      { text: "Ladle onto a hot griddle; flip when bubbles form.", durationSec: 300 },
    ],
    timesCooked: 0,
  });

  await store.insert("recipe", {
    name: "Chicken Caesar",
    tags: ["lunch", "dinner"],
    servings: 1,
    ingredients: [
      { ingredient: chicken.id, quantity: 180, unit: "g" },
      { ingredient: lettuce.id, quantity: 120, unit: "g" },
      { ingredient: egg.id, quantity: 50, unit: "g" },
    ],
    steps: [
      { text: "Grill the chicken and slice.", durationSec: 480 },
      { text: "Toss lettuce with dressing; top with chicken.", durationSec: 120 },
    ],
    timesCooked: 0,
  });
}

async function seedWorkout(store: Store): Promise<void> {
  const existing = await store.all("exercise");
  if (existing.length > 0) return;

  const ex = (name: string, day: string, order: number, extra: Record<string, unknown> = {}) =>
    store.insert("exercise", { name, day, order, targetSets: 3, repRange: "8–12", bodyweight: false, ...extra });

  const bench = await ex("Bench Press", "push", 0, { repRange: "6–10" });
  const ohp = await ex("Overhead Press", "push", 1);
  const row = await ex("Barbell Row", "pull", 0, { repRange: "6–10" });
  const pullup = await ex("Pull-up", "pull", 1, { bodyweight: true, repRange: "AMRAP" });
  const squat = await ex("Squat", "legs", 0, { targetSets: 4, repRange: "5–8" });
  void row;
  void pullup;

  // A little history so `history`, `totalVolume`, and the async `lastBest` have data.
  const now = Date.now();
  await store.insert("session", {
    day: "push",
    date: new Date(now - 7 * DAY),
    entries: [
      { exercise: bench.id, sets: [{ kg: 60, reps: 10 }, { kg: 70, reps: 8 }, { kg: 80, reps: 5 }] },
      { exercise: ohp.id, sets: [{ kg: 40, reps: 8 }, { kg: 40, reps: 7 }] },
    ],
  });
  await store.insert("session", {
    day: "legs",
    date: new Date(now - 4 * DAY),
    entries: [{ exercise: squat.id, sets: [{ kg: 100, reps: 5 }, { kg: 110, reps: 5 }, { kg: 120, reps: 3 }] }],
  });
  await store.insert("session", {
    day: "push",
    date: new Date(now - 1 * DAY),
    entries: [
      { exercise: bench.id, sets: [{ kg: 65, reps: 10 }, { kg: 75, reps: 8 }, { kg: 85, reps: 4 }] },
      { exercise: ohp.id, sets: [{ kg: 42.5, reps: 8 }, { kg: 42.5, reps: 6 }] },
    ],
  });
}
