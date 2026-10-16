// Plants' first-run records: a flat's worth of houseplants, each with a photo, where it lives and how
// thirsty it is — so the first screen already says who wants water today and who can wait — and two
// months of care behind them, so the care log reads like a real one.
//
// Fixtures for the browser specs too: Fern is long overdue, Monstera's next watering is the 15th of
// the current month (so the calendar always has an event), Cactus was watered today on a 30-day
// rhythm. The others are spread so that today, this week and later all have something.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

interface PlantSeed {
  name: string;
  file: string;
  species?: string;
  /** Days since the last watering (or the exact date). */
  watered: number | Date;
  every?: number;
  sun?: boolean;
  labels: string[];
  wiki?: string;
  tip?: string;
  winterEvery?: number;
  /** Days since it was last fed, when it was. */
  fed?: number;
  /** Other care, days ago. */
  more?: Array<[kind: string, daysAgo: number, note?: string]>;
}

export async function seedPlants(store: Store, _me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("plant")).length > 0) return;

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const midMonth = new Date(now.getFullYear(), now.getMonth(), 15, 9, 0, 0);

  const PLANTS: PlantSeed[] = [
    // Long overdue → "Thirsty".
    { name: "Fern", file: "fern", species: "Nephrolepis exaltata", watered: 30, labels: ["bathroom", "likes humidity"], wiki: "https://en.wikipedia.org/wiki/Nephrolepis_exaltata", tip: "Keep the soil just moist and mist it in dry weeks.", more: [["mist", 33], ["mist", 40]] },
    // Next watering on the 15th of this month: the calendar always has an event.
    { name: "Monstera", file: "monstera", species: "Monstera deliciosa", watered: new Date(midMonth.getTime() - 7 * DAY), sun: true, labels: ["living room", "from Ana"], wiki: "https://en.wikipedia.org/wiki/Monstera_deliciosa", tip: "Let the top few centimetres dry out between waterings.", fed: 30, more: [["note", 12, "A new leaf is unfurling!"], ["fertilize", 58]] },
    // Watered today, monthly: not due.
    { name: "Cactus", file: "cactus", species: "Echinopsis", watered: 0, every: 30, sun: true, labels: ["windowsill"], tip: "Barely any water in winter." },
    { name: "Basil", file: "basil", species: "Ocimum basilicum", watered: 3, every: 2, sun: true, labels: ["kitchen", "edible"], wiki: "https://en.wikipedia.org/wiki/Basil", tip: "Pinch the tops so it grows bushy.", more: [["prune", 9, "Pesto!"]] },
    { name: "Peace lily", file: "peace-lily", species: "Spathiphyllum", watered: 6, every: 5, labels: ["bedroom", "droops when thirsty"], wiki: "https://en.wikipedia.org/wiki/Spathiphyllum" },
    { name: "Calathea", file: "calathea", species: "Goeppertia makoyana", watered: 3, every: 4, labels: ["living room", "filtered water"], wiki: "https://en.wikipedia.org/wiki/Goeppertia", tip: "Picky: filtered water, no draughts, mist often.", more: [["mist", 1], ["mist", 6]] },
    { name: "Fiddle leaf fig", file: "fiddle-leaf-fig", species: "Ficus lyrata", watered: 4, every: 7, sun: true, labels: ["living room", "needs repotting"], wiki: "https://en.wikipedia.org/wiki/Ficus_lyrata", winterEvery: 10, fed: 35, more: [["repot", 44, "One size up, fresh soil."]] },
    { name: "Pothos", file: "pothos", species: "Epipremnum aureum", watered: 6, every: 8, labels: ["office", "cutting from Lena"], wiki: "https://en.wikipedia.org/wiki/Epipremnum_aureum" },
    { name: "Snake plant", file: "snake-plant", species: "Dracaena trifasciata", watered: 9, every: 14, labels: ["hallway", "hard to kill"], wiki: "https://en.wikipedia.org/wiki/Dracaena_trifasciata", winterEvery: 21 },
    { name: "Aloe vera", file: "aloe-vera", species: "Aloe vera", watered: 12, every: 14, sun: true, labels: ["kitchen", "for burns"], wiki: "https://en.wikipedia.org/wiki/Aloe_vera" },
    { name: "ZZ plant", file: "zz-plant", species: "Zamioculcas zamiifolia", watered: 4, every: 14, labels: ["office"], wiki: "https://en.wikipedia.org/wiki/Zamioculcas" },
  ];

  for (const p of PLANTS) {
    const pic = await photo(`photos/${p.file}.webp`);
    const every = p.every ?? 7;
    const lastWatered = p.watered instanceof Date ? p.watered : ago(p.watered);
    const row = await store.insert("plant", {
      name: p.name,
      active: true,
      wateringIntervalDays: every,
      needsDirectSun: p.sun ?? false,
      labels: p.labels,
      seasonalCare: p.winterEvery ? [{ season: "winter", intervalDays: p.winterEvery, note: "Resting: let the soil dry out" }] : [],
      lastWatered,
      snoozes: 0,
      ...(p.species ? { species: p.species } : {}),
      ...(p.wiki ? { wiki: p.wiki } : {}),
      ...(p.tip ? { tip: p.tip } : {}),
      ...(p.fed !== undefined ? { lastFertilized: ago(p.fed) } : {}),
      ...(pic ? { photo: pic } : {}),
    });
    const plant = String(row.id);
    // Two months of waterings back from the last one, on its rhythm, a day early or late now and then.
    const wobble = [0, 1, -1, 0, 2, 0, -1];
    for (let k = 0, at = lastWatered.getTime(); at > now.getTime() - 60 * DAY; k++, at -= (every + wobble[k % wobble.length]!) * DAY) {
      await store.insert("care", { plant, kind: "water", at: new Date(at), note: "" });
    }
    if (p.fed !== undefined) await store.insert("care", { plant, kind: "fertilize", at: ago(p.fed), note: "" });
    for (const [kind, days, note] of p.more ?? []) await store.insert("care", { plant, kind, at: ago(days), note: note ?? "" });
  }
}
