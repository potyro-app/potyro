import { describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import { placeByAddress } from "../src/ask-geocode.js";
import type { ReviewRow } from "../src/ask-apply.js";

// Placing Ask's proposed places at their real address (#213). Measured: a model given an address
// guesses coordinates 0.5–1.1 km off on ordinary streets. OpenStreetMap's geocoder is far better —
// and sometimes wrong by tens of km (a street of the same name in another town), so its answer is
// only taken when it agrees roughly with the model's; otherwise the review says "approximate".

const DEF = {
  id: "p",
  name: "P",
  entities: { place: { displayField: "name", fields: { name: { type: "text" }, location: { type: "geo" }, note: { type: "text" } } } },
  pages: [],
} as unknown as AppDefinition;

const row = (ref: string, lat: number, lng: number, label?: string): ReviewRow => ({
  entity: "place",
  ref,
  values: { name: ref, location: { lat, lng, ...(label ? { label } : {}) } },
  duplicate: false,
  notes: [],
});

function osm(answers: Record<string, [number, number] | null>) {
  const asked: string[] = [];
  const http = async (url: string) => {
    const q = new URL(url).searchParams.get("q")!;
    asked.push(url);
    const hit = answers[q];
    return new Response(JSON.stringify(hit ? [{ lat: String(hit[0]), lon: String(hit[1]) }] : []), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { http, asked };
}

describe("placeByAddress", () => {
  it("moves a place to its address when the geocoder agrees with the model", async () => {
    const { http } = osm({ "Via Busca 3b, Cuneo": [44.3925, 7.5486] });
    const [out] = await placeByAddress(DEF, [row("ninfood", 44.385, 7.543, "Via Busca 3b, Cuneo")], { http, pause: 0 });
    expect(out!.values.location).toEqual({ lat: 44.3925, lng: 7.5486, label: "Via Busca 3b, Cuneo" });
    expect(out!.notes).toEqual([]);
  });

  it("keeps the model's point and says it is approximate when the geocoder lands far away", async () => {
    const { http } = osm({ "Via Santa Croce 20, Cuneo": [44.1, 7.9] });
    const [out] = await placeByAddress(DEF, [row("alter", 44.3835, 7.5415, "Via Santa Croce 20, Cuneo")], { http, pause: 0 });
    expect(out!.values.location).toEqual({ lat: 44.3835, lng: 7.5415, label: "Via Santa Croce 20, Cuneo" });
    expect(out!.notes.join()).toMatch(/approximate/i);
  });

  it("says approximate when the address is not found, and leaves rows without an address alone", async () => {
    const { http, asked } = osm({});
    const out = await placeByAddress(DEF, [row("a", 44.38, 7.54, "Nowhere 1, Cuneo"), row("b", 44.39, 7.55)], { http, pause: 0 });
    expect(out[0]!.notes.join()).toMatch(/approximate/i);
    expect(out[1]).toEqual(row("b", 44.39, 7.55));
    expect(asked).toHaveLength(1);
  });

  it("asks near the area on the map, and survives the geocoder failing", async () => {
    const failing = async () => {
      throw new TypeError("Failed to fetch");
    };
    const out = await placeByAddress(DEF, [row("a", 44.38, 7.54, "Via Roma 31, Cuneo")], { http: failing, pause: 0 });
    expect(out[0]!.values.location).toEqual({ lat: 44.38, lng: 7.54, label: "Via Roma 31, Cuneo" });
    expect(out[0]!.notes.join()).toMatch(/approximate/i);

    const { http, asked } = osm({ "Via Roma 31, Cuneo": [44.3907, 7.5485] });
    await placeByAddress(DEF, [row("a", 44.38, 7.54, "Via Roma 31, Cuneo")], { http, pause: 0, area: { lat: 44.3845, lng: 7.5427, radiusKm: 3 } });
    const url = new URL(asked[0]!);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("viewbox")).toBeTruthy();
    expect(url.searchParams.get("format")).toBe("jsonv2");
  });
});
