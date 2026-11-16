// Give the generated Android project Potyro's face: the launcher icon and the splash screen.
//
// `cap add android` ships Capacitor's own icon and a splash PNG, and android/ is generated and
// gitignored, so — like the manifest patch — this runs after every `cap add` / `cap sync` and builds
// every resource again from the design package: the designer's symbol tiles and mark
// (packages/design/logo, never redrawn) and the colours in tokens.css. Idempotent; the same inputs
// write the same bytes.
//
// THE LAUNCHER ICON is the designer's dark symbol tile (DESIGN.md §4.1: "the symbol in a circle or
// a rounded square for icon and favicon"), the one the favicon and the installed web app wear:
//   · adaptive (Android 8+): a 108dp canvas, background the tile's graphite, foreground the mark
//     exactly where the designer put it in the circle tile, the tile scaled to the 72dp a launcher
//     shows. Every launcher mask (circle, squircle, rounded square, teardrop) keeps the 66dp circle
//     in the middle; the script refuses to write a mark that reaches outside it.
//   · monochrome (Android 13+ themed icons): the same three shapes in one colour; the launcher tints.
//   · legacy and round PNGs at the five densities for Android 7: the square and the circle tile
//     themselves, rasterised at each size (png.mjs), never scaled from another size.
//
// THE SPLASH is the system one (Android 12+; androidx core-splashscreen, which Capacitor's template
// already depends on, draws the same theme on Android 7–11): the page's own background and the mark
// alone, with a night variant, then the app's theme with that same colour behind the WebView. The
// colours are tokens.css's `--bg`, the first thing the shell paints, so splash → window → page is
// one colour and nothing flashes. `@capacitor/splash-screen` is not needed and not added.
// SplashHold.java (patch-android.mjs) keeps the splash up until the page has loaded.
//
// Also here, from the same mark: the status-bar icon reminders use (`ic_stat_potyro`), and — when
// ios/ exists — the one 1024px image the generated iOS project takes as its app icon.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bounds, flatten, parseSvg, place, reach, toPathData } from "./vector.mjs";
import { encodePng, paint } from "./png.mjs";

/** Android's adaptive-icon canvas, what a launcher shows of it, and the circle no mask ever cuts. */
export const ADAPTIVE = { canvas: 108, shown: 72, safe: 66 };
/** The splash icon's canvas (no icon background) and the circle the system keeps of it. */
export const SPLASH = { canvas: 288, safe: 192, markWidth: 104 };
/** Legacy icons: 48dp, the tile a little inside it as Android's own legacy icons sit. */
export const LEGACY = { canvas: 48, square: 42, round: 44 };
export const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const STAT = { canvas: 24, mark: 19 };
const IOS_ICON = { size: 1024 };

const DESIGN = fileURLToPath(new URL("../../design/", import.meta.url));

/** The design package's files this script reads, as text. */
export function readDesign(dir = DESIGN) {
  const logo = (name) => readFileSync(join(dir, "logo", `${name}.svg`), "utf8");
  return {
    circleTile: logo("symbol-circle-dark"),
    squareTile: logo("symbol-square-dark"),
    mark: logo("symbol-rosa"),
    markOnDark: logo("symbol-rosa-on-dark"),
    tokens: readFileSync(join(dir, "tokens.css"), "utf8"),
  };
}

/** `--name` in the light root and in the dark theme of tokens.css. Throws when either is missing. */
export function token(css, name) {
  const light = new RegExp(`:root\\s*\\{[^}]*?--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
  const dark = new RegExp(`prefers-color-scheme:\\s*dark[^}]*?\\{[^}]*?--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
  if (!light || !dark) throw new Error(`tokens.css has no --${name} for both themes`);
  return { light: light.toLowerCase(), dark: dark.toLowerCase() };
}

/** A tile file as its background (the first shape) and the mark's shapes. */
function tile(svg) {
  const [background, ...mark] = parseSvg(svg);
  const centre = background.kind === "circle"
    ? [background.circle.cx, background.circle.cy]
    : [background.rect.x + background.rect.width / 2, background.rect.y + background.rect.height / 2];
  const size = background.kind === "circle" ? background.circle.r * 2 : background.rect.width;
  return { background, mark, centre, size };
}

/**
 * The mark on the adaptive canvas, as the designer placed it in the circle tile. Throws if any of it
 * would leave the safe circle — a mask would cut it.
 */
