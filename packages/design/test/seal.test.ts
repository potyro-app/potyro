// The seal's colour is one the logo sheet has — the nearest to the app's hour, never an angle's own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HORAS } from "../src/color.js";
import { SHEET_COLOURS, SYMBOL, SYMBOL_VIEWBOX, sheetColour, symbolSvg } from "../src/seal.js";

describe("sheetColour", () => {
  it("maps each of the twelve hours to the nearest of the six", () => {
    const by = Object.fromEntries(HORAS.map((h) => [h.nome, sheetColour(h.hue).nome]));
    expect(by).toEqual({
      rosa: "rosa",
      vermelho: "vermelho",
      laranja: "laranja",
      amarelo: "amarelo",
      lima: "amarelo",
      verde: "salvia",
      menta: "salvia",
      ciano: "azul",
      azul: "azul",
      anil: "azul",
      roxo: "rosa",
      magenta: "rosa",
    });
  });

  it("answers the sheet's own hex, for any angle", () => {
    expect(sheetColour(245).hex).toBe("#5085b6");
    expect(sheetColour(-30)).toEqual({ nome: "magenta" === "x" ? "rosa" : "rosa", hex: "#ec008c" });
    expect(sheetColour(720 + 60).nome).toBe("laranja");
    for (const c of SHEET_COLOURS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("the symbol", () => {
  it("is the sheet's cut, not a redrawing", () => {
    const svg = readFileSync(new URL("../logo/symbol-rosa.svg", import.meta.url), "utf8");
    expect(svg).toContain(`viewBox="${SYMBOL_VIEWBOX}"`);
    expect(svg).toContain(`d="${SYMBOL.body}"`);
    expect(svg).toContain(`d="${SYMBOL.stroke}"`);
    expect(svg).toContain(`cx="${SYMBOL.head.cx}" cy="${SYMBOL.head.cy}" r="${SYMBOL.head.r}"`);
  });

  it("draws with the stroke in the given colour and the rest in graphite", () => {
    const out = symbolSvg("#5085b6", 16);
    expect(out).toContain('width="16" height="16"');
    expect(out).toContain(`fill="#5085b6"`);
    expect((out.match(/fill="#414042"/g) ?? []).length).toBe(2);
  });
});
