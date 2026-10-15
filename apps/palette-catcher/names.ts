// What to call a colour and a palette, in the person's language: "Honey", "Midnight", and a palette
// of them "Honey & Midnight". A colour's word comes from its OKLCH hue, with a dark and a light word
// for each of twelve hue families, and four words for the near-greys. A palette's name pairs its
// biggest colour with its most vivid other one; the person can change it before saving.
import type { Ctx, Words } from "potyro";
import { oklch, type Lab, type Swatch } from "./palette.js";

export type Say = Pick<Ctx, "t">;

type Pair = readonly [dark: Words, light: Words];

/** Hue families by their upper OKLCH hue bound, in degrees. */
const HUES: ReadonlyArray<readonly [number, Pair]> = [
  [20, [{ en: "Wine", "pt-BR": "Vinho", de: "Weinrot", es: "Vino", pl: "Wino", it: "Vino" }, { en: "Rose", "pt-BR": "Rosa", de: "Rose", es: "Rosa", pl: "Róża", it: "Rosa" }]],
  [45, [{ en: "Garnet", "pt-BR": "Grená", de: "Granat", es: "Granate", pl: "Granat", it: "Granato" }, { en: "Coral", "pt-BR": "Coral", de: "Koralle", es: "Coral", pl: "Koral", it: "Corallo" }]],
  [70, [{ en: "Rust", "pt-BR": "Ferrugem", de: "Rost", es: "Óxido", pl: "Rdza", it: "Ruggine" }, { en: "Apricot", "pt-BR": "Damasco", de: "Aprikose", es: "Albaricoque", pl: "Morela", it: "Albicocca" }]],
  [95, [{ en: "Bronze", "pt-BR": "Bronze", de: "Bronze", es: "Bronce", pl: "Brąz", it: "Bronzo" }, { en: "Honey", "pt-BR": "Mel", de: "Honig", es: "Miel", pl: "Miód", it: "Miele" }]],
  [115, [{ en: "Mustard", "pt-BR": "Mostarda", de: "Senf", es: "Mostaza", pl: "Musztarda", it: "Senape" }, { en: "Lemon", "pt-BR": "Limão", de: "Zitrone", es: "Limón", pl: "Cytryna", it: "Limone" }]],
  [150, [{ en: "Olive", "pt-BR": "Oliva", de: "Olive", es: "Oliva", pl: "Oliwka", it: "Oliva" }, { en: "Pistachio", "pt-BR": "Pistache", de: "Pistazie", es: "Pistacho", pl: "Pistacja", it: "Pistacchio" }]],
  [180, [{ en: "Forest", "pt-BR": "Floresta", de: "Wald", es: "Bosque", pl: "Las", it: "Bosco" }, { en: "Mint", "pt-BR": "Menta", de: "Minze", es: "Menta", pl: "Mięta", it: "Menta" }]],
  [215, [{ en: "Spruce", "pt-BR": "Abeto", de: "Fichte", es: "Abeto", pl: "Świerk", it: "Abete" }, { en: "Lagoon", "pt-BR": "Lagoa", de: "Lagune", es: "Laguna", pl: "Laguna", it: "Laguna" }]],
  [272, [{ en: "Midnight", "pt-BR": "Meia-noite", de: "Mitternacht", es: "Medianoche", pl: "Północ", it: "Mezzanotte" }, { en: "Sky", "pt-BR": "Céu", de: "Himmel", es: "Cielo", pl: "Niebo", it: "Cielo" }]],
  [298, [{ en: "Indigo", "pt-BR": "Índigo", de: "Indigo", es: "Índigo", pl: "Indygo", it: "Indaco" }, { en: "Bluebell", "pt-BR": "Campânula", de: "Glockenblume", es: "Campanilla", pl: "Dzwonek", it: "Campanula" }]],
  [328, [{ en: "Plum", "pt-BR": "Ameixa", de: "Pflaume", es: "Ciruela", pl: "Śliwka", it: "Prugna" }, { en: "Lavender", "pt-BR": "Lavanda", de: "Lavendel", es: "Lavanda", pl: "Lawenda", it: "Lavanda" }]],
  [352, [{ en: "Mulberry", "pt-BR": "Amora", de: "Maulbeere", es: "Mora", pl: "Morwa", it: "Mora" }, { en: "Orchid", "pt-BR": "Orquídea", de: "Orchidee", es: "Orquídea", pl: "Storczyk", it: "Orchidea" }]],
  [361, [{ en: "Wine", "pt-BR": "Vinho", de: "Weinrot", es: "Vino", pl: "Wino", it: "Vino" }, { en: "Rose", "pt-BR": "Rosa", de: "Rose", es: "Rosa", pl: "Róża", it: "Rosa" }]],
];

