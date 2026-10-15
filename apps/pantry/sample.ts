// The sample shelf: what "Try it on a sample photo" shows and reads, with no key and no AI.
//
// Drawn here as an SVG rather than shipped as a photo, for its dates: a sample printed with fixed
// dates would say "expired" for most of its life. This one's packs carry dates counted from today,
// in the person's own words for the month, and the answer it "reads" (`sampleReading`) is made from
// the same dates — exactly what the AI would have read off it. It says SAMPLE across its top. Three
// things have a printed date and three do not, so the guesses show too.

import type { Words } from "potyro";
import { addDays, startOfDay, type Category } from "./shelf-life.js";
import type { ShelfAnswer } from "./reading.js";
import type { Say } from "./words.js";

interface SampleThing {
  name: Words;
  category: Category;
  /** Days from today to the date printed on it; none when nothing is printed. */
  printed?: number;
  /** "best before" or "use by", as the pack says. */
  stamp?: "best" | "use";
  amount?: string;
}

const THINGS = {
  milk: { name: { en: "Milk", "pt-BR": "Leite", de: "Milch", es: "Leche", pl: "Mleko", it: "Latte" }, category: "dairy", printed: 3, stamp: "best", amount: "1 L" },
  yogurt: {
    name: { en: "Greek yogurt", "pt-BR": "Iogurte grego", de: "Griechischer Joghurt", es: "Yogur griego", pl: "Jogurt grecki", it: "Yogurt greco" },
    category: "dairy",
    printed: 9,
    stamp: "best",
    amount: "×4",
  },
  cheese: { name: { en: "Cheddar", "pt-BR": "Queijo cheddar", de: "Cheddar", es: "Queso cheddar", pl: "Ser cheddar", it: "Cheddar" }, category: "dairy", printed: 24, stamp: "best" },
  chicken: {
    name: { en: "Chicken thighs", "pt-BR": "Sobrecoxa de frango", de: "Hähnchenschenkel", es: "Contramuslos de pollo", pl: "Udka z kurczaka", it: "Sovracosce di pollo" },
    category: "meat",
    printed: 1,
    stamp: "use",
    amount: "500 g",
  },
  spinach: { name: { en: "Spinach", "pt-BR": "Espinafre", de: "Spinat", es: "Espinacas", pl: "Szpinak", it: "Spinaci" }, category: "produce" },
  tomatoes: { name: { en: "Tomatoes", "pt-BR": "Tomates", de: "Tomaten", es: "Tomates", pl: "Pomidory", it: "Pomodori" }, category: "produce", amount: "×6" },
} satisfies Record<string, SampleThing>;

