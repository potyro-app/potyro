// Where the car is from where you stand: how far, and which way. Plain functions, so the screen's
// words are tested without a phone — a great-circle distance (haversine), the initial bearing from
// here to there, and that bearing as one of eight compass points.
import type { Words } from "potyro";

export interface Point {
  lat: number;
  lng: number;
}

const R = 6_371_000; // metres, the mean radius of the Earth
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Metres along the Earth's surface from `a` to `b`. */
export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The direction to walk from `a` to reach `b`: degrees clockwise from north, 0 ≤ b < 360. */
export function bearingDeg(a: Point, b: Point): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export type Compass = "north" | "north-east" | "east" | "south-east" | "south" | "south-west" | "west" | "north-west";

const POINTS: Compass[] = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** A bearing as one of the eight compass points: 337.5°–22.5° is north, and so on round. */
export function compass(bearing: number): Compass {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return POINTS[i]!;
}

/** The eight compass points, in the app's six languages. */
export const COMPASS_WORDS: Record<Compass, Words> = {
  north: { en: "north", "pt-BR": "norte", de: "Norden", es: "norte", pl: "północ", it: "nord" },
  "north-east": { en: "north-east", "pt-BR": "nordeste", de: "Nordosten", es: "noreste", pl: "północny wschód", it: "nord-est" },
  east: { en: "east", "pt-BR": "leste", de: "Osten", es: "este", pl: "wschód", it: "est" },
  "south-east": { en: "south-east", "pt-BR": "sudeste", de: "Südosten", es: "sureste", pl: "południowy wschód", it: "sud-est" },
  south: { en: "south", "pt-BR": "sul", de: "Süden", es: "sur", pl: "południe", it: "sud" },
  "south-west": { en: "south-west", "pt-BR": "sudoeste", de: "Südwesten", es: "suroeste", pl: "południowy zachód", it: "sud-ovest" },
  west: { en: "west", "pt-BR": "oeste", de: "Westen", es: "oeste", pl: "zachód", it: "ovest" },
  "north-west": { en: "north-west", "pt-BR": "noroeste", de: "Nordwesten", es: "noroeste", pl: "północny zachód", it: "nord-ovest" },
};

/**
 * A distance as a person reads it: under a kilometre in tens of metres ("340 m"), under ten
 * kilometres with one decimal ("2.4 km"), beyond that whole kilometres. `number` is `ctx.format.number`.
 */
export function distanceText(metres: number, number: (n: number, opts?: { maximumFractionDigits?: number }) => string): string {
  if (metres < 1000) return `${number(Math.max(10, Math.round(metres / 10) * 10))} m`;
  if (metres < 10_000) return `${number(Math.round(metres / 100) / 10, { maximumFractionDigits: 1 })} km`;
  return `${number(Math.round(metres / 1000))} km`;
}

/** A link to the spot on OpenStreetMap: the map app's job is the route, ours is the pin. */
export function mapUrl(p: Point): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
}
