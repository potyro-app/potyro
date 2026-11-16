import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script, typed by use
import { ADAPTIVE, DENSITIES, SPLASH, adaptiveMark, brandResources, iosIcon, readDesign, staleResources, token } from "../scripts/brand.mjs";
// @ts-expect-error — a plain .mjs build script, typed by use
import { bounds, flatten, parsePath, parseSvg, toPathData } from "../scripts/vector.mjs";
// @ts-expect-error — a plain .mjs build script, typed by use
import { coverage, encodePng, paint, pixel } from "../scripts/png.mjs";
import { inflateSync } from "node:zlib";

// The launcher icon and the splash are built from the design package on every cap sync
// (scripts/brand.mjs). These hold the geometry — nothing a launcher mask can cut, the designer's own
// numbers and colours — and the files a build needs.

const design = readDesign();
const files: Record<string, string | Buffer> = brandResources(design);
const text = (path: string) => String(files[path]);

/** A generated PNG back as pixels. */
function decode(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect([...png.subarray(24, 29)]).toEqual([8, 6, 0, 0, 0]); // 8-bit RGBA, no interlace
  const idat = png.subarray(png.indexOf("IDAT") + 4, png.indexOf("IEND") - 8);
  const raw = inflateSync(idat);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0); // filter: none
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, at: (x: number, y: number) => pixel(rgba, width, x, y) as number[] };
}

describe("vector: the logo's path data", () => {
  it("reads relative, compact path data as absolute curves", () => {
    const [sub] = parsePath("M10,10c.5-.5,1-1,2,0s1.5.5,2,0h3v-2Z");
    expect(sub.start).toEqual([10, 10]);
    expect(sub.closed).toBe(true);
    expect(sub.segs.map((s: { type: string }) => s.type)).toEqual(["C", "C", "L", "L"]);
    expect(sub.segs[0].pts).toEqual([10.5, 9.5, 11, 9, 12, 10]);
    // `s` mirrors the last control point about the current one
    expect(sub.segs[1].pts.slice(0, 2)).toEqual([13, 11]);
    expect(sub.segs[3].pts).toEqual([17, 8]);
  });

  it("refuses a command it would otherwise draw wrong", () => {
    expect(() => parsePath("M0,0A5,5,0,0,1,10,10")).toThrow(/not one the logo uses/);
  });

  it("writes Android path data with every number spelled out", () => {
    const data = toPathData(parsePath("M1,2c.5-.5,1-1,2,0Z"));
    expect(data).toBe("M1,2 C1.5,1.5 2,1 3,2 Z");
    expect(data).not.toMatch(/\d\.\d+\.\d|[a-z]/); // no "1.5.5", no relative commands
  });

  it("reads the designer's tile: a background, then the three shapes of the mark", () => {
    const shapes = parseSvg(design.circleTile);
    expect(shapes.map((s: { kind: string }) => s.kind)).toEqual(["circle", "path", "path", "circle"]);
    expect(shapes[0].fill).toBe("#414042");
    expect(shapes[2].fill).toBe("#ee2a7b");
  });
});

