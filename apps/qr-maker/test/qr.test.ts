// The encoder is proved by an independent decoder: every code it makes is rendered to pixels and
// read back with jsQR. A wrong table, a wrong mask or a wrong bit order fails here.
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { byteCapacity, encode, pngOf, rgbaOf, versionFor, type Ecl } from "../qr.js";

const read = (text: string, ecl: Ecl = "M"): { text: string; version: number } => {
  const m = encode(text, ecl);
  const px = rgbaOf(m, 4, 4);
  const got = jsQR(px.data, px.width, px.height);
  if (!got) throw new Error(`jsQR could not read the code for ${JSON.stringify(text.slice(0, 40))} (version ${m.version}, mask ${m.mask})`);
  return { text: got.data, version: m.version };
};

describe("the encoder, read back by jsQR", () => {
  it("reads short text", () => {
    expect(read("Hello, world!")).toEqual({ text: "Hello, world!", version: 1 });
  });

  it("reads a link", () => {
    expect(read("https://potyro.app/?app=qr-maker").text).toBe("https://potyro.app/?app=qr-maker");
  });

  it("reads a Wi‑Fi string", () => {
    const wifi = "WIFI:T:WPA;S:Café Guest;P:cr0issant!;;";
    expect(read(wifi).text).toBe(wifi);
  });

  it("reads UTF-8 with accents and emoji", () => {
    const s = "Ça va? Zażółć gęślą jaźń — 🎉✨";
    expect(read(s).text).toBe(s);
  });

  it("reads long text across several versions, at every level", () => {
    for (const ecl of ["L", "M", "Q", "H"] as const) {
      for (const n of [20, 60, 120, 300, 700]) {
        const s = "x".repeat(n).replace(/x/g, (_, i: number) => String.fromCharCode(97 + (i % 26)));
        const got = read(s, ecl);
        expect(got.text, `${n} at ${ecl}`).toBe(s);
      }
    }
  });

  it("spans every version from 1 to 40 at M", () => {
    for (let v = 1; v <= 40; v++) {
      const s = "q".repeat(byteCapacity(v, "M"));
      expect(versionFor(s, "M")).toBe(v);
      const got = read(s);
      expect(got.version, `version ${v}`).toBe(v);
      expect(got.text).toBe(s);
    }
  });

  it("handles the empty string gracefully, and refuses what cannot fit", () => {
    const m = encode("");
    expect(m.version).toBe(1);
    expect(() => encode("z".repeat(3000), "L")).toThrow(/Too long/);
    expect(versionFor("z".repeat(3000), "L")).toBeNull();
    expect(byteCapacity(1, "L")).toBe(17);
    expect(byteCapacity(40, "L")).toBe(2953);
  });

  it("chooses a mask by the penalties, and the code is still square", () => {
    const m = encode("mask test");
    expect(m.mask).toBeGreaterThanOrEqual(0);
    expect(m.mask).toBeLessThan(8);
    expect(m.modules).toHaveLength(m.size);
    for (const row of m.modules) expect(row).toHaveLength(m.size);
  });
});

describe("the PNG", () => {
  it("is a valid PNG whose pixels are the code, and jsQR reads them", () => {
    const m = encode("https://potyro.app");
    const png = pngOf(m, 8, 4);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const side = (m.size + 8) * 8;
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(side);
    expect(view.getUint32(20)).toBe(side);
    expect(png[24]).toBe(1); // bit depth
    expect(png[25]).toBe(0); // greyscale
    // IDAT: a zlib stream node inflates; its rows are the code's pixels.
    const idatLen = view.getUint32(33);
    expect(String.fromCharCode(...png.slice(37, 41))).toBe("IDAT");
    const raw = inflateSync(png.slice(41, 41 + idatLen));
    const rowBytes = Math.ceil(side / 8);
    expect(raw.length).toBe(side * (rowBytes + 1));
    const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < side; y++) {
      expect(raw[y * (rowBytes + 1)]).toBe(0);
      for (let x = 0; x < side; x++) {
        const bit = (raw[y * (rowBytes + 1) + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
        if (!bit) rgba[(y * side + x) * 4] = rgba[(y * side + x) * 4 + 1] = rgba[(y * side + x) * 4 + 2] = 0;
      }
    }
    expect(jsQR(rgba, side, side)?.data).toBe("https://potyro.app");
  });
});
