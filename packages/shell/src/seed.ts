// First-run seed data so the app isn't empty. Writes directly through the Store (shell-owned),
// independent of the loaded app's trust. Per-app seeders keyed by app id.
import type { Store } from "@potyro/store";
import { mediaFromFile } from "./seed-files.js";
import { seedPlaces } from "./seeds/places.js";
import { seedPlants } from "./seeds/plants.js";
import { seedRecipes } from "./seeds/recipes.js";
import { seedWorkout } from "./seeds/workout.js";

const DAY = 86_400_000;

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

async function seedSplit(store: Store, me?: string): Promise<void> {
  const existing = await store.all("group");
  if (existing.length > 0) return;
  // One group, because the app asks for a selection before it shows anything and an app that opens
  // on "choose a group" with no group to choose is a dead end.
  const group = String((await store.insert("group", { name: "Flat", note: "Shared costs at home" })).id);
  if (!me) return;
  // Two expenses so the balances have something to say on the first run. Nobody is named in them:
  // an empty list reads as "everyone in the group, whoever that is when the maths runs", so while
  // you are alone they are simply yours, and the moment you share the app they split with the
  // person you shared it with.
  //
  // They used to name you alone, which is true but unhelpful — the person who joined saw two of
  // the four expenses sitting there with a share of €0.00 next to them, which reads as a broken
  // app rather than as a statement about who was at the shop.
  const day = (back: number): Date => new Date(Date.now() - back * 86_400_000);
  await store.insert("expense", {
    description: "Groceries",
    amount: 4285,
    paidBy: me,
    when: day(2),
    split: "equally",
    between: [],
    shares: [],
    note: "",
    group,
  });
  await store.insert("expense", {
    description: "Internet",
    amount: 3900,
    paidBy: me,
    when: day(9),
    split: "equally",
    between: [],
    shares: [],
    note: "",
    group,
  });
}

async function seedGroceries(store: Store): Promise<void> {
  const existing = await store.all("item");
  if (existing.length > 0) return;
  // Aisles are records now, in the order you walk the shop — renamed, reordered and deleted from
  // the list itself. These five are a place to start, not the app's opinion of a supermarket.
  const aisle = async (name: string, order: number): Promise<string> => String((await store.insert("aisle", { name, order })).id);
  const produce = await aisle("Produce", 0);
  const bakery = await aisle("Bakery", 1);
  const dairy = await aisle("Dairy", 2);
  const pantry = await aisle("Pantry", 3);
  const household = await aisle("Household", 4);

  const seen = new Map<string, number>();
  const item = (name: string, at: string, over: Record<string, unknown> = {}) => {
    const position = seen.get(at) ?? 0;
    seen.set(at, position + 1);
    return store.insert("item", { name, aisle: at, position, bought: false, quantity: "", note: "", ...over });
  };
  await item("Apples", produce, { quantity: "1 kg" });
  await item("Spinach", produce, { bought: true });
  await item("Sourdough", bakery);
  await item("Milk", dairy, { quantity: "2 × 1 l" });
  await item("Yoghurt", dairy);
  await item("Rice", pantry, { quantity: "1 kg", bought: true });
  await item("Dish soap", household);
}

