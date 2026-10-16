// Plants' first-run records: a flat's worth of houseplants, each with a photo, where it lives and how
// thirsty it is — so the first screen already says who wants water today and who can wait.
//
// Fixtures for the browser specs too: Fern is long overdue, Monstera's next watering is the 15th of
// the current month (so the calendar always has an event), Cactus was watered today on a 30-day
// rhythm. The others are spread so that today, this week and later all have something.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

export async function seedPlants(store: Store, _me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("plant")).length > 0) return;

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const midMonth = new Date(now.getFullYear(), now.getMonth(), 15, 9, 0, 0);
  const plant = async (name: string, file: string, over: Record<string, unknown>) => {
    const pic = await photo(`photos/${file}.webp`);
    return store.insert("plant", { name, active: true, wateringIntervalDays: 7, seasonalCare: [], needsDirectSun: false, labels: [], ...over, ...(pic ? { photo: pic } : {}) });
  };
  const winterRest = (days: number) => [{ season: "winter", intervalDays: days, note: "Resting: let the soil dry out" }];

  await plant("Fern", "fern", { lastWatered: ago(30), labels: ["bathroom", "likes humidity"], wiki: "https://en.wikipedia.org/wiki/Nephrolepis_exaltata" }); // overdue → shows in "Due"
  await plant("Monstera", "monstera", {
    lastWatered: new Date(midMonth.getTime() - 7 * DAY),
    needsDirectSun: true,
    labels: ["living room", "from Ana"],
    wiki: "https://en.wikipedia.org/wiki/Monstera_deliciosa",
  }); // next = the 15th
  await plant("Cactus", "cactus", { lastWatered: now, wateringIntervalDays: 30, needsDirectSun: true, labels: ["windowsill"] }); // freshly watered → not due
  await plant("Basil", "basil", { lastWatered: ago(3), wateringIntervalDays: 2, needsDirectSun: true, labels: ["kitchen", "edible"], wiki: "https://en.wikipedia.org/wiki/Basil" });
  await plant("Peace lily", "peace-lily", { lastWatered: ago(6), wateringIntervalDays: 5, labels: ["bedroom", "droops when thirsty"], wiki: "https://en.wikipedia.org/wiki/Spathiphyllum" });
  await plant("Calathea", "calathea", { lastWatered: ago(3), wateringIntervalDays: 4, labels: ["living room", "filtered water"], wiki: "https://en.wikipedia.org/wiki/Goeppertia" });
  await plant("Fiddle leaf fig", "fiddle-leaf-fig", { lastWatered: ago(4), wateringIntervalDays: 7, needsDirectSun: true, labels: ["living room", "needs repotting"], seasonalCare: winterRest(10), wiki: "https://en.wikipedia.org/wiki/Ficus_lyrata" });
  await plant("Pothos", "pothos", { lastWatered: ago(6), wateringIntervalDays: 8, labels: ["office", "cutting from Lena"], wiki: "https://en.wikipedia.org/wiki/Epipremnum_aureum" });
  await plant("Snake plant", "snake-plant", { lastWatered: ago(9), wateringIntervalDays: 14, labels: ["hallway", "hard to kill"], seasonalCare: winterRest(21), wiki: "https://en.wikipedia.org/wiki/Dracaena_trifasciata" });
  await plant("Aloe vera", "aloe-vera", { lastWatered: ago(12), wateringIntervalDays: 14, needsDirectSun: true, labels: ["kitchen", "for burns"], wiki: "https://en.wikipedia.org/wiki/Aloe_vera" });
  await plant("ZZ plant", "zz-plant", { lastWatered: ago(4), wateringIntervalDays: 14, labels: ["office"], wiki: "https://en.wikipedia.org/wiki/Zamioculcas" });
}
