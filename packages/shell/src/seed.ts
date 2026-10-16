// First-run seed data so the app isn't empty. Writes directly through the Store (shell-owned),
// independent of the loaded app's trust. Per-app seeders keyed by app id.
import type { Store } from "@potyro/store";
import { mediaFromFile } from "./seed-files.js";
import { seedGroceries } from "./seeds/groceries.js";
import { seedPlaces } from "./seeds/places.js";
import { seedPlants } from "./seeds/plants.js";
import { seedRecipes } from "./seeds/recipes.js";
import { seedSplit } from "./seeds/split.js";
import { seedWorkout } from "./seeds/workout.js";

/**
 * A sample record's photo, by the path of a file the example ships with (`examples/files/<id>/`).
 * In the app's own store it is the record's copy of that file; written for a demo link it stays the
 * path, `{ file }`, and the device that opens the link makes the copy (seed-files.ts).
 */
export type SeedPhoto = (path: string) => Promise<unknown>;

export async function seedIfEmpty(store: Store, appId = "recipes", me?: string, photo?: SeedPhoto): Promise<void> {
  const seeder = SEEDERS[appId];
  if (seeder) await seeder(store, me, photo ?? ((path) => mediaFromFile(store, path)));
}

/** Whether this app has first-run sample records of its own: what a demo link shows (docs/24 §3). */
export function hasSeeder(appId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEEDERS, appId);
}

/** `me` is this device's account id — what a seeded row can say about who paid, or did, something. */
const SEEDERS: Record<string, (store: Store, me: string | undefined, photo: SeedPhoto) => Promise<void>> = {
  recipes: seedRecipes,
  plants: seedPlants,
  places: seedPlaces,
  workout: seedWorkout,
  groceries: seedGroceries,
  split: seedSplit,
};