describe("png: the rasteriser", () => {
  const square = [[[2, 2], [6, 2], [6, 6], [2, 6]]];

  it("covers whole pixels fully and half-covered ones by half", () => {
    const cov = coverage([[[1, 1], [3.5, 1], [3.5, 3], [1, 3]]], 5, 4);
    expect(cov[1 * 5 + 1]).toBeCloseTo(1);
    expect(cov[1 * 5 + 3]).toBeCloseTo(0.5);
    expect(cov[0]).toBe(0);
  });

  it("paints later layers over earlier ones and leaves the rest transparent", () => {
    const rgba = paint([{ fill: "#414042", polygons: square }, { fill: "#ee2a7b", polygons: [[[4, 2], [6, 2], [6, 6], [4, 6]]] }], 8, 8);
    expect(pixel(rgba, 8, 3, 3)).toEqual([0x41, 0x40, 0x42, 255]);
    expect(pixel(rgba, 8, 5, 3)).toEqual([0xee, 0x2a, 0x7b, 255]);
    expect(pixel(rgba, 8, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("encodes a PNG that decodes to the same pixels, the same bytes each time", () => {
    const rgba = paint([{ fill: "#ee2a7b", polygons: square }], 8, 8);
    const png = encodePng(rgba, 8, 8);
    const back = decode(png);
    expect([back.width, back.height]).toEqual([8, 8]);
    expect(back.at(3, 3)).toEqual([0xee, 0x2a, 0x7b, 255]);
    expect(encodePng(rgba, 8, 8).equals(png)).toBe(true);
  });
});

describe("brand: colours come from the design tokens", () => {
  it("reads --bg for both themes, the first thing the shell paints", () => {
    expect(token(design.tokens, "bg")).toEqual({ light: "#ffffff", dark: "#1c1b1c" });
    expect(() => token(design.tokens, "no-such-token")).toThrow(/no --no-such-token/);
  });

  it("gives the splash and the window that colour, light and night", () => {
    expect(text("values/potyro_brand.xml")).toContain('<color name="potyro_bg">#FFFFFF</color>');
    expect(text("values-night/potyro_brand.xml")).toContain('<color name="potyro_bg">#1C1B1C</color>');
    // and both, whatever the phone's theme, for the bars of a Potyro that is not in it (AppearancePlugin)
    expect(text("values/potyro_brand.xml")).toContain('<color name="potyro_bg_light">#FFFFFF</color>');
    expect(text("values/potyro_brand.xml")).toContain('<color name="potyro_bg_dark">#1C1B1C</color>');
  });

  it("gives the icon the logo's graphite, which is the --ink-soft token", () => {
    expect(text("values/ic_launcher_background.xml")).toContain('<color name="ic_launcher_background">#414042</color>');
    expect(token(design.tokens, "ink-soft").light).toBe("#414042");
  });
});

describe("brand: the adaptive launcher icon", () => {
  const icon = adaptiveMark(design.circleTile);
  const all = icon.shapes.flatMap((s: { subpaths: unknown }) => s.subpaths);

  it("keeps the whole mark inside the circle no launcher mask cuts", () => {
    expect(icon.reach).toBeLessThan(ADAPTIVE.safe / 2);
    expect(icon.reach).toBeGreaterThan(18); // and it is not a speck: over half the safe radius
  });

  it("puts the mark where the designer put it in the tile, scaled to what a launcher shows", () => {
    const box = bounds(all);
    // the tile is 63.12 wide and the mark 33.14: the same share of the 72dp a launcher shows
    expect(box.width / ADAPTIVE.shown).toBeCloseTo(33.14 / 63.12, 3);
    expect(box.cx).toBeCloseTo(ADAPTIVE.canvas / 2, 1);
    // the designer sets the mark a little below the middle of the tile (2.76 of 63.12 units); kept
    expect(box.cy - ADAPTIVE.canvas / 2).toBeCloseTo((2.76 / 63.12) * ADAPTIVE.shown, 1);
  });

  it("refuses a mark that a mask would cut", () => {
    const huge = design.circleTile.replace(/r="31\.56"/, 'r="12"');
    expect(() => adaptiveMark(huge)).toThrow(/a launcher mask keeps only 33dp/);
  });

  it("has a foreground in the logo's colours, a one-colour layer for themed icons, and both icon files naming them", () => {
    const fg = text("drawable/ic_launcher_foreground.xml");
    expect(fg).toContain('android:viewportWidth="108"');
    expect(fg.match(/android:fillColor="#FFFFFF"/g)).toHaveLength(2);
    expect(fg.match(/android:fillColor="#EE2A7B"/g)).toHaveLength(1);
    const mono = text("drawable/ic_launcher_monochrome.xml");
    expect(mono.match(/<path /g)).toHaveLength(3);
    expect(mono).not.toContain("#EE2A7B");
    // the same geometry in both layers
    const data = (xml: string) => [...xml.matchAll(/android:pathData="([^"]+)"/g)].map((m) => m[1]);
    expect(data(mono)).toEqual(data(fg));
    for (const name of ["ic_launcher", "ic_launcher_round"]) {
      const adaptive = text(`mipmap-anydpi-v26/${name}.xml`);
      expect(adaptive).toContain('<background android:drawable="@color/ic_launcher_background" />');
      expect(adaptive).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground" />');
      expect(adaptive).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome" />');
    }
  });

  it("writes path data Android's parser reads: absolute, spelled out, inside the canvas", () => {
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith(".xml") || !String(content).includes("<vector")) continue;
      const canvas = Number(/android:viewportWidth="(\d+)"/.exec(String(content))![1]);
      for (const m of String(content).matchAll(/android:pathData="([^"]+)"/g)) {
        expect(m[1]).toMatch(/^[MLCZ0-9., -]+$/);
        for (const poly of flatten(parsePath(m[1]))) for (const [x, y] of poly) {
          expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(canvas);
          expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(canvas);
        }
      }
    }
  });
});

describe("brand: legacy icons, rasterised at every density", () => {
  it.each(Object.entries(DENSITIES))("%s: a square and a round icon at 48dp", (density, scale) => {
    const px = 48 * (scale as number);
    const square = decode(files[`mipmap-${density}/ic_launcher.png`] as Buffer);
    const round = decode(files[`mipmap-${density}/ic_launcher_round.png`] as Buffer);
    expect([square.width, square.height]).toEqual([px, px]);
    expect([round.width, round.height]).toEqual([px, px]);
    const mid = Math.floor(px / 2);
    // corners are outside both tiles; the left edge's middle is graphite in both
    expect(square.at(0, 0)[3]).toBe(0);
    expect(round.at(0, 0)[3]).toBe(0);
    expect(square.at(Math.round(px * 0.12), mid)).toEqual([0x41, 0x40, 0x42, 255]);
    expect(round.at(Math.round(px * 0.12), mid)).toEqual([0x41, 0x40, 0x42, 255]);
    // a round icon has no ink where the square one has its corner
    const corner = Math.round(px * 0.12);
    expect(square.at(corner, corner)[3]).toBe(255);
    expect(round.at(corner, corner)[3]).toBe(0);
    // the rosa stroke runs through the lower middle of the tile
    const [r, g, b] = square.at(Math.round(px * 0.5), Math.round(px * 0.68));
    expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(90); expect(b).toBeGreaterThan(90);
  });
});

describe("brand: the system splash", () => {
  it("turns the launch theme into the splash and hands over to the app's theme on the same colour", () => {
    const styles = text("values/styles.xml");
    const launch = /<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">([\s\S]*?)<\/style>/.exec(styles)![1];
    expect(launch).toContain('<item name="windowSplashScreenBackground">@color/potyro_bg</item>');
    expect(launch).toContain('<item name="windowSplashScreenAnimatedIcon">@drawable/potyro_splash_icon</item>');
    expect(launch).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    expect(launch).not.toContain("@drawable/splash");
    const app = /<style name="AppTheme\.NoActionBar" [^>]*>([\s\S]*?)<\/style>/.exec(styles)![1];
    expect(app).toContain('<item name="android:windowBackground">@color/potyro_bg</item>');
    expect(styles).toContain('<style name="AppTheme" ');
    // the system bars wear the page's colour, with icons that show on it
    expect(app).toContain('<item name="android:statusBarColor">@color/potyro_bg</item>');
    expect(app).toContain('<item name="android:navigationBarColor">@color/potyro_bg</item>');
    expect(text("values/potyro_brand.xml")).toContain('<bool name="potyro_light_bars">true</bool>');
    expect(text("values-night/potyro_brand.xml")).toContain('<bool name="potyro_light_bars">false</bool>');
  });

  it("draws the mark alone, in the middle, inside the circle the system keeps — graphite by day, white by night", () => {
    const day = text("drawable/potyro_splash_icon.xml");
    const night = text("drawable-night/potyro_splash_icon.xml");
    expect(day).toContain("#414042");
    expect(day).not.toContain("#FFFFFF");
    expect(night).toContain("#FFFFFF");
    expect(night).not.toContain("#414042");
    for (const xml of [day, night]) {
      expect(xml).toContain("#EE2A7B");
      const polys = [...xml.matchAll(/android:pathData="([^"]+)"/g)].flatMap((m) => flatten(parsePath(m[1])));
      const far = Math.max(...polys.flat().map(([x, y]: number[]) => Math.hypot(x - SPLASH.canvas / 2, y - SPLASH.canvas / 2)));
      expect(far).toBeLessThan(SPLASH.safe / 2);
    }
  });
});

describe("brand: what the template leaves behind", () => {
  it("removes Capacitor's own icon layers and splash pictures, and nothing else", () => {
    const generated = [
      "drawable-v24/ic_launcher_foreground.xml", "drawable/ic_launcher_background.xml", "drawable/splash.png",
      "drawable-land-xxhdpi/splash.png", "drawable-port-mdpi/splash.png", "mipmap-hdpi/ic_launcher_foreground.png",
      "mipmap-hdpi/ic_launcher.png", "values/strings.xml", "xml/file_paths.xml", "layout/activity_main.xml",
    ];
    expect(staleResources(generated)).toEqual(generated.slice(0, 6));
    expect(staleResources(Object.keys(files))).toEqual([]); // never one of its own
  });
});

describe("brand: the iOS app icon", () => {
  it("is 1024px with no alpha channel (the App Store refuses one), graphite edge to edge with the mark", () => {
    const png: Buffer = iosIcon(design);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
    expect([...png.subarray(24, 29)]).toEqual([8, 2, 0, 0, 0]); // 8-bit RGB
    const raw = inflateSync(png.subarray(png.indexOf("IDAT") + 4, png.indexOf("IEND") - 8));
    const at = (x: number, y: number) => [...raw.subarray(y * (1024 * 3 + 1) + 1 + x * 3, y * (1024 * 3 + 1) + 4 + x * 3)];
    expect(at(0, 0)).toEqual([0x41, 0x40, 0x42]);
    expect(at(1023, 1023)).toEqual([0x41, 0x40, 0x42]);
    expect(at(512, 430)).toEqual([255, 255, 255]); // the head
  });

  it("refuses to drop the alpha channel from a picture that is not opaque", () => {
    const rgba = paint([{ fill: "#ee2a7b", polygons: [[[2, 2], [6, 2], [6, 6], [2, 6]]] }], 8, 8);
    expect(() => encodePng(rgba, 8, 8, { alpha: false })).toThrow(/not opaque/);
  });
});
