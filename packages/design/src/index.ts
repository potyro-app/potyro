// @potyro/design — the design system as code. The rules are in DESIGN.md and REDACAO.md (the
// designer's own files, kept verbatim under source/); the values are tokens.css; this is the
// colour clock, for the places that need a colour from an angle at runtime.
export * from "./color.js";
export { SHEET_COLOURS, SYMBOL, SYMBOL_VIEWBOX, SYMBOL_GRAPHITE, sheetColour, symbolSvg, type SheetColour } from "./seal.js";
export { LUCIDE_NAME, isLucideName, lucideReady, lucideLoaded, lucidePath, lucideKnown, onLucide, primeLucide } from "./lucide.js";
