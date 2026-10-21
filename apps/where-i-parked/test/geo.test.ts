import { describe, expect, it } from "vitest";
import { bearingDeg, compass, COMPASS_WORDS, distanceM, distanceText, mapUrl } from "../geo.js";

const number = (n: number, o?: { maximumFractionDigits?: number }) => new Intl.NumberFormat("en-GB", o).format(n);

describe("how far, which way", () => {
  it("measures a distance along the Earth", () => {
    // Brandenburg Gate to Alexanderplatz: about 2.1 km.
    expect(distanceM({ lat: 52.5163, lng: 13.3777 }, { lat: 52.5219, lng: 13.4132 })).toBeCloseTo(2480, -2);
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    // One degree of latitude is ~111 km.
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) / 1000).toBeCloseTo(111.2, 0);
  });

  it("gives the bearing clockwise from north", () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 5);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 5);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toBeCloseTo(45, 0);
  });

  it("names the eight compass points, wrapping round north", () => {
    expect(compass(0)).toBe("north");
    expect(compass(22)).toBe("north");
    expect(compass(23)).toBe("north-east");
    expect(compass(90)).toBe("east");
    expect(compass(135)).toBe("south-east");
    expect(compass(180)).toBe("south");
    expect(compass(225)).toBe("south-west");
    expect(compass(270)).toBe("west");
    expect(compass(315)).toBe("north-west");
    expect(compass(350)).toBe("north");
    expect(compass(-45)).toBe("north-west");
    for (const w of Object.values(COMPASS_WORDS)) for (const l of ["en", "pt-BR", "de", "es", "pl", "it"]) expect((w as Record<string, string>)[l]).toBeTruthy();
  });

  it("writes a distance the way a person reads it", () => {
    expect(distanceText(3, number)).toBe("10 m");
    expect(distanceText(337, number)).toBe("340 m");
    expect(distanceText(995, number)).toBe("1,000 m");
    expect(distanceText(2_437, number)).toBe("2.4 km");
    expect(distanceText(12_600, number)).toBe("13 km");
  });

  it("links to the pin on OpenStreetMap", () => {
    expect(mapUrl({ lat: 52.5163, lng: 13.3777 })).toBe("https://www.openstreetmap.org/?mlat=52.5163&mlon=13.3777#map=18/52.5163/13.3777");
  });
});
