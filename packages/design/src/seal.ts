// The "Feito com Potyro" seal (DESIGN.md §6, §8.1): the logo's symbol — the "y", a person with the
// arms up — with its one coloured stroke in the app's colour, beside the words. The logo's colours
// predate the clock (§4.1: never repainted by hand), so the stroke takes the NEAREST colour the
// logo sheet has: rosa, vermelho, laranja, amarelo, sálvia or azul — never an angle's own colour.
// The paths are the sheet's `symbol` cut (logo/symbol-rosa.svg), in its own box, so the seal, a
// favicon and a share image draw the same person.

/** The six colours the logo sheet carries, by name, with the clock angle each one sits nearest. */
export const SHEET_COLOURS: readonly { nome: SheetColour; hex: string; hue: number }[] = [
  { nome: "rosa", hex: "#ec008c", hue: 0 },
  { nome: "vermelho", hex: "#ed1c24", hue: 30 },
  { nome: "laranja", hex: "#f58337", hue: 60 },
  { nome: "amarelo", hex: "#ffcf5b", hue: 90 },
  { nome: "salvia", hex: "#85ab8f", hue: 150 },
  { nome: "azul", hex: "#5085b6", hue: 240 },
];

export type SheetColour = "rosa" | "vermelho" | "laranja" | "amarelo" | "salvia" | "azul";

/** The sheet colour nearest an angle on the clock (ties go to the one listed first). */
export function sheetColour(hue: number): { nome: SheetColour; hex: string } {
  const h = ((hue % 360) + 360) % 360;
  let best = SHEET_COLOURS[0]!;
  let bestD = Infinity;
  for (const c of SHEET_COLOURS) {
    const d = Math.min(Math.abs(h - c.hue), 360 - Math.abs(h - c.hue));
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return { nome: best.nome, hex: best.hex };
}

/** The symbol's box on the sheet (logo/symbol-rosa.svg). */
export const SYMBOL_VIEWBOX = "392.697 273.684 32.825 30.716";
export const SYMBOL_GRAPHITE = "#414042";

/** The symbol's three shapes: the left arm and body (graphite), the coloured right arm, the head. */
export const SYMBOL = {
  body: "M407.62,288.12c-.2-.23-.39-.46-.61-.68-3.29-3.38-7.17-5.49-7.37-10.57-.16-4.23-7.1-4.25-6.94,0,.18,4.78,2.05,8.41,5.57,11.76,2.48,2.35,4.57,4.27,5.88,6.72.7-2.66,1.85-5.05,3.46-7.22h0Z",
  stroke: "M418.58,276.87c-.19,5.09-4.07,7.18-7.37,10.57-3.81,3.92-5.41,8.47-5.57,13.78-.13,4.24,6.81,4.24,6.94,0,.18-6.01,3.23-8.67,7.37-12.6,3.51-3.33,5.39-6.99,5.57-11.76.16-4.24-6.78-4.23-6.94,0h0Z",
  head: { cx: 409.16, cy: 278.4, r: 4.71 },
} as const;

/** The symbol as SVG markup, its stroke in the given colour and the rest in graphite (or `ink`). */
export function symbolSvg(strokeHex: string, size: number, ink = SYMBOL_GRAPHITE): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SYMBOL_VIEWBOX}" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${SYMBOL.body}" fill="${ink}"/><path d="${SYMBOL.stroke}" fill="${strokeHex}"/>` +
    `<circle cx="${SYMBOL.head.cx}" cy="${SYMBOL.head.cy}" r="${SYMBOL.head.r}" fill="${ink}"/></svg>`
  );
}
