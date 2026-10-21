// TEMPORARY — cuts the designer's logo sheet (potyro-logo.svg, an Illustrator export of every
// variation on one canvas) into one standalone SVG per variation. Run from inside the repo so
// Playwright resolves:  node scripts/_logo-split.mjs <sheet.svg> <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [sheet, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// Give every leaf element an id in document order so the browser can report its box and fill.
let n = 0;
const src = readFileSync(sheet, "utf8").replace(/<(rect|circle|path)\b/g, (m, tag) => `<${tag} id="e${n++}"`);

// The sheet's layout, by eye and by `inkscape --query-all`. A region names the variation; an
// element belongs to the region its centre falls in. The two big grey rects behind the middle
// column and the wide white wordmark are the sheet's own backgrounds and are dropped.
const rows = [
  ["rosa", 8, 50], ["vermelho", 68, 110], ["laranja", 128, 170],
  ["amarelo", 187, 229], ["salvia", 242, 284], ["azul", 302, 344],
];
const regions = [];
for (const [name, y0, y1] of rows) {
  regions.push({ name: `wordmark-${name}`, x0: 0, y0, x1: 140, y1 });
  regions.push({ name: `wordmark-${name}-on-dark`, x0: 180, y0, x1: 320, y1 });
}
regions.push(
  { name: "wordmark-mono", x0: 390, y0: 8, x1: 535, y1: 50 },
  { name: "wordmark-mono-on-dark", x0: 395, y0: 78, x1: 535, y1: 134 },
  { name: "symbol-circle-dark", x0: 375, y0: 174, x1: 442, y1: 241 },
  { name: "symbol-square-dark", x0: 451, y0: 174, x1: 518, y1: 241 },
  { name: "symbol-circle-light", x0: 375, y0: 252, x1: 442, y1: 320 },
  { name: "symbol-square-light", x0: 451, y0: 252, x1: 518, y1: 320 },
  { name: "wordmark-large", x0: 136, y0: 422, x1: 372, y1: 514 },
  { name: "tagline", x0: 168, y0: 515, x1: 330, y1: 534 },
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><body style="margin:0">${src}</body>`);
const items = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("rect, circle, path")) {
    const b = el.getBBox();
    const fill = getComputedStyle(el).fill;
    const clone = el.cloneNode(true);
    clone.removeAttribute("class");
    clone.removeAttribute("id");
    clone.setAttribute("fill", fill);
    out.push({ id: el.id, tag: el.tagName, x: b.x, y: b.y, w: b.width, h: b.height, fill, html: clone.outerHTML });
  }
  return out;
});
await browser.close();

const rgbToHex = (s) => {
  const m = s.match(/\d+/g);
  return m ? "#" + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("") : s;
};
const isSheetBackground = (it) => it.tag === "rect" && it.w > 150;

const files = new Map();
for (const it of items) {
  if (isSheetBackground(it)) continue;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const r = regions.find((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
  if (!r) { console.warn("unplaced", it.id, it.tag, it.x.toFixed(1), it.y.toFixed(1), it.w.toFixed(1), it.h.toFixed(1)); continue; }
  if (!files.has(r.name)) files.set(r.name, []);
  files.get(r.name).push({ ...it, html: it.html.replace(/fill="[^"]*"/, `fill="${rgbToHex(it.fill)}"`) });
}

// The bare symbol: the "y" of the light tiles without the tile, and of the dark tiles without theirs.
const bare = (from, name) => {
  const els = files.get(from)?.filter((it) => !(it.tag !== "path" && it.w > 40));
  if (els?.length) files.set(name, els);
};
bare("symbol-circle-light", "symbol-rosa");
bare("symbol-circle-dark", "symbol-rosa-on-dark");

for (const [name, els] of files) {
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.w)), y1 = Math.max(...els.map((e) => e.y + e.h));
  const f = (v) => Math.round(v * 1000) / 1000;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}">\n${els.map((e) => "  " + e.html).join("\n")}\n</svg>\n`;
  writeFileSync(join(out, `${name}.svg`), svg);
  const fills = [...new Set(els.map((e) => rgbToHex(e.fill)))].join(" ");
  console.log(name.padEnd(28), String(els.length).padStart(3), "els", `${f(x1 - x0)}×${f(y1 - y0)}`, fills);
}
