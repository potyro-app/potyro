// The sample plant: what "Try it on a sample photo" shows and reads, with no key and no AI.
//
// Two pictures of the same made-up pothos, drawn here as SVG: the first with yellowing lower leaves,
// dark wet soil and water standing in its saucer; the second, a check-up later, greener and drier.
// Each comes with the answer the AI would have given (`sampleReading`), in the person's language, and
// goes through the same steps as a photo — so the first look, the care plan, the reminder and a
// "better since last time" all work before anyone has a key. Both say SAMPLE across the top.

import type { Words } from "potyro";
import type { DiagnosisAnswer } from "./reading.js";
import type { Say } from "./words.js";

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SAMPLE: Words = { en: "SAMPLE PHOTO", "pt-BR": "FOTO DE EXEMPLO", de: "BEISPIELFOTO", es: "FOTO DE EJEMPLO", pl: "PRZYKŁADOWE ZDJĘCIE", it: "FOTO DI ESEMPIO" };
const LATER: Words = { en: "A CHECK-UP LATER", "pt-BR": "UMA REVISÃO DEPOIS", de: "EIN CHECK SPÄTER", es: "UNA REVISIÓN DESPUÉS", pl: "PRZY KOLEJNYM SPRAWDZENIU", it: "UN CONTROLLO DOPO" };

/** One heart-shaped leaf, at (x, y), turned `a` degrees, in `fill`. */
const leaf = (x: number, y: number, a: number, s: number, fill: string, edge = "#2f5d2a") =>
  `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M0 0 C -26 -14 -32 -48 0 -62 C 32 -48 26 -14 0 0 Z" fill="${fill}" stroke="${edge}" stroke-width="2.5"/><path d="M0 -4 L0 -54" stroke="${edge}" stroke-width="2" opacity="0.6"/></g>`;

