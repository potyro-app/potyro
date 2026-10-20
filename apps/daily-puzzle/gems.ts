// The seven gems: a colour and a shape each, so a gem is never told apart by hue alone. No green and
// no yellow among them — those two are the marks, and a gem must never look like a verdict.

/** In puzzle order: colour 0 is the first, and the codes in puzzle.ts index into this. */
export const GEMS = [
  { colour: "oklch(60% 0.2 22)", shape: "circle" }, // ruby
  { colour: "oklch(70% 0.18 52)", shape: "triangle" }, // tangerine
  { colour: "oklch(50% 0.08 50)", shape: "square" }, // cocoa
  { colour: "oklch(72% 0.13 225)", shape: "diamond" }, // sky
  { colour: "oklch(50% 0.2 265)", shape: "star" }, // cobalt
  { colour: "oklch(57% 0.2 305)", shape: "plus" }, // violet
  { colour: "oklch(68% 0.19 350)", shape: "heart" }, // rose
] as const;

const SHAPES: Record<(typeof GEMS)[number]["shape"], string> = {
  circle: '<circle cx="12" cy="12" r="7"/>',
  triangle: '<path d="M12 4.5 20 19H4z"/>',
  square: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  diamond: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
  star: '<path d="m12 3.2 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8l-5.4 2.9 1.2-6L3.3 9.5l6.1-.7z"/>',
  plus: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10C19.5 15.4 12 20 12 20z"/>',
};

const SVG = "http://www.w3.org/2000/svg";

/** A gem as an element: the colour with a highlight and its shape inside. Decorative; the caller names it. */
export function gemElement(colour: number): HTMLElement {
  const g = GEMS[colour]!;
  const el = document.createElement("span");
  el.className = "dp-gem";
  el.style.setProperty("--gem", g.colour);
  el.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Static, known markup from this module — never anything a person or a record wrote.
  svg.innerHTML = SHAPES[g.shape];
  el.append(svg);
  return el;
}
