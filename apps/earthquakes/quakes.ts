// What EMSC's feed says, read into plain earthquakes — and what the app does with them: how strong,
// how far, how long ago, which to keep.
//
// The live feed (wss://www.seismicportal.eu/standing_order/websocket) sends one message per new or
// revised event: `{ "action": "create" | "update", "data": <GeoJSON Feature> }`. The catalogue's
// FDSN query (`/fdsnws/event/1/query?format=json`) answers a FeatureCollection of the same Features,
// which the app uses to fill the last day in when it starts. Both are read by `readFeature`.
//
// Data: EMSC, CC BY 4.0 (https://www.seismicportal.eu/realtime.html).

export const EMSC_HOST = "www.seismicportal.eu";
export const EMSC_SOCKET = `wss://${EMSC_HOST}/standing_order/websocket`;

/** The last `hours` of events at or above `minMag`, newest first, as JSON. */
export function recentUrl(since: Date, minMag: number, limit = 300): string {
  const start = since.toISOString().slice(0, 19);
  return `https://${EMSC_HOST}/fdsnws/event/1/query?format=json&orderby=time&limit=${limit}&minmag=${minMag}&start=${start}`;
}

/** The event's page on EMSC. */
export const eventUrl = (uid: string): string => `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(uid)}`;

export interface Quake {
  uid: string;
  /** "Northern Alaska", from EMSC's FLINN-ENGDAHL region name in capitals. */
  place: string;
  mag: number;
  magType: string;
  /** km below the surface. */
  depth: number;
  time: Date;
  updated: Date;
  lat: number;
  lng: number;
  /** Who located it: "AK", "CSN", "INGV". */
  authority: string;
}

export interface QuakeMessage {
  action: "create" | "update";
  quake: Quake;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Small words stay small; everything else gets a capital: "NEAR COAST OF PERU" → "Near Coast of Peru". */
export function placeName(region: string): string {
  const small = new Set(["of", "the", "and", "near", "off", "in"]);
  return region
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/(^|[-.])\p{L}/gu, (m) => m.toUpperCase())))
    .join(" ");
}

/** One GeoJSON Feature from EMSC → a quake, or null when it is not one (an explosion, no place, no time). */
export function readFeature(f: unknown): Quake | null {
  if (!f || typeof f !== "object") return null;
  const feature = f as { id?: unknown; geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
  const p = feature.properties;
  if (!p || typeof p !== "object") return null;
  // "ke" is a known earthquake; EMSC marks quarry blasts, explosions and the like otherwise ("qb", "ex").
  if (p.evtype !== undefined && p.evtype !== null && p.evtype !== "ke" && p.evtype !== "se") return null;
  const coords = Array.isArray(feature.geometry?.coordinates) ? (feature.geometry!.coordinates as unknown[]) : [];
  const lat = num(p.lat) ?? num(coords[1]);
  const lng = num(p.lon) ?? num(coords[0]);
  const mag = num(p.mag);
  const time = date(p.time);
  const uid = typeof p.unid === "string" ? p.unid : typeof feature.id === "string" ? feature.id : null;
  if (lat === null || lng === null || mag === null || !time || !uid) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const depth = num(p.depth) ?? (num(coords[2]) !== null ? Math.abs(num(coords[2])!) : 0);
  return {
    uid,
    place: placeName(typeof p.flynn_region === "string" && p.flynn_region ? p.flynn_region : "Unknown region"),
    mag: Math.round(mag * 10) / 10,
    magType: typeof p.magtype === "string" ? p.magtype : "",
    depth: Math.round(depth * 10) / 10,
    time,
    updated: date(p.lastupdate) ?? time,
    lat,
    lng,
    authority: typeof p.auth === "string" ? p.auth : "",
  };
}

/** One message of the live feed; null for anything else (a keep-alive, a malformed line). */
export function readMessage(text: string): QuakeMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { action?: unknown; data?: unknown };
  const action = m.action === "update" ? "update" : m.action === "create" ? "create" : null;
  if (!action) return null;
  const quake = readFeature(m.data);
  return quake ? { action, quake } : null;
}

/** The FDSN answer → quakes; an answer that is not a FeatureCollection reads as none. */
export function readCollection(body: unknown): Quake[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.map(readFeature).filter((q): q is Quake => q !== null);
}

// ------------------------------------------------------------------- how strong, how far, how long

/** Strongest first: the order a list groups them in. */
export const STRENGTHS = ["major", "strong", "moderate", "light", "minor"] as const;
export type Strength = (typeof STRENGTHS)[number];

/** The usual words for a magnitude: under 4 minor, 4 light, 5 moderate, 6 strong, 7 and up major. */
export function strength(mag: number): Strength {
  if (mag >= 7) return "major";
  if (mag >= 6) return "strong";
  if (mag >= 5) return "moderate";
  if (mag >= 4) return "light";
  return "minor";
}

/** The pin's colour by strength: calm to alarming, readable on the map's pale tiles. */
export const STRENGTH_COLOURS: Record<Strength, string> = {
  minor: "#7a8a99",
  light: "#d9a400",
  moderate: "#e8740c",
  strong: "#d43d1a",
  major: "#8f1239",
};

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Should this quake ring the near-me alert? Only a fresh one (not a day-old event filled in), strong enough and close enough. */
export function shouldAlert(q: Pick<Quake, "mag" | "lat" | "lng" | "time">, home: { lat: number; lng: number } | null, o: { above: number; withinKm: number; now: Date }): boolean {
  if (!home) return false;
  if (q.mag < o.above) return false;
  if (o.now.getTime() - q.time.getTime() > 60 * 60 * 1000) return false;
  return distanceKm(q, home) <= o.withinKm;
}

// ------------------------------------------------------------------- keeping the store small

/** At most this many quakes are kept, and none older than `KEEP_DAYS`. */
export const KEEP_MAX = 1500;
export const KEEP_DAYS = 7;

/**
 * Which records to delete so that what is left is at most `max`, none older than `days`: the oldest
 * go first. Pure, so it is tested without a store.
 */
export function toPrune<T extends { id: string; time: Date | null }>(rows: readonly T[], now: Date, max = KEEP_MAX, days = KEEP_DAYS): string[] {
  const cutoff = now.getTime() - days * 86_400_000;
  const byAge = [...rows].sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0));
  const out: string[] = [];
  byAge.forEach((r, i) => {
    if (i >= max || !r.time || r.time.getTime() < cutoff) out.push(r.id);
  });
  return out;
}

/** A record's `time` as a Date, whatever the store gave back. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