export type SampleKey = keyof typeof THINGS;
const ORDER: SampleKey[] = ["chicken", "milk", "spinach", "tomatoes", "yogurt", "cheese"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A sample item's name in the person's language — what the sample "reads" and what is saved. */
export const sampleName = (key: SampleKey, say: Say): string => say.t(THINGS[key].name);

/** What the AI reads off the sample — the fixture answer, made from the same dates as the picture. */
export function sampleReading(today: Date, say: Say): ShelfAnswer {
  return {
    kind: "food",
    boughtOn: null,
    items: ORDER.map((key) => {
      const t: SampleThing = THINGS[key];
      return {
        name: sampleName(key, say),
        category: t.category,
        where: "fridge" as const,
        bestBefore: t.printed === undefined ? null : iso(addDays(startOfDay(today), t.printed)),
        amount: t.amount ?? null,
      };
    }),
  };
}

const SAMPLE = { en: "SAMPLE PHOTO", "pt-BR": "FOTO DE EXEMPLO", de: "BEISPIELFOTO", es: "FOTO DE EJEMPLO", pl: "PRZYKŁADOWE ZDJĘCIE", it: "FOTO DI ESEMPIO" };
const BEST = { en: "BEST BEFORE", "pt-BR": "CONSUMIR ATÉ", de: "MHD", es: "CONSUMIR ANTES", pl: "NAJLEPIEJ PRZED", it: "DA CONSUMARSI ENTRO" };
const USE = { en: "USE BY", "pt-BR": "VALIDADE", de: "VERBRAUCHEN BIS", es: "CADUCIDAD", pl: "SPOŻYĆ DO", it: "CONSUMARE ENTRO" };

/** The fridge shelf, 800 × 1000, as SVG text. Every word in it is escaped: it carries the person's own words. */
export function sampleShelfSvg(today: Date, say: Say): string {
  const t = (s: string) => escapeXml(s);
  const date = (key: SampleKey) => {
    const thing: SampleThing = THINGS[key];
    return thing.printed === undefined ? "" : say.format.date(addDays(startOfDay(today), thing.printed), { day: "numeric", month: "short" }).replace(/\.$/, "").toUpperCase();
  };
  const stamp = (key: SampleKey) => t(say.t((THINGS[key] as SampleThing).stamp === "use" ? USE : BEST));
  const name = (key: SampleKey) => t(sampleName(key, say).toUpperCase());
  const label = (x: number, y: number, w: number, key: SampleKey, size = 22) =>
    `<text x="${x + w / 2}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#1d2a3a">${name(key)}</text>`;
  const dateStamp = (x: number, y: number, key: SampleKey) =>
    `<g transform="translate(${x} ${y})"><rect x="-4" y="-22" width="150" height="48" rx="6" fill="#fffdf6" stroke="#1d2a3a" stroke-width="2"/><text x="71" y="-6" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="#1d2a3a">${stamp(key)}</text><text x="71" y="18" text-anchor="middle" font-family="'Courier New', monospace" font-size="22" font-weight="700" fill="#1d2a3a">${t(date(key))}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<defs>
  <linearGradient id="inside" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef6fb"/><stop offset="1" stop-color="#cfe3ef"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#9cc3d8" stop-opacity="0.7"/></linearGradient>
</defs>
<rect width="800" height="1000" fill="url(#inside)"/>
<rect x="0" y="0" width="800" height="64" fill="#1d2a3a"/>
<text x="400" y="43" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="8" fill="#ffd36e">${t(say.t(SAMPLE))}</text>
<!-- top shelf: milk, yogurt, cheese -->
<g>
  <path d="M70 200 L130 150 L190 200 Z" fill="#dfe9f2" stroke="#1d2a3a" stroke-width="3"/>
  <rect x="70" y="200" width="120" height="300" rx="6" fill="#ffffff" stroke="#1d2a3a" stroke-width="3"/>
  <rect x="70" y="260" width="120" height="70" fill="#4f8fd6"/>
  ${label(70, 305, 120, "milk", 24).replace('fill="#1d2a3a"', 'fill="#ffffff"')}
  ${dateStamp(55, 440, "milk")}
</g>
<g>
  ${[0, 1, 2, 3]
    .map((i) => {
      const x = 250 + (i % 2) * 110;
      const y = i < 2 ? 330 : 420;
      return `<path d="M${x} ${y} L${x + 90} ${y} L${x + 80} ${y + 80} L${x + 10} ${y + 80} Z" fill="#f7f4ee" stroke="#1d2a3a" stroke-width="3"/><rect x="${x - 4}" y="${y - 12}" width="98" height="14" rx="4" fill="#7bb661" stroke="#1d2a3a" stroke-width="2"/>`;
    })
    .join("")}
  ${label(250, 320, 200, "yogurt", 20)}
  ${dateStamp(278, 225, "yogurt")}
</g>
<g>
  <path d="M520 500 L740 500 L740 400 L560 360 Z" fill="#f4c542" stroke="#1d2a3a" stroke-width="3"/>
  <circle cx="610" cy="450" r="12" fill="#e2ad2a"/><circle cx="680" cy="470" r="9" fill="#e2ad2a"/><circle cx="650" cy="420" r="7" fill="#e2ad2a"/>
  ${label(520, 345, 220, "cheese", 22)}
  ${dateStamp(560, 260, "cheese")}
</g>
<rect x="30" y="500" width="740" height="22" fill="url(#glass)" stroke="#8fb3c8" stroke-width="2"/>
<!-- bottom shelf: chicken, spinach, tomatoes -->
<g>
  <rect x="60" y="740" width="260" height="150" rx="14" fill="#2f3b4a" stroke="#1d2a3a" stroke-width="3"/>
  <ellipse cx="140" cy="805" rx="60" ry="38" fill="#f1b7a6"/><ellipse cx="240" cy="815" rx="58" ry="36" fill="#eaa794"/>
  <rect x="60" y="740" width="260" height="150" rx="14" fill="#ffffff" fill-opacity="0.25"/>
  ${label(60, 720, 260, "chicken", 22)}
  ${dateStamp(116, 860, "chicken")}
</g>
<g>
  <path d="M380 900 L360 660 Q450 620 540 660 L520 900 Z" fill="#3f8f4f" stroke="#1d2a3a" stroke-width="3"/>
  <path d="M400 760 q50 -60 100 0 q-50 40 -100 0 Z" fill="#69b86b"/><path d="M410 840 q40 -50 80 0 q-40 34 -80 0 Z" fill="#69b86b"/>
  ${label(360, 640, 180, "spinach", 22)}
</g>
<g>
  ${[
    [610, 830],
    [680, 830],
    [645, 780],
    [715, 780],
    [575, 780],
    [645, 870],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="36" fill="#e2482f" stroke="#1d2a3a" stroke-width="3"/><path d="M${x! - 10} ${y! - 34} l10 8 l10 -8" stroke="#3f8f4f" stroke-width="5" fill="none"/>`)
    .join("")}
  ${label(560, 720, 200, "tomatoes", 22)}