export function adaptiveMark(circleTileSvg) {
  const t = tile(circleTileSvg);
  const mid = ADAPTIVE.canvas / 2;
  const at = { from: t.centre, to: [mid, mid], k: ADAPTIVE.shown / t.size };
  const shapes = t.mark.map((s) => ({ fill: s.fill, subpaths: place(s.subpaths, at) }));
  const far = reach(shapes.flatMap((s) => s.subpaths), [mid, mid]);
  if (far > ADAPTIVE.safe / 2) throw new Error(`the mark reaches ${far.toFixed(1)}dp from the centre; a launcher mask keeps only ${ADAPTIVE.safe / 2}dp`);
  return { shapes, background: t.background.fill, reach: far };
}

/** The mark alone, centred on a square canvas at a given width. */
function centredMark(markSvg, canvas, width) {
  const shapes = parseSvg(markSvg);
  const box = bounds(shapes.flatMap((s) => s.subpaths));
  const at = { from: [box.cx, box.cy], to: [canvas / 2, canvas / 2], k: width / box.width };
  return shapes.map((s) => ({ fill: s.fill, subpaths: place(s.subpaths, at) }));
}

const xml = (body) => `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated by packages/native/scripts/brand.mjs from packages/design. Do not edit: it is rewritten on every cap sync. -->\n${body}\n`;

/** An Android vector drawable. `fill` overrides every shape's own colour (monochrome, status bar). */
export function vectorDrawable(shapes, canvas, fill = null) {
  const paths = shapes.map((s) => `    <path android:fillColor="${(fill ?? s.fill).toUpperCase()}" android:pathData="${toPathData(s.subpaths)}" />`).join("\n");
  return xml(`<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${canvas}dp"\n    android:height="${canvas}dp"\n    android:viewportWidth="${canvas}"\n    android:viewportHeight="${canvas}">\n${paths}\n</vector>`);
}

const ADAPTIVE_ICON = xml(`<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>`);

const colours = (pairs, lightBars = null) => xml(`<resources>\n${Object.entries(pairs).map(([k, v]) => `    <color name="${k}">${v.toUpperCase()}</color>`).join("\n")}${lightBars === null ? "" : `\n    <bool name="potyro_light_bars">${lightBars}</bool>`}\n</resources>`);

// The three themes Capacitor's template names (the manifest and BridgeActivity point at them), with
// the launch theme turned into the system splash and the window behind the WebView given the page's
// own colour. `AppTheme.NoActionBar` keeps the template's items.
const STYLES = xml(`<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">@color/potyro_bg</item>
        <item name="colorPrimaryDark">@color/potyro_bg</item>
        <item name="colorAccent">@color/potyro_accent</item>
        <item name="android:windowBackground">@color/potyro_bg</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/potyro_bg</item>
        <!-- The system bars are the page too (before Android 15 draws the app under them anyway):
             its colour, with dark icons by day and light ones by night. -->
        <item name="android:statusBarColor">@color/potyro_bg</item>
        <item name="android:navigationBarColor">@color/potyro_bg</item>
        <item name="android:windowLightStatusBar">@bool/potyro_light_bars</item>
        <item name="android:windowLightNavigationBar" tools:targetApi="27">@bool/potyro_light_bars</item>
    </style>

    <!-- The system splash (Android 12+; core-splashscreen draws the same on older ones): the page's
         background, the mark, then the app's theme with that same background. -->
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/potyro_bg</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/potyro_splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>`);

const polygonLayers = (shapes, k) => shapes.map((s) => ({ fill: s.fill, polygons: flatten(place(s.subpaths, { from: [0, 0], to: [0, 0], k })) }));

/** A tile file drawn `inner` wide in the middle of a `canvas`-wide square, `scale` pixels to the unit. */
function tilePng(svg, canvas, inner, scale) {
  const t = tile(svg);
  const px = Math.round(canvas * scale);
  const at = { from: t.centre, to: [canvas / 2, canvas / 2], k: inner / t.size };
  const shapes = [t.background, ...t.mark].map((s) => ({ fill: s.fill, subpaths: place(s.subpaths, at) }));
  return encodePng(paint(polygonLayers(shapes, px / canvas), px, px), px, px);
}

/**
 * Every resource this script owns, as `{ "path under res/": string | Buffer }`. Pure: the design
 * files in, the files out.
 */
