// Places' first-run records: a dozen spots around Berlin, the way someone who lives there keeps them —
// some visited and rated, some still to try, most with their hours, each with a photo.
//
// Fixtures for the browser specs too. Corner Café and Nachtbar sit within a kilometre of Berlin's
// centre (52.52, 13.405) and Paris Bakery is in Potsdam, so "Near me" (2 km) keeps the first two and
// drops the third; Corner Café and Paris Bakery are open around the clock and Nachtbar has no hours,
// so "Open now" has a fixed answer for those three at any time of day.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

type Hours = Array<{ day: string; from: string; to: string }>;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const every = (from: string, to: string, days: string[] = DAYS): Hours => days.map((day) => ({ day, from, to }));

export async function seedPlaces(store: Store, _me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("place")).length > 0) return;
  const place = async (name: string, file: string, row: Record<string, unknown>) => {
    const pic = await photo(`photos/${file}.webp`);
    return store.insert("place", { name, notes: "", vibes: [], openingHours: [], ...row, ...(pic ? { photo: [pic] } : {}) });
  };

  await place("Corner Café", "corner-cafe", {
    location: { lat: 52.521, lng: 13.406 },
    kind: "cafe",
    vibes: ["quiet", "outdoor"],
    visited: true,
    rating: 4.5,
    openingHours: every("00:00", "23:59"),
    notes: "Flat white and a window seat. Good for an hour of work.",
  });
  await place("Nachtbar", "nachtbar", {
    location: { lat: 52.515, lng: 13.41 },
    kind: "bar",
    vibes: ["late-night"],
    visited: false,
    rating: 4,
    notes: "Lena's pick. Old wood, older records.",
  });
  await place("Paris Bakery", "paris-bakery", {
    location: { lat: 52.4, lng: 13.059 },
    kind: "bakery",
    vibes: ["cheap"],
    visited: true,
    rating: 5,
    openingHours: every("00:00", "23:59"),
    notes: "In Potsdam, worth the train: the best croissant this side of the Rhine.",
  });
  await place("Morning Glory", "morning-glory", {
    location: { lat: 52.538, lng: 13.413 },
    kind: "cafe",
    vibes: ["outdoor", "dog-friendly"],
    visited: true,
    rating: 4.5,
    openingHours: [...every("08:00", "15:00", ["mon", "tue", "wed", "thu", "fri"]), ...every("09:00", "16:00", ["sat", "sun"])],
    notes: "Sunday brunch. Book ahead after 10.",
  });
  await place("Ramen Kaido", "ramen-kaido", {
    location: { lat: 52.512, lng: 13.454 },
    kind: "restaurant",
    vibes: ["cheap", "quiet"],
    visited: true,
    rating: 5,
    openingHours: every("12:00", "22:00"),
    notes: "Tonkotsu with the soft egg. Small: go early.",
  });
  await place("Pho Hanoi", "pho-hanoi", {
    location: { lat: 52.53, lng: 13.395 },
    kind: "restaurant",
    vibes: ["cheap"],
    visited: true,
    rating: 4,
    openingHours: every("11:00", "22:00"),
    notes: "Pho bo on a cold day.",
  });
  await place("Neon Lounge", "neon-lounge", {
    location: { lat: 52.499, lng: 13.418 },
    kind: "bar",
    vibes: ["late-night", "fancy"],
    visited: true,
    rating: 4,
    openingHours: every("19:00", "23:59", ["tue", "wed", "thu", "fri", "sat"]),
    notes: "Cocktails. Ask for the mezcal one.",
  });
  await place("Kastanie Biergarten", "kastanie-biergarten", {
    location: { lat: 52.5395, lng: 13.4015 },
    kind: "bar",
    vibes: ["outdoor", "cheap", "dog-friendly"],
    visited: false,
    openingHours: every("12:00", "23:00"),
    notes: "Long tables under the chestnuts. For the first warm evening.",
  });
  await place("Forno Rosso", "forno-rosso", {
    location: { lat: 52.487, lng: 13.425 },
    kind: "pizza",
    vibes: ["cheap", "late-night"],
    visited: false,
    openingHours: every("17:00", "23:30"),
    notes: "Wood oven. Ana says the marinara.",
  });
  await place("Vinothek Mitte", "vinothek", {
    location: { lat: 52.525, lng: 13.389 },
    kind: "bar",
    vibes: ["fancy", "quiet"],
    visited: false,
    openingHours: every("17:00", "23:00", ["wed", "thu", "fri", "sat"]),
    notes: "Natural wine by the glass. Birthday?",
  });
  await place("Markthalle Street Food", "street-food-market", {
    location: { lat: 52.502, lng: 13.432 },
    kind: "other",
    vibes: ["cheap"],
    visited: true,
    rating: 4.5,
    openingHours: [{ day: "thu", from: "17:00", to: "22:00" }, { day: "sat", from: "10:00", to: "18:00" }],
    notes: "Thursday street food: something new every week.",
  });
  await place("Tempelhofer Feld", "tempelhofer-feld", {
    location: { lat: 52.473, lng: 13.401 },
    kind: "other",
    vibes: ["outdoor", "dog-friendly", "cheap"],
    visited: true,
    rating: 5,
    openingHours: every("06:00", "22:00"),
    notes: "The old airport. Bikes, kites, the sunset.",
  });
  await place("Schlachtensee", "schlachtensee", {
    location: { lat: 52.44, lng: 13.214 },
    kind: "other",
    vibes: ["outdoor", "quiet", "dog-friendly"],
    visited: false,
    openingHours: every("00:00", "23:59"),
    notes: "Swim, then the walk round the lake.",
  });
}