/** The pothos, 800 × 1000. `later` is the check-up: greener, drier, no water in the saucer. */
export function samplePlantSvg(say: Say, later = false): string {
  const t = (w: Words) => escapeXml(say.t(w));
  const sick = "#d9c24a";
  const brown = "#a77b35";
  const green = "#4f9a43";
  const young = "#78c35d";
  // Lower leaves: yellow and drooping at first, mostly green at the check-up (one old leaf stays yellow).
  const lower = later
    ? [leaf(250, 640, -120, 1.2, green), leaf(560, 650, 115, 1.2, young), leaf(205, 760, -150, 1.1, sick, brown), leaf(600, 770, 150, 1.1, green)]
    : [leaf(250, 640, -120, 1.2, sick, brown), leaf(560, 650, 115, 1.2, sick, brown), leaf(205, 760, -150, 1.1, "#c9a944", brown), leaf(600, 770, 150, 1.1, sick, brown)];
  const upper = [leaf(400, 470, 0, 1.4, green), leaf(330, 500, -35, 1.3, green), leaf(470, 500, 35, 1.3, later ? young : green), leaf(290, 560, -70, 1.25, green), leaf(510, 560, 70, 1.25, green)];
  const extra = later ? [leaf(400, 520, -10, 1.0, young), leaf(440, 450, 20, 0.9, young)] : [];
  // One line across the top; squeezed to the picture's width when a language makes it long.
  const banner = later ? `${t(SAMPLE)} · ${t(LATER)}` : t(SAMPLE);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4efe4"/><stop offset="1" stop-color="#e6dccb"/></linearGradient>
  <linearGradient id="pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b35a35"/><stop offset="0.5" stop-color="#cf7349"/><stop offset="1" stop-color="#a5502e"/></linearGradient>
</defs>
<rect width="800" height="1000" fill="url(#wall)"/>
<rect x="560" y="90" width="190" height="260" rx="8" fill="#dbe9f2" stroke="#b8c8d2" stroke-width="6"/>
<line x1="655" y1="90" x2="655" y2="350" stroke="#b8c8d2" stroke-width="6"/>
<rect x="0" y="0" width="800" height="64" fill="#2f4a2a"/>
<text x="400" y="43" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${later ? 24 : 28}" font-weight="700" letter-spacing="${later ? 2 : 6}" fill="#f3e9a6"${banner.length > 34 ? ' textLength="760" lengthAdjust="spacingAndGlyphs"' : ""}>${banner}</text>
<rect x="0" y="905" width="800" height="95" fill="#c8b79c"/>
<ellipse cx="400" cy="905" rx="210" ry="26" fill="#8f8b86"/>
${later ? "" : `<ellipse cx="400" cy="903" rx="190" ry="18" fill="#7fb3d5" opacity="0.85"/>`}
<path d="M250 690 L550 690 L515 900 L285 900 Z" fill="url(#pot)" stroke="#7d3b20" stroke-width="4"/>
<rect x="238" y="672" width="324" height="40" rx="8" fill="#c7663f" stroke="#7d3b20" stroke-width="4"/>
<ellipse cx="400" cy="676" rx="150" ry="16" fill="${later ? "#8a6a4a" : "#3b2a1c"}"/>
${later ? "" : `<circle cx="350" cy="676" r="4" fill="#6f9fc0"/><circle cx="430" cy="673" r="3" fill="#6f9fc0"/>`}
<path d="M400 676 C 380 600 360 560 330 500 M400 676 C 420 600 440 560 470 500 M400 676 C 330 660 280 650 250 640 M400 676 C 480 660 530 655 560 650 M400 676 C 320 700 260 740 205 760 M400 676 C 480 700 550 740 600 770" stroke="#3f7a35" stroke-width="5" fill="none"/>
${upper.join("\n")}
${extra.join("\n")}
${lower.join("\n")}
</svg>`;
}

const POTHOS: Words = { en: "Pothos", "pt-BR": "Jiboia", de: "Efeutute", es: "Poto", pl: "Epipremnum złociste", it: "Pothos" };

/** What the AI reads off the sample — the first look, or (`later`) the check-up that finds it better. */
export function sampleReading(say: Say, later = false): DiagnosisAnswer {
  const plant = { common: say.t(POTHOS), latin: "Epipremnum aureum", sure: "medium" as const };
  const care = {
    waterEveryDays: 7,
    light: "bright" as const,
    watch: [
      say.t({ en: "New leaves turning yellow", "pt-BR": "Folhas novas amarelando", de: "Neue Blätter, die gelb werden", es: "Hojas nuevas que amarillean", pl: "Nowe liście, które żółkną", it: "Foglie nuove che ingialliscono" }),
      say.t({ en: "Soil still wet a week after watering", "pt-BR": "Terra ainda molhada uma semana depois da rega", de: "Erde eine Woche nach dem Gießen noch nass", es: "Tierra aún mojada una semana después de regar", pl: "Ziemia wciąż mokra tydzień po podlaniu", it: "Terriccio ancora bagnato una settimana dopo l'annaffiatura" }),
    ],
  };
  if (later)
    return {
      isPlant: true,
      clear: true,
      plant,
      problem: {
        kind: "none",
        name: null,
        sure: "medium",
        signs: [
          say.t({ en: "The new leaves are green and firm", "pt-BR": "As folhas novas estão verdes e firmes", de: "Die neuen Blätter sind grün und fest", es: "Las hojas nuevas están verdes y firmes", pl: "Nowe liście są zielone i jędrne", it: "Le foglie nuove sono verdi e sode" }),
          say.t({ en: "The soil looks dry on top", "pt-BR": "A terra parece seca por cima", de: "Die Erde sieht oben trocken aus", es: "La tierra parece seca por encima", pl: "Ziemia z wierzchu wygląda na suchą", it: "Il terriccio sembra asciutto in superficie" }),
        ],
        check: [
          say.t({ en: "Feel the soil a finger deep before each watering", "pt-BR": "Sinta a terra a um dedo de profundidade antes de cada rega", de: "Vor jedem Gießen die Erde einen Finger tief fühlen", es: "Toca la tierra a un dedo de profundidad antes de cada riego", pl: "Przed każdym podlaniem sprawdź palcem ziemię", it: "Tocca il terriccio a un dito di profondità prima di ogni annaffiatura" }),
        ],
        todo: [
          say.t({ en: "Keep watering only when the top of the soil is dry", "pt-BR": "Continue regando só quando a terra estiver seca por cima", de: "Weiter nur gießen, wenn die Erde oben trocken ist", es: "Sigue regando solo cuando la tierra esté seca por encima", pl: "Podlewaj dalej tylko, gdy wierzch ziemi jest suchy", it: "Continua ad annaffiare solo quando il terriccio è asciutto in superficie" }),
          say.t({ en: "Take off the last yellow leaf", "pt-BR": "Tire a última folha amarela", de: "Das letzte gelbe Blatt abnehmen", es: "Quita la última hoja amarilla", pl: "Usuń ostatni żółty liść", it: "Togli l'ultima foglia gialla" }),
        ],
        serious: false,
      },
      care,
      trend: "better",
      trendNote: say.t({
        en: "No new yellow leaves, and the soil is drier than last time.",
        "pt-BR": "Nenhuma folha amarela nova, e a terra está mais seca que da última vez.",
        de: "Keine neuen gelben Blätter, und die Erde ist trockener als beim letzten Mal.",
        es: "No hay hojas amarillas nuevas y la tierra está más seca que la última vez.",
        pl: "Brak nowych żółtych liści, a ziemia jest suchsza niż ostatnio.",
        it: "Nessuna foglia gialla nuova, e il terriccio è più asciutto dell'ultima volta.",
      }),
    };
  return {
    isPlant: true,
    clear: true,
    plant,
    problem: {
      kind: "overwatering",
      name: say.t({ en: "Too much water", "pt-BR": "Água demais", de: "Zu viel Wasser", es: "Demasiada agua", pl: "Za dużo wody", it: "Troppa acqua" }),
      sure: "medium",
      signs: [
        say.t({ en: "Lower leaves yellow and limp", "pt-BR": "Folhas de baixo amarelas e murchas", de: "Untere Blätter gelb und schlaff", es: "Hojas de abajo amarillas y lacias", pl: "Dolne liście żółte i zwiotczałe", it: "Foglie basse gialle e molli" }),
        say.t({ en: "Dark, wet soil", "pt-BR": "Terra escura e molhada", de: "Dunkle, nasse Erde", es: "Tierra oscura y mojada", pl: "Ciemna, mokra ziemia", it: "Terriccio scuro e bagnato" }),
        say.t({ en: "Water standing in the saucer", "pt-BR": "Água parada no pratinho", de: "Wasser steht im Untersetzer", es: "Agua estancada en el plato", pl: "Woda stoi w podstawku", it: "Acqua ferma nel sottovaso" }),
      ],
      check: [
        say.t({ en: "Push a finger 2–3 cm into the soil: damp means don't water yet", "pt-BR": "Enfie um dedo 2–3 cm na terra: úmida quer dizer não regar ainda", de: "Einen Finger 2–3 cm in die Erde stecken: feucht heißt noch nicht gießen", es: "Mete un dedo 2–3 cm en la tierra: si está húmeda, no riegues aún", pl: "Wsuń palec na 2–3 cm w ziemię: wilgotna znaczy, że jeszcze nie podlewać", it: "Infila un dito per 2–3 cm nel terriccio: umido vuol dire non annaffiare ancora" }),
        say.t({ en: "Check the pot has a hole in the bottom", "pt-BR": "Veja se o vaso tem um furo no fundo", de: "Prüfen, ob der Topf unten ein Loch hat", es: "Mira si la maceta tiene un agujero en el fondo", pl: "Sprawdź, czy doniczka ma otwór w dnie", it: "Controlla che il vaso abbia un foro sul fondo" }),
        say.t({ en: "If the soil smells sour, look at the roots: brown and mushy means rot", "pt-BR": "Se a terra cheirar azedo, olhe as raízes: marrons e moles indicam podridão", de: "Riecht die Erde sauer, die Wurzeln ansehen: braun und matschig heißt Fäule", es: "Si la tierra huele agrio, mira las raíces: marrones y blandas indican podredumbre", pl: "Jeśli ziemia kwaśno pachnie, obejrzyj korzenie: brązowe i rozmiękłe to zgnilizna", it: "Se il terriccio ha odore acido, guarda le radici: marroni e molli vuol dire marciume" }),
      ],
      todo: [
        say.t({ en: "Empty the saucer", "pt-BR": "Esvazie o pratinho", de: "Den Untersetzer leeren", es: "Vacía el plato", pl: "Wylej wodę z podstawka", it: "Svuota il sottovaso" }),
        say.t({ en: "Water only when the top 2–3 cm of soil are dry", "pt-BR": "Regue só quando os 2–3 cm de cima da terra estiverem secos", de: "Erst gießen, wenn die oberen 2–3 cm der Erde trocken sind", es: "Riega solo cuando los 2–3 cm de arriba estén secos", pl: "Podlewaj dopiero, gdy wierzchnie 2–3 cm ziemi są suche", it: "Annaffia solo quando i primi 2–3 cm di terriccio sono asciutti" }),
        say.t({ en: "Take off leaves that are fully yellow", "pt-BR": "Tire as folhas totalmente amarelas", de: "Ganz gelbe Blätter abnehmen", es: "Quita las hojas del todo amarillas", pl: "Usuń całkiem żółte liście", it: "Togli le foglie completamente gialle" }),
      ],
      serious: false,
    },
    care,
    trend: null,
    trendNote: null,
  };
}