export function brandResources(design) {
  const bg = token(design.tokens, "bg");
  const accent = token(design.tokens, "accent");
  const icon = adaptiveMark(design.circleTile);
  const files = {
    "values/ic_launcher_background.xml": colours({ ic_launcher_background: icon.background }),
    "values/potyro_brand.xml": colours({ potyro_bg: bg.light, potyro_accent: accent.light }, true),
    "values-night/potyro_brand.xml": colours({ potyro_bg: bg.dark, potyro_accent: accent.dark }, false),
    "values/styles.xml": STYLES,
    "mipmap-anydpi-v26/ic_launcher.xml": ADAPTIVE_ICON,
    "mipmap-anydpi-v26/ic_launcher_round.xml": ADAPTIVE_ICON,
    "drawable/ic_launcher_foreground.xml": vectorDrawable(icon.shapes, ADAPTIVE.canvas),
    "drawable/ic_launcher_monochrome.xml": vectorDrawable(icon.shapes, ADAPTIVE.canvas, "#ffffff"),
    "drawable/potyro_splash_icon.xml": vectorDrawable(centredMark(design.mark, SPLASH.canvas, SPLASH.markWidth), SPLASH.canvas),
    "drawable-night/potyro_splash_icon.xml": vectorDrawable(centredMark(design.markOnDark, SPLASH.canvas, SPLASH.markWidth), SPLASH.canvas),
    "drawable/ic_stat_potyro.xml": vectorDrawable(centredMark(design.mark, STAT.canvas, STAT.mark), STAT.canvas, "#ffffff"),
  };
  for (const [density, scale] of Object.entries(DENSITIES)) {
    files[`mipmap-${density}/ic_launcher.png`] = tilePng(design.squareTile, LEGACY.canvas, LEGACY.square, scale);
    files[`mipmap-${density}/ic_launcher_round.png`] = tilePng(design.circleTile, LEGACY.canvas, LEGACY.round, scale);
  }
  return files;
}

/**
 * What Capacitor's template leaves behind that would win over, or ship beside, the files above: its
 * own foreground (a `-v24` drawable beats `drawable/`), its background grid, the foreground PNGs and
 * the splash PNGs the launch theme no longer names. Pure: the paths under res/ in, the stale ones out.
 */
export function staleResources(paths) {
  return paths.filter((p) =>
    p === "drawable-v24/ic_launcher_foreground.xml" ||
    p === "drawable/ic_launcher_background.xml" ||
    /^mipmap-[a-z]+dpi\/ic_launcher_foreground\.png$/.test(p) ||
    /^drawable(-[a-z0-9-]+)?\/splash\.png$/.test(p));
}

/** The iOS app icon: the tile's colours edge to edge (iOS rounds the corners itself), with no alpha channel. */
export function iosIcon(design) {
  const t = tile(design.circleTile);
  const { size } = IOS_ICON;
  const k = size / t.size;
  const full = [{ fill: t.background.fill, polygons: [[[0, 0], [size, 0], [size, size], [0, size]]] }];
  const mark = t.mark.map((s) => ({ fill: s.fill, polygons: flatten(place(s.subpaths, { from: t.centre, to: [size / 2, size / 2], k })) }));
  return encodePng(paint([...full, ...mark], size, size), size, size, { alpha: false });
}

function listFiles(dir, base = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
}

// Running it (rather than importing it) brands the generated project(s).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const design = readDesign();
  const res = fileURLToPath(new URL("../android/app/src/main/res", import.meta.url));
  const iosIconSet = fileURLToPath(new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset", import.meta.url));
  const wantsIos = process.argv.includes("--ios");
  if (!wantsIos) {
    if (!existsSync(res)) {
      console.error(`[brand] ${res} not found — run \`pnpm cap:add:android\` first.`);
      process.exit(1);
    }
    const stale = staleResources(listFiles(res));
    for (const p of stale) rmSync(join(res, p));
    const files = brandResources(design);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(res, path)), { recursive: true });
      writeFileSync(join(res, path), content);
    }
    console.log(`[brand] icon and splash from packages/design: wrote ${Object.keys(files).length} resources, removed ${stale.length} of the template's.`);
  } else {
    // The generated iOS project takes ONE 1024px image (Contents.json names it); replace that file.
    const contents = join(iosIconSet, "Contents.json");
    if (!existsSync(contents)) {
      console.error(`[brand] ${iosIconSet} not found — run \`pnpm cap:add:ios\` first.`);
      process.exit(1);
    }
    const names = JSON.parse(readFileSync(contents, "utf8")).images.map((i) => i.filename).filter(Boolean);
    if (names.length !== 1) {
      console.error(`[brand] the iOS icon set names ${names.length} images, not the one this script knows how to make — left alone.`);
      process.exit(1);
    }
    writeFileSync(join(iosIconSet, names[0]), iosIcon(design));
    console.log(`[brand] iOS app icon → ${names[0]} (1024px, from packages/design).`);
  }
}
