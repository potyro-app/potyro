// Putting Ask's proposed places at their real address (#213).
//
// A web search gives the model addresses, not coordinates, so it guesses them. Measured against
// OpenStreetMap on real runs (scripts/run-ask-eval.ts): 90–140 m off on a landmark square, 0.5–1.1 km
// off on ordinary streets — a pin in the wrong part of town. So each proposed place that carries an
// address in its location's label is looked up on OpenStreetMap's geocoder, from this device.
//
// The geocoder is not trusted blindly either: it placed "Via Santa Croce 20, Cuneo" 42 km away, on a
// street of the same name in another town. Its answer is taken only when it lands within
// `AGREE_KM` of the model's guess; otherwise the guess stays and the review says it is approximate.
//
// What leaves the device: the addresses the model proposed — never the person's records. Only when
// the person has web search on. One request a second, as the geocoder's usage policy asks.

import type { AppDefinition } from "potyro";
import type { ReviewRow } from "./ask-apply.js";
import type { SourceHttp } from "./ask-sources.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
/** The model's guesses were up to ~1.1 km off; a geocoder answer farther than this is another place. */
const AGREE_KM = 3;
const PAUSE_MS = 1100;

interface Geo {
  lat: number;
  lng: number;
  label?: string;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function lookUp(http: SourceHttp, address: string, near: { lat: number; lng: number; radiusKm?: number } | undefined): Promise<Geo | null> {
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  if (near) {
    // A preference, not a fence (bounded is off): the address may be just outside the view.
    const d = Math.max(0.05, ((near.radiusKm ?? 3) * 2) / 111);
    url.searchParams.set("viewbox", [near.lng - d, near.lat + d, near.lng + d, near.lat - d].map((n) => n.toFixed(4)).join(","));
  }
  try {
    const res = await http(url.toString(), { method: "GET", credentials: "omit", referrerPolicy: "strict-origin", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const hits = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const lat = Number(hits[0]?.lat);
    const lng = Number(hits[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

/**
 * `rows` with each place that has an address moved to it, when the geocoder agrees; the rest keep
 * the model's point, with a note saying it is approximate. Rows with no address are left alone.
 */
export async function placeByAddress(
  def: AppDefinition,
  rows: ReviewRow[],
  opts: { http: SourceHttp; area?: { lat: number; lng: number; radiusKm?: number }; pause?: number; signal?: AbortSignal; onProgress?: (done: number, of: number) => void },
): Promise<ReviewRow[]> {
  const todo = rows.flatMap((row, i) =>
    Object.entries(def.entities[row.entity]?.fields ?? {})
      .filter(([k, f]) => {
        const v = row.values[k] as Partial<Geo> | undefined;
        return f.type === "geo" && typeof v?.lat === "number" && typeof v?.lng === "number" && typeof v.label === "string" && v.label.trim() !== "";
      })
      .map(([k]) => ({ i, key: k })),
  );
  const out = rows.map((r) => ({ ...r, values: { ...r.values }, notes: [...r.notes] }));
  const pause = opts.pause ?? PAUSE_MS;
  for (const [n, { i, key }] of todo.entries()) {
    if (opts.signal?.aborted) break;
    if (n > 0 && pause) await new Promise((r) => setTimeout(r, pause));
    opts.onProgress?.(n, todo.length);
    const guess = out[i]!.values[key] as Geo;
    const found = await lookUp(opts.http, guess.label!, opts.area ?? guess);
    if (found && km(found, guess) <= AGREE_KM) out[i]!.values[key] = { ...guess, lat: found.lat, lng: found.lng };
    else out[i]!.notes.push(`Location approximate: “${guess.label}” could not be confirmed on the map.`);
  }
  return out;
}
