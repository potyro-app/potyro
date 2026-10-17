// Groceries' first-run records: a week's list in the order you walk the shop, two things already in
// the basket, and a memory of about two months of shopping — so "Usuals" is full on the first open and
// the app can show what it is for: the things you buy every week are one tap away.
//
// Two lists, so the switcher has something to switch: "Weekly shop" (opened first) and a small
// "Party" one. Remembered items have no list of their own to speak of — they are the memory every
// list's add box offers.
//
// Fixtures for the browser specs too: the aisles start Produce, Bakery, Dairy; on Weekly shop, Dairy
// holds Milk then Yoghurt then Eggs; Spinach and Rice are ticked; Apples has a quantity.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

export async function seedGroceries(store: Store, _me: string | undefined, _photo: SeedPhoto): Promise<void> {
  if ((await store.all("item")).length > 0) return;
  const weekly = String((await store.insert("list", { name: "Weekly shop" })).id);
  const party = String((await store.insert("list", { name: "Party" })).id);
  // Aisles are records, in the order you walk the shop — renamed, reordered and deleted from the
  // list itself. These are a place to start, not the app's opinion of a supermarket.
  const aisle = async (name: string, order: number): Promise<string> => String((await store.insert("aisle", { name, order })).id);
  const produce = await aisle("Produce", 0);
  const bakery = await aisle("Bakery", 1);
  const dairy = await aisle("Dairy", 2);
  const pantry = await aisle("Pantry", 3);
  const frozen = await aisle("Frozen", 4);
  const household = await aisle("Household", 5);

  const now = Date.now();
  const seen = new Map<string, number>();
  const onList = (name: string, at: string, over: Record<string, unknown> = {}, list = weekly) => {
    const key = `${list}:${at}`;
    const position = seen.get(key) ?? 0;
    seen.set(key, position + 1);
    return store.insert("item", { name, aisle: at, list, position, bought: false, quantity: "", note: "", onList: true, timesBought: 0, ...over });
  };
  // What you bought before, and how often: the memory Usuals is made from.
  const before = (times: number, daysAgo: number) => ({ timesBought: times, lastBought: new Date(now - daysAgo * DAY) });

  // ---- this week's list ----
  await onList("Apples", produce, { quantity: "1 kg", ...before(7, 6) });
  await onList("Bananas", produce, { quantity: "6", ...before(9, 6) });
  await onList("Spinach", produce, { bought: true, ...before(4, 13) });
  await onList("Tomatoes", produce, { quantity: "500 g", ...before(6, 6) });
  await onList("Basil", produce);
  await onList("Sourdough", bakery, before(8, 6));
  await onList("Milk", dairy, { quantity: "2 × 1 l", ...before(11, 6) });
  await onList("Yoghurt", dairy, before(6, 13));
  await onList("Eggs", dairy, { quantity: "12", ...before(5, 13) });
  await onList("Oat drink", pantry, { note: "The oat one, not barista", ...before(3, 20) });
  await onList("Rice", pantry, { quantity: "1 kg", bought: true, ...before(2, 34) });
  await onList("Frozen peas", frozen);
  await onList("Dish soap", household, before(2, 41));

  // ---- Saturday's party ----
  await onList("Limes", produce, { quantity: "6" }, party);
  await onList("Tortilla chips", pantry, { quantity: "3 bags" }, party);
  await onList("Sparkling water", pantry, { quantity: "6 × 1.5 l" }, party);
  await onList("Ice", frozen, { quantity: "2 bags" }, party);
  await onList("Napkins", household, {}, party);

  // ---- remembered, not on the list: the usuals ----
  const usual = (name: string, at: string, times: number, daysAgo: number, quantity = "") =>
    store.insert("item", { name, aisle: at, list: weekly, position: 0, bought: false, quantity, note: "", onList: false, ...before(times, daysAgo) });
  await usual("Coffee beans", pantry, 8, 6, "500 g");
  await usual("Oats", pantry, 6, 13);
  await usual("Lemons", produce, 6, 6, "3");
  await usual("Onions", produce, 7, 13);
  await usual("Garlic", produce, 5, 20);
  await usual("Avocados", produce, 5, 6, "2");
  await usual("Carrots", produce, 4, 20);
  await usual("Potatoes", produce, 3, 27, "2 kg");
  await usual("Cucumber", produce, 3, 13);
  await usual("Croissants", bakery, 4, 6, "4");
  await usual("Butter", dairy, 6, 20);
  await usual("Cheddar", dairy, 5, 13);
  await usual("Mozzarella", dairy, 3, 27);
  await usual("Pasta", pantry, 5, 13);
  await usual("Tinned tomatoes", pantry, 4, 20, "2");
  await usual("Olive oil", pantry, 2, 48);
  await usual("Honey", pantry, 2, 55);
  await usual("Chickpeas", pantry, 3, 27);
  await usual("Peanut butter", pantry, 2, 34);
  await usual("Tea", pantry, 3, 41);
  await usual("Ice cream", frozen, 3, 13);
  await usual("Frozen berries", frozen, 4, 20);
  await usual("Toilet paper", household, 3, 27, "9 rolls");
  await usual("Sponges", household, 2, 48);
  await usual("Laundry detergent", household, 2, 55);
}
