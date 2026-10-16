// Reading EMSC's messages (real ones, captured from the live feed and the catalogue) and the app's own
// sums: strength, distance, the near-me rule, and what is pruned.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { distanceKm, placeName, readCollection, readMessage, recentUrl, shouldAlert, strength, toPrune, KEEP_DAYS, KEEP_MAX } from "../quakes.js";
import { demoMessage, DEMO_BACKLOG, DEMO_LIVE } from "../demo.js";

const socketSamples = JSON.parse(readFileSync(new URL("../fixtures/emsc-socket.json", import.meta.url), "utf8")) as string[];
const catalogue = JSON.parse(readFileSync(new URL("../fixtures/fdsn-recent.json", import.meta.url), "utf8")) as unknown;

describe("reading the feed", () => {
  it("reads the live feed's messages as EMSC sends them: create and update, a GeoJSON Feature each", () => {
    const read = socketSamples.map(readMessage);
    expect(read.every(Boolean)).toBe(true);
    expect(read[0]).toEqual({
      action: "create",
      quake: {
        uid: "20260923_0000372",
        place: "South Sandwich Islands Region",
        mag: 4.5,
        magType: "mb",
        depth: 155.2,
        time: new Date("2026-09-23T10:58:12.445Z"),
        updated: new Date("2026-10-15T20:07:49.042268Z"),
        lat: -58.4079,
        lng: -26.306,
        authority: "NEIC",
      },
    });
    expect(read[2]!.action).toBe("update");
  });

  it("reads the catalogue's answer, the same Features in a collection", () => {
    const quakes = readCollection(catalogue);
    expect(quakes.length).toBe(46);
    expect(quakes[0]!.place).toBe("Panama");
    expect(quakes.find((q) => q.place.startsWith("New Britain"))!.place).toBe("New Britain Region, P.N.G.");
  });

  it("ignores what is not an earthquake or not a message: a blast, a keep-alive, broken JSON", () => {
    const blast = JSON.parse(socketSamples[0]!) as { data: { properties: Record<string, unknown> } };
    blast.data.properties.evtype = "qb";
    expect(readMessage(JSON.stringify(blast))).toBeNull();
    expect(readMessage("ping")).toBeNull();
    expect(readMessage("{")).toBeNull();
    expect(readMessage(JSON.stringify({ action: "delete", data: {} }))).toBeNull();
    expect(readCollection({ nope: true })).toEqual([]);
    const noPlace = JSON.parse(socketSamples[1]!) as { data: { properties: Record<string, unknown> } };
    delete noPlace.data.properties.lat;
    noPlace.data.properties.lon = null;
    (noPlace.data as unknown as { geometry: unknown }).geometry = null;
    expect(readMessage(JSON.stringify(noPlace))).toBeNull();
  });

  it("writes EMSC's capitals as a place name", () => {
    expect(placeName("NEAR EAST COAST OF HONSHU, JAPAN")).toBe("Near East Coast of Honshu, Japan");
    expect(placeName("CENTRAL MID-ATLANTIC RIDGE")).toBe("Central Mid-Atlantic Ridge");
    expect(placeName("PANAMA-COSTA RICA BORDER REGION")).toBe("Panama-Costa Rica Border Region");
  });

  it("asks the catalogue for the last day from a magnitude, newest first", () => {
    expect(recentUrl(new Date("2026-10-15T10:00:00Z"), 3)).toBe(
      "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&orderby=time&limit=300&minmag=3&start=2026-10-15T10:00:00",
    );
  });

  it("plays the demo through the same reading: every demo event is a valid message, its time moved to now", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    for (const e of [...DEMO_BACKLOG, ...DEMO_LIVE]) {
      const m = readMessage(demoMessage(e, now));
      expect(m, e.uid).not.toBeNull();
      expect(m!.quake.uid).toBe(`demo-${e.uid}`);
      expect(now - m!.quake.time.getTime()).toBe(e.minutesAgo * 60_000);
    }
    expect(DEMO_BACKLOG.every((e) => e.minutesAgo < 24 * 60)).toBe(true);
    expect(DEMO_LIVE.at(-1)!.action).toBe("update");
  });
});

describe("the app's own sums", () => {
  it("names a magnitude's strength", () => {
    expect([2.1, 4, 4.9, 5, 6.2, 7.8].map(strength)).toEqual(["minor", "light", "light", "moderate", "strong", "major"]);
  });

  it("measures great-circle distance", () => {
    const warsaw = { lat: 52.2297, lng: 21.0122 };
    const rome = { lat: 41.9028, lng: 12.4964 };
    expect(Math.round(distanceKm(warsaw, rome))).toBe(1315);
    expect(distanceKm(warsaw, warsaw)).toBe(0);
  });

  it("alerts only on a fresh, strong enough, close enough quake — never without a home", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const home = { lat: 41.9, lng: 12.5 };
    const near = { mag: 5.1, lat: 42.35, lng: 13.4, time: new Date("2026-10-15T11:58:00Z") }; // L'Aquila, ~90 km
    const o = { above: 4.5, withinKm: 300, now };
    expect(shouldAlert(near, home, o)).toBe(true);
    expect(shouldAlert({ ...near, mag: 4.4 }, home, o)).toBe(false);
    expect(shouldAlert({ ...near, lat: 37.5, lng: 15.1 }, home, o)).toBe(false); // Etna, ~560 km
    expect(shouldAlert({ ...near, time: new Date("2026-10-15T09:00:00Z") }, home, o)).toBe(false); // filled in, not new
    expect(shouldAlert(near, null, o)).toBe(false);
  });

  it("prunes the oldest beyond the limit and anything older than a week", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const rows = [
      { id: "new", time: at(1) },
      { id: "old", time: at(KEEP_DAYS * 24 + 1) },
      { id: "mid", time: at(30) },
      { id: "none", time: null },
    ];
    expect(toPrune(rows, now).sort()).toEqual(["none", "old"]);
    expect(toPrune(rows, now, 1).sort()).toEqual(["mid", "none", "old"]);
    const many = Array.from({ length: KEEP_MAX + 5 }, (_, i) => ({ id: `q${i}`, time: at(i / 100) }));
    expect(toPrune(many, now)).toEqual(["q1500", "q1501", "q1502", "q1503", "q1504"]);
  });
});
