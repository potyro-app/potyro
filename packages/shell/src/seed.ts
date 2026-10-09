// First-run seed data so the app isn't empty. Writes directly through the Store (shell-owned),
// independent of the loaded app's trust. Per-app seeders keyed by app id.
import type { Store } from "@potyro/store";

const DAY = 86_400_000;

export async function seedIfEmpty(store: Store, appId = "recipes", me?: string): Promise<void> {
  const seeder = SEEDERS[appId];
  if (seeder) await seeder(store, me);
}

/** `me` is this device's account id — what a seeded row can say about who paid, or did, something. */
const SEEDERS: Record<string, (store: Store, me?: string) => Promise<void>> = {
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

async function seedPlaces(store: Store): Promise<void> {
  const existing = await store.all("place");
  if (existing.length > 0) return;

  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const allDay = DAYS.map((day) => ({ day, from: "00:00", to: "23:59" }));

  // Two spots near Berlin centre (within ~1km) and one far away in Paris, so "Near me" (2km) and
  // "Open now" (all-day vs no hours) filters have a deterministic effect in tests + the demo.
  await store.insert("place", { name: "Corner Café", location: { lat: 52.521, lng: 13.406 }, kind: "cafe", vibes: ["quiet", "outdoor"], visited: true, rating: 4.5, openingHours: allDay });
  await store.insert("place", { name: "Nachtbar", location: { lat: 52.515, lng: 13.41 }, kind: "bar", vibes: ["late-night"], visited: false, rating: 4, openingHours: [] });
  await store.insert("place", { name: "Paris Bakery", location: { lat: 48.8566, lng: 2.3522 }, kind: "bakery", vibes: ["cheap"], visited: true, rating: 5, openingHours: allDay });
}

async function seedPlants(store: Store): Promise<void> {
  const existing = await store.all("plant");
  if (existing.length > 0) return;

  const now = new Date();
  // Pin one plant's next watering to the 15th of the current month so the calendar always has a
  // visible event (interval 7 → lastWatered = the 15th minus 7 days).
  const midMonth = new Date(now.getFullYear(), now.getMonth(), 15, 9, 0, 0);
  const plant = (name: string, over: Record<string, unknown>) =>
    store.insert("plant", { name, active: true, wateringIntervalDays: 7, seasonalCare: [], needsDirectSun: false, ...over });

  await plant("Fern", { lastWatered: new Date(now.getTime() - 30 * DAY) }); // overdue → shows in "Due"
  await plant("Monstera", { lastWatered: new Date(midMonth.getTime() - 7 * DAY), needsDirectSun: true }); // next = the 15th
  await plant("Cactus", { lastWatered: now, wateringIntervalDays: 30 }); // freshly watered → not due
}

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
    status: "keeper",
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
    status: "tried",
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

  // `restSec` per exercise: the tracker counts it down after each set, and a heavy compound asks
  // for longer than an accessory.
  const ex = (name: string, day: string, order: number, extra: Record<string, unknown> = {}) =>
    store.insert("exercise", { name, day, order, targetSets: 3, repRange: "8–12", bodyweight: false, restSec: 90, ...extra });

  const bench = await ex("Bench Press", "push", 0, { repRange: "6–10", restSec: 150 });
  const ohp = await ex("Overhead Press", "push", 1, { restSec: 120 });
  const row = await ex("Barbell Row", "pull", 0, { repRange: "6–10", restSec: 120 });
  const pullup = await ex("Pull-up", "pull", 1, { bodyweight: true, repRange: "AMRAP", restSec: 120 });
  const squat = await ex("Squat", "legs", 0, { targetSets: 4, repRange: "5–8", restSec: 180 });
  void pullup;

  // A little history so `history`, `totalVolume`, and the async `lastBest` have data.
  const now = Date.now();
  // Eight weeks of lighter, older sessions for Progress (#109). None outscores the recent ones below,
  // so each exercise's rolling best still comes from the last week.
  for (const [daysAgo, day, kg, minutes] of [
    [10, "pull", 50, 52], [12, "legs", 80, 61], [15, "push", 55, 55], [17, "legs", 85, 58], [19, "pull", 50, 49],
    [22, "push", 55, 57], [26, "legs", 80, 63], [29, "push", 50, 54], [31, "pull", 45, 50], [33, "legs", 80, 60],
    [36, "push", 50, 52], [40, "legs", 75, 59], [43, "push", 50, 51], [45, "pull", 45, 47], [47, "legs", 75, 62],
    [50, "push", 45, 50], [54, "legs", 70, 58],
  ] as const) {
    const lift = day === "push" ? bench.id : day === "legs" ? squat.id : row.id;
    await store.insert("session", {
      day,
      date: new Date(now - daysAgo * DAY),
      durationSec: minutes * 60,
      entries: [{ exercise: lift, sets: [{ kg, reps: 5 }, { kg, reps: 5 }, { kg, reps: 4 }] }],
    });
  }
  await store.insert("session", {
    day: "push",
    date: new Date(now - 7 * DAY),
    durationSec: 62 * 60,
    entries: [
      { exercise: bench.id, sets: [{ kg: 60, reps: 10 }, { kg: 70, reps: 8 }, { kg: 80, reps: 5 }] },
      { exercise: ohp.id, sets: [{ kg: 40, reps: 8 }, { kg: 40, reps: 7 }] },
    ],
  });
  await store.insert("session", {
    day: "legs",
    date: new Date(now - 4 * DAY),
    durationSec: 55 * 60,
    entries: [{ exercise: squat.id, sets: [{ kg: 100, reps: 5 }, { kg: 110, reps: 5 }, { kg: 120, reps: 3 }] }],
  });
  await store.insert("session", {
    day: "push",
    date: new Date(now - 1 * DAY),
    durationSec: 58 * 60,
    entries: [
      { exercise: bench.id, sets: [{ kg: 65, reps: 10 }, { kg: 75, reps: 8 }, { kg: 85, reps: 4 }] },
      { exercise: ohp.id, sets: [{ kg: 42.5, reps: 8 }, { kg: 42.5, reps: 6 }] },
    ],
  });
}