</g>
<rect x="30" y="900" width="740" height="22" fill="url(#glass)" stroke="#8fb3c8" stroke-width="2"/>
</svg>`;
}

/** Ideas for the sample shelf, for "What can I cook?" with no AI — made up, and they say so. */
export function sampleIdeas(say: Say): Array<{ title: string; uses: SampleKey[]; minutes: number; steps: string[] }> {
  return [
    {
      title: say.t({
        en: "Chicken and spinach skillet",
        "pt-BR": "Frango com espinafre na frigideira",
        de: "Hähnchen-Spinat-Pfanne",
        es: "Sartén de pollo con espinacas",
        pl: "Kurczak ze szpinakiem z patelni",
        it: "Padellata di pollo e spinaci",
      }),
      uses: ["chicken", "spinach", "tomatoes"],
      minutes: 25,
      steps: [
        say.t({ en: "Brown the chicken in a hot pan, 6 minutes a side.", "pt-BR": "Doure o frango numa frigideira quente, 6 minutos de cada lado.", de: "Das Hähnchen in einer heißen Pfanne 6 Minuten pro Seite anbraten.", es: "Dora el pollo en una sartén caliente, 6 minutos por lado.", pl: "Obsmaż kurczaka na gorącej patelni, po 6 minut z każdej strony.", it: "Rosola il pollo in una padella calda, 6 minuti per lato." }),
        say.t({ en: "Add the chopped tomatoes and cook until soft.", "pt-BR": "Junte os tomates picados e cozinhe até amolecerem.", de: "Die gehackten Tomaten dazugeben und weich kochen.", es: "Añade los tomates troceados y cocina hasta que se ablanden.", pl: "Dodaj pokrojone pomidory i duś, aż zmiękną.", it: "Aggiungi i pomodori a pezzi e cuoci finché si ammorbidiscono." }),
        say.t({ en: "Stir in the spinach until it wilts. Salt, pepper, done.", "pt-BR": "Misture o espinafre até murchar. Sal, pimenta e pronto.", de: "Den Spinat unterrühren, bis er zusammenfällt. Salz, Pfeffer, fertig.", es: "Incorpora las espinacas hasta que se ablanden. Sal, pimienta y listo.", pl: "Wmieszaj szpinak, aż zwiędnie. Sól, pieprz i gotowe.", it: "Unisci gli spinaci finché appassiscono. Sale, pepe, fatto." }),
      ],
    },
    {
      title: say.t({
        en: "Tomato salad with yogurt dressing",
        "pt-BR": "Salada de tomate com molho de iogurte",
        de: "Tomatensalat mit Joghurtdressing",
        es: "Ensalada de tomate con aliño de yogur",
        pl: "Sałatka z pomidorów z sosem jogurtowym",
        it: "Insalata di pomodori con salsa allo yogurt",
      }),
      uses: ["tomatoes", "yogurt", "cheese"],
      minutes: 10,
      steps: [
        say.t({ en: "Slice the tomatoes onto a plate.", "pt-BR": "Fatie os tomates num prato.", de: "Die Tomaten in Scheiben auf einen Teller legen.", es: "Corta los tomates en rodajas sobre un plato.", pl: "Pokrój pomidory w plastry na talerz.", it: "Affetta i pomodori su un piatto." }),
        say.t({ en: "Stir a pinch of salt into two spoons of yogurt and spoon it over.", "pt-BR": "Misture uma pitada de sal em duas colheres de iogurte e espalhe por cima.", de: "Eine Prise Salz in zwei Löffel Joghurt rühren und darübergeben.", es: "Mezcla una pizca de sal con dos cucharadas de yogur y échalo por encima.", pl: "Wymieszaj dwie łyżki jogurtu ze szczyptą soli i polej.", it: "Mescola un pizzico di sale in due cucchiai di yogurt e versalo sopra." }),
        say.t({ en: "Grate the cheese on top.", "pt-BR": "Rale o queijo por cima.", de: "Den Käse darüberreiben.", es: "Ralla el queso por encima.", pl: "Zetrzyj ser na wierzch.", it: "Grattugia il formaggio sopra." }),
      ],
    },
  ];
}
