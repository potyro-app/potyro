// Places' first-run records: a dozen spots around Berlin, the way someone who lives there keeps them —
// favourites ranked against their own kind, places been to with the visits to prove it, places still
// to try with a friend's note, two lists ("Date night", "Sunday"), most with their hours, each with a
// photo.
//
// Fixtures for the browser specs too. Corner Café and Nachtbar sit within a kilometre of Berlin's
// centre (52.52, 13.405) and Paris Bakery is in Potsdam, so "Near me" (2 km) keeps the first two and
// drops the third; Corner Café and Paris Bakery are open around the clock and Nachtbar has no hours,
// so "Open now" has a fixed answer for those three at any time of day.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

type Hours = Array<{ day: string; from: string; to: string }>;
const DAY = 86_400_000;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const every = (from: string, to: string, days: string[] = DAYS): Hours => days.map((day) => ({ day, from, to }));

export async function seedPlaces(store: Store, _me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("place")).length > 0) return;
  const list = async (name: string, emoji: string, note: string) => String((await store.insert("collection", { name, emoji, note })).id);
  const dateNight = await list("Date night", "🌙", "Somewhere for the two of us");
  const sunday = await list("Sunday", "☀️", "Slow days out");

  const ids = new Map<string, string>();
  const place = async (name: string, file: string, row: Record<string, unknown>) => {
    const pic = await photo(`photos/${file}.webp`);
    const saved = await store.insert("place", { name, notes: "", mustOrder: "", vibes: [], openingHours: [], lists: [], ...row, ...(pic ? { photo: [pic] } : {}) });
    ids.set(name, String(saved.id));
  };

  await place("Corner Café", "corner-cafe", {
    location: { lat: 52.521, lng: 13.406 },
    kind: "cafe",
    status: "been",
    rankInKind: 2,
    vibes: ["quiet", "outdoor"],
    rating: 4.5,
    openingHours: every("00:00", "23:59"),
    mustOrder: "Flat white",
    notes: "A window seat and an hour of work.",
  });
  await place("Nachtbar", "nachtbar", {
    location: { lat: 52.515, lng: 13.41 },
    kind: "bar",
    status: "want to go",
    vibes: ["late-night"],
    rating: 4,
    lists: [dateNight],
    notes: "Lena's pick. Old wood, older records.",
  });
  await place("Paris Bakery", "paris-bakery", {
    location: { lat: 52.4, lng: 13.059 },
    kind: "bakery",
    status: "favourite",
    rankInKind: 1,
    vibes: ["cheap"],
    rating: 5,
    lists: [sunday],
    openingHours: every("00:00", "23:59"),
    mustOrder: "The almond croissant",
    notes: "In Potsdam, worth the train.",
  });
  await place("Morning Glory", "morning-glory", {
    location: { lat: 52.538, lng: 13.413 },
    kind: "cafe",
    status: "favourite",
    rankInKind: 1,
    vibes: ["outdoor", "dog-friendly"],
    rating: 4.5,
    lists: [sunday],
    openingHours: [...every("08:00", "15:00", ["mon", "tue", "wed", "thu", "fri"]), ...every("09:00", "16:00", ["sat", "sun"])],
    mustOrder: "Shakshuka",
    notes: "Book ahead after 10 on a Sunday.",
  });
  await place("Ramen Kaido", "ramen-kaido", {
    location: { lat: 52.512, lng: 13.454 },
    kind: "restaurant",
    status: "favourite",
    rankInKind: 1,
    vibes: ["cheap", "quiet"],
    rating: 5,
    lists: [dateNight],
    openingHours: every("12:00", "22:00"),
    mustOrder: "Tonkotsu with the soft egg",
    notes: "Small: go early.",
  });
  await place("Pho Hanoi", "pho-hanoi", {
    location: { lat: 52.53, lng: 13.395 },
    kind: "restaurant",
    status: "been",
    rankInKind: 2,
    vibes: ["cheap"],
    rating: 4,
    openingHours: every("11:00", "22:00"),
    mustOrder: "Pho bo",
  });
  await place("Neon Lounge", "neon-lounge", {
    location: { lat: 52.499, lng: 13.418 },
    kind: "bar",
    status: "been",
    rankInKind: 1,
    vibes: ["late-night", "fancy"],
    rating: 4,
    lists: [dateNight],
    openingHours: every("19:00", "23:59", ["tue", "wed", "thu", "fri", "sat"]),
    mustOrder: "The mezcal sour",
  });
  await place("Kastanie Biergarten", "kastanie-biergarten", {
    location: { lat: 52.5395, lng: 13.4015 },
    kind: "bar",
    status: "want to go",
    vibes: ["outdoor", "cheap", "dog-friendly"],
    lists: [sunday],
    openingHours: every("12:00", "23:00"),
    notes: "Long tables under the chestnuts. For the first warm evening.",
  });
  await place("Forno Rosso", "forno-rosso", {
    location: { lat: 52.487, lng: 13.425 },
    kind: "pizza",
    status: "want to go",
    vibes: ["cheap", "late-night"],
    lists: [dateNight],
    openingHours: every("17:00", "23:30"),
    notes: "Ana says: get the marinara, trust me.",
  });
  await place("Vinothek Mitte", "vinothek", {
    location: { lat: 52.525, lng: 13.389 },
    kind: "bar",
    status: "want to go",
    vibes: ["fancy", "quiet"],
    lists: [dateNight],
    openingHours: every("17:00", "23:00", ["wed", "thu", "fri", "sat"]),
    notes: "Natural wine by the glass. For a birthday?",
  });
  await place("Markthalle Street Food", "street-food-market", {
    location: { lat: 52.502, lng: 13.432 },
    kind: "other",
    status: "been",
    vibes: ["cheap"],
    rating: 4.5,
    lists: [sunday],
    openingHours: [{ day: "thu", from: "17:00", to: "22:00" }, { day: "sat", from: "10:00", to: "18:00" }],
    notes: "Thursday street food: something new every week.",
  });
  await place("Tempelhofer Feld", "tempelhofer-feld", {
    location: { lat: 52.473, lng: 13.401 },
    kind: "park",
    status: "favourite",
    rankInKind: 1,
    vibes: ["outdoor", "dog-friendly", "cheap"],
    rating: 5,
    lists: [sunday],
    openingHours: every("06:00", "22:00"),
    notes: "The old airport. Bikes, kites, the sunset.",
  });
  await place("Schlachtensee", "schlachtensee", {
    location: { lat: 52.44, lng: 13.214 },
    kind: "park",
    status: "want to go",
    vibes: ["outdoor", "quiet", "dog-friendly"],
    lists: [sunday],
    openingHours: every("00:00", "23:59"),
    notes: "Swim, then the walk round the lake.",
  });

  // What was had, and with whom: the Memories page.
  const now = Date.now();
  for (const [name, daysAgo, dish, who, note] of [
    ["Corner Café", 1, "Flat white", "", "Finished the slides here."],
    ["Tempelhofer Feld", 3, "", "Ana and Bo", "Kites, then the sunset."],
    ["Ramen Kaido", 5, "Tonkotsu, soft egg", "Lena", ""],
    ["Morning Glory", 9, "Shakshuka", "Ana", "Waited 20 minutes. Worth it."],
    ["Paris Bakery", 12, "Almond croissant, café au lait", "", ""],
    ["Neon Lounge", 20, "Mezcal sour", "Lena", ""],
    ["Pho Hanoi", 27, "Pho bo", "", "Rainy Tuesday."],
    ["Markthalle Street Food", 31, "Bao buns", "Bo", ""],
    ["Ramen Kaido", 40, "Spicy miso", "Ana", "First time here."],
    ["Paris Bakery", 70, "Pain au chocolat", "Ana", ""],
  ] as const) {
    await store.insert("visit", { place: ids.get(name), at: new Date(now - daysAgo * DAY), dish, with: who, note });
  }
}
