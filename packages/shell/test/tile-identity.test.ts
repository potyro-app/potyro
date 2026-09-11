import { describe, expect, it } from "vitest";
import { tileIdentity } from "../src/tile-identity.js";

// A tile's identity (#82): declared when the app declares it, derived and non-colliding when not.

describe("tileIdentity", () => {
  it("uses the declared icon and accent when there are any", () => {
    expect(tileIdentity({ key: "builtin:workout", name: "PPL Log", icon: "🏋", accent: "#5B8DEF" })).toMatchObject({ glyph: "🏋", kind: "icon", accent: "#5B8DEF" });
  });

  it("falls back to a monogram of the name and a colour from the key", () => {
    const plants = tileIdentity({ key: "user:plants", name: "Plants" });
    const pins = tileIdentity({ key: "user:pins", name: "Pins" });
    const packing = tileIdentity({ key: "user:packing-list", name: "Packing list" });
    expect(plants).toMatchObject({ glyph: "PL", kind: "monogram" });
    expect(pins.glyph).toBe("PI");
    expect(packing.glyph).toBe("PL"); // two words: initials — and the colour is what tells it from Plants
    expect(plants.accent).toMatch(/^oklch\(72% 0\.13 \d+\)$/);
    expect(new Set([plants.hue, pins.hue, packing.hue]).size).toBe(3);
  });

  it("is a pure function of the key: the same app is the same colour on every device", () => {
    expect(tileIdentity({ key: "user:trips", name: "Trips" })).toEqual(tileIdentity({ key: "user:trips", name: "Trips" }));
    expect(tileIdentity({ key: "user:trips", name: "Trips" }).hue).not.toBe(tileIdentity({ key: "builtin:trips", name: "Trips" }).hue);
  });

  it("treats a blank icon or accent as absent", () => {
    expect(tileIdentity({ key: "user:x", name: "Xylo", icon: "  ", accent: "" })).toMatchObject({ kind: "monogram", glyph: "XY" });
  });
});

// #83: the person's own colour for a tile wins over the declared accent; their icon and name come in
// already merged, so the tile shows them the same way.
describe("tileIdentity overrides", () => {
  it("uses the chosen hue over the declared accent, and keeps the derived hue otherwise", () => {
    const own = tileIdentity({ key: "user:recipes", name: "Recipes", icon: "🍳", accent: "#E4A93C" });
    const mine = tileIdentity({ key: "user:recipes", name: "Recipes", icon: "🍳", accent: "#E4A93C", hue: 205 });
    expect(own.accent).toBe("#E4A93C");
    expect(mine).toMatchObject({ accent: "oklch(72% 0.13 205)", hue: 205, glyph: "🍳" });
    expect(tileIdentity({ key: "user:x", name: "Xylo", hue: 25 })).toMatchObject({ accent: "oklch(72% 0.13 25)", kind: "monogram" });
  });
});
