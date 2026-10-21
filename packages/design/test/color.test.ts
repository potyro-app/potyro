// The TypeScript port of the designer's potyro-color.js must produce the designer's own table: the
// twelve hours as source/potyro-tokens.css carries them, light and dark, every level and the
// category colours. If the designer changes a parameter, the table changes and this says so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HORAS, categorias, contrast, cor, hexToHue, horaMaisProxima, resolveHue, vars, varsBoth } from "../src/color.js";

const tokens = readFileSync(new URL("../source/potyro-tokens.css", import.meta.url), "utf8");

/** `--a: x; --b: y;` → { "--a": "x", "--b": "y" } */
const declarations = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

/** The one-line block for a selector, as the designer's file writes them. */
function block(selector: string): Record<string, string> {
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = tokens.match(re);
  if (!m) throw new Error(`no block for ${selector}`);
  return declarations(m[1]!);
}

const LEVELS = ["--hue", "--traco", "--tinta", "--aguada", "--accent", "--on-accent", "--focus"];
const pick = (d: Record<string, string>) => Object.fromEntries(LEVELS.map((k) => [k, d[k]]));

describe("the twelve hours are exactly the designer's table", () => {
  for (const h of HORAS) {
    it(`${h.hora}h ${h.nome}, light`, () => {
      const expected = h.nome === "rosa" ? pick(block(":root")) : block(`[data-traco="${h.nome}"]`);
      expect(vars(cor(h.nome), "light")).toEqual(expected);
    });
    it(`${h.hora}h ${h.nome}, dark`, () => {
      const expected = h.nome === "rosa" ? pick(block(':root[data-theme="dark"]')) : block(`:root[data-theme="dark"][data-traco="${h.nome}"]`);
      expect(vars(cor(h.nome), "dark")).toEqual(expected);
    });
  }

  it("the category colours are the hours' levels", () => {
    const light = block(":root");
    const dark = block(':root[data-theme="dark"]');
    for (const h of HORAS.filter((h) => h.hora !== 12)) {
      const c = cor(h.nome);
      expect(light[`--cat-${h.nome}`]).toBe(c.light.tinta);
      expect(light[`--cat-${h.nome}-fill`]).toBe(c.light.traco);
      expect(light[`--cat-${h.nome}-soft`]).toBe(c.light.aguada);
      expect(dark[`--cat-${h.nome}`]).toBe(c.dark.tinta);
      expect(dark[`--cat-${h.nome}-soft`]).toBe(c.dark.aguada);
    }
  });
});

describe("the system's guarantees hold for any angle", () => {
  const angles = Array.from({ length: 72 }, (_, i) => i * 5);
  it("tinta reads as text on the background and on surface, in both themes", () => {
    for (const a of angles) {
      const c = cor(a);
      expect(contrast(c.light.tinta, "#ffffff"), `light ${a}`).toBeGreaterThanOrEqual(5);
      expect(contrast(c.light.tinta, "#f3f3f4"), `light surface ${a}`).toBeGreaterThanOrEqual(4.6);
      expect(contrast(c.dark.tinta, "#1c1b1c"), `dark ${a}`).toBeGreaterThanOrEqual(5);
      expect(contrast(c.dark.tinta, "#2a2829"), `dark surface ${a}`).toBeGreaterThanOrEqual(4.6);
    }
  });
  it("a button's text reads on it", () => {
    for (const a of angles) {
      const c = cor(a);
      expect(contrast(c.light.accent, c.light.onAccent), `light ${a}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.dark.accent, c.dark.onAccent), `dark ${a}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the traço is the same in both themes", () => {
    for (const a of angles) expect(cor(a).dark.traco).toBe(cor(a).light.traco);
  });
});

describe("resolving a colour", () => {
  it("keeps only the hue of a hex", () => {
    expect(horaMaisProxima(hexToHue("#e44f89"))).toBe(12);
    expect(horaMaisProxima(hexToHue("#f69536"))).toBe(2);
    expect(cor("#1e74a6").hora).toBe(8);
  });
  it("accepts an angle, an hour's name or number", () => {
    expect(resolveHue(-30)).toBe(330);
    expect(resolveHue(390)).toBe(30);
    expect(resolveHue("laranja")).toBe(60);
    expect(resolveHue("2")).toBe(60);
    expect(() => resolveHue("neon")).toThrow(/Cor desconhecida/);
  });
  it("walks the clock five hours at a time for categories, skipping Potyro's own", () => {
    expect(categorias("verde", 5)).toEqual(["verde", "roxo", "amarelo", "azul", "vermelho"]);
    expect(categorias("magenta", 6)).toEqual(["magenta", "lima", "anil", "laranja", "ciano", "verde"]);
    expect(categorias("rosa", 3)).toEqual(["verde", "roxo", "amarelo"]);
  });
  it("gives both themes' values as pairs, with one traço", () => {
    const v = varsBoth(cor("azul"));
    expect(v["--traco"]).toBe("#37adf3");
    expect(v["--tinta-l"]).toBe("#1e74a6");
    expect(v["--tinta-d"]).toBe("#4db5f7");
    expect(v["--on-accent-l"]).toBe("#231f20");
    expect(v["--on-accent-d"]).toBe("#1c1b1c");
  });
});