/** Near-greys, by their upper lightness bound. */
const GREYS: ReadonlyArray<readonly [number, Words]> = [
  [0.32, { en: "Charcoal", "pt-BR": "Carvão", de: "Kohle", es: "Carbón", pl: "Węgiel", it: "Carbone" }],
  [0.58, { en: "Slate", "pt-BR": "Ardósia", de: "Schiefer", es: "Pizarra", pl: "Łupek", it: "Ardesia" }],
  [0.84, { en: "Stone", "pt-BR": "Pedra", de: "Stein", es: "Piedra", pl: "Kamień", it: "Pietra" }],
  [2, { en: "Chalk", "pt-BR": "Giz", de: "Kreide", es: "Tiza", pl: "Kreda", it: "Gesso" }],
];

/** Below this OKLCH chroma a colour reads as a grey (a warm or cool one, but a grey). */
export const GREY_CHROMA = 0.035;

/** The word for a colour: "Honey", "Midnight", "Chalk". */
export function colorWords(lab: Lab): Words {
  const { l, c, h } = oklch(lab);
  if (c < GREY_CHROMA) return GREYS.find(([top]) => l < top)![1];
  const pair = HUES.find(([top]) => h < top)![1];
  return l < 0.6 ? pair[0] : pair[1];
}

export const colorName = (lab: Lab, say: Say): string => say.t(colorWords(lab));

const SHADE = {
  dark: { en: "dark shade", "pt-BR": "tom escuro", de: "dunkler Ton", es: "tono oscuro", pl: "ciemny odcień", it: "tono scuro" },
  mid: { en: "mid shade", "pt-BR": "tom médio", de: "mittlerer Ton", es: "tono medio", pl: "średni odcień", it: "tono medio" },
  light: { en: "light shade", "pt-BR": "tom claro", de: "heller Ton", es: "tono claro", pl: "jasny odcień", it: "tono chiaro" },
} satisfies Record<string, Words>;

/**
 * Names for every colour of a palette, told apart: two greens that are both "Olive" become
 * "Olive · dark shade" and "Olive · light shade", so a list never shows the same name twice for two
 * different colours.
 */
export function colorNames(labs: Lab[], say: Say): string[] {
  const base = labs.map((l) => colorName(l, say));
  return base.map((name, i) => {
    const same = labs.map((l, j) => ({ l: l[0], j })).filter(({ j }) => base[j] === name);
    if (same.length < 2) return name;
    const order = [...same].sort((a, b) => a.l - b.l).findIndex(({ j }) => j === i);
    const which = order === 0 ? SHADE.dark : order === same.length - 1 ? SHADE.light : SHADE.mid;
    return `${name} · ${say.t(which)}`;
  });
}

/**
 * A palette's name: its biggest colour and the most vivid of the others, "Honey & Midnight". One word
 * when they would say the same; a numeral when the name is taken ("Honey & Midnight II").
 */
export function paletteName(swatches: Swatch[], say: Say, taken: Iterable<string> = []): string {
  const found = swatches.filter((s) => !s.derived);
  const pool = found.length ? found : swatches;
  if (!pool.length) return say.t({ en: "Palette", "pt-BR": "Paleta", de: "Palette", es: "Paleta", pl: "Paleta", it: "Palette" });
  const first = [...pool].sort((a, b) => b.weight - a.weight)[0]!;
  const a = colorName(first.lab, say);
  const rest = swatches.filter((s) => s !== first && colorName(s.lab, say) !== a);
  const vivid = rest.sort((x, y) => oklch(y.lab).c - oklch(x.lab).c)[0];
  const base = vivid ? `${a} & ${colorName(vivid.lab, say)}` : a;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const ROMAN = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  for (const r of ROMAN) if (!used.has(`${base} ${r}`)) return `${base} ${r}`;
  let n = 11;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A file name from a palette's name: "honey-midnight-20261015-0930". */
export function slug(name: string, when: Date): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "palette";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  return `${base}-${stamp}`;
}
