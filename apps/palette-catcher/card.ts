// The share card: the photo, its palette as paint-chip columns with each hex written on its own
// colour, and the palette's name — 1080 × 1350, the 4:5 a phone's photo apps show whole. Always on
// warm paper, whatever theme the app is in, so a card looks the same wherever it is sent.
import { inkOn, type RGB } from "./palette.js";

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardChip {
  rgb: RGB;
  hex: string;
}

export interface CardSpec {
  /** The photo, or none: a palette typed in by hand fills the frame with its own colours. */
  photo: CanvasImageSource | null;
  photoW: number;
  photoH: number;
  chips: CardChip[];
  name: string;
  /** "6 colours · Palette Catcher" */
  footer: string;
  fontDisplay: string;
  fontUi: string;
  fontMono: string;
}

const PAPER = "#f6f1e7";
const INK = "#2a241f";
const INK_SOFT = "#7a6f64";
const M = 64;

const css = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`;

/** Shrink `font`'s size until `text` fits `max` pixels. */
function fit(g: CanvasRenderingContext2D, text: string, weight: string, size: number, family: string, max: number): number {
  let s = size;
  for (; s > 24; s -= 2) {
    g.font = `${weight} ${s}px ${family}`;
    if (g.measureText(text).width <= max) break;
  }
  return s;
}

export function drawCard(g: CanvasRenderingContext2D, spec: CardSpec): void {
  const W = CARD_W;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, CARD_H);

  // The photo, cover-cropped into its frame.
  const fw = W - 2 * M;
  const fh = 720;
  const want = fw / fh;
  const { photoW: pw, photoH: ph } = spec;
  const crop = pw / ph > want ? { x: (pw - ph * want) / 2, y: 0, w: ph * want, h: ph } : { x: 0, y: (ph - pw / want) / 2, w: pw, h: pw / want };
  g.save();
  g.beginPath();
  g.roundRect(M, M, fw, fh, 28);
  g.clip();
  if (spec.photo) g.drawImage(spec.photo, crop.x, crop.y, crop.w, crop.h, M, M, fw, fh);
  else
    spec.chips.forEach((c, i, all) => {
      g.fillStyle = css(c.rgb);
      g.fillRect(Math.floor(M + (i * fw) / all.length), M, Math.ceil(fw / all.length) + 1, fh);
    });
  g.restore();

  // The chips, side by side as one strip, each hex up its own column in a colour that reads on it.
  const top = M + fh + 28;
  const sh = 330;
  const n = Math.max(1, spec.chips.length);
  const cw = fw / n;
  g.save();
  g.beginPath();
  g.roundRect(M, top, fw, sh, 28);
  g.clip();
  spec.chips.forEach((c, i) => {
    const x = M + i * cw;
    g.fillStyle = css(c.rgb);
    g.fillRect(Math.floor(x), top, Math.ceil(cw) + 1, sh);
    g.save();
    g.translate(x + cw / 2, top + sh - 26);
    g.rotate(-Math.PI / 2);
    g.fillStyle = css(inkOn(c.rgb).ink);
    g.font = `600 ${Math.min(34, Math.max(24, cw * 0.27))}px ${spec.fontMono}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(c.hex.toUpperCase(), 0, 0);
    g.restore();
  });
  g.restore();

  // The name, and what the card is.
  g.fillStyle = INK;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const size = fit(g, spec.name, "600", 62, spec.fontDisplay, fw);
  g.font = `600 ${size}px ${spec.fontDisplay}`;
  g.fillText(spec.name, M, top + sh + 88);
  g.fillStyle = INK_SOFT;
  g.font = `500 26px ${spec.fontUi}`;
  g.fillText(spec.footer, M, top + sh + 132);
}
