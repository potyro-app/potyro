// The sample poster: what "Try it on a sample poster" shows and reads, with no key and no AI.
//
// It is drawn here, as an SVG, rather than shipped as a photo, for one reason: its date. A sample
// printed with a fixed date is a sample that says "this has already passed" for most of its life.
// This one is always for the Friday after next, in the person's own words for the day and month, and
// the answer it "reads" (`sampleReading`) is made from the same date — so it is exactly what the AI
// would have read off it. It says SAMPLE across its top, and the event it makes says so too.

import type { PosterReading } from "./dates.js";
import type { Say } from "./words.js";

/** The Friday at least nine days from `today`: far enough out that every reminder choice is still ahead. */
export function sampleDay(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 9);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}

/** The date as the poster prints it: "FRI 23 OCT" — in the person's language. */
export function sampleDateText(day: Date, say: Say): string {
  return say.format.date(day, { weekday: "short", day: "numeric", month: "short" }).replace(/[.,]/g, "").toUpperCase();
}

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const sampleWord = (say: Say) => say.t({ en: "SAMPLE POSTER", "pt-BR": "CARTAZ DE EXEMPLO", de: "BEISPIELPLAKAT", es: "CARTEL DE EJEMPLO", pl: "PRZYKŁADOWY PLAKAT", it: "LOCANDINA DI ESEMPIO" });
const doorsWord = (say: Say) => say.t({ en: "DOORS", "pt-BR": "PORTAS", de: "EINLASS", es: "PUERTAS", pl: "WEJŚCIE", it: "APERTURA" });
const startWord = (say: Say) => say.t({ en: "START", "pt-BR": "INÍCIO", de: "BEGINN", es: "INICIO", pl: "START", it: "INIZIO" });
const liveWord = (say: Say) => say.t({ en: "live jazz · one night only", "pt-BR": "jazz ao vivo · uma noite só", de: "Live-Jazz · nur eine Nacht", es: "jazz en directo · solo una noche", pl: "jazz na żywo · tylko jeden wieczór", it: "jazz dal vivo · una sola sera" });
const studentsWord = (say: Say) => say.t({ en: "students", "pt-BR": "estudantes", de: "Studierende", es: "estudiantes", pl: "studenci", it: "studenti" });

export const SAMPLE_TITLE = "Night Tram Quartet";
const VENUE = "The Lantern Room";
const ADDRESS = "12 Harbour Lane";
const LINK = "lanternroom.example/tickets";

/** The poster, 800 × 1120, as SVG text. Every word in it is escaped: it carries the locale's own date. */
export function samplePosterSvg(today: Date, say: Say): string {
  const day = sampleDay(today);
  const date = escapeXml(sampleDateText(day, say));
  const t = (s: string) => escapeXml(s);
  const price = `12 € · 8 € ${studentsWord(say)}`;
  // Tram-line arcs and stars: a poster you would see on a lamp post, not a form.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120" viewBox="0 0 800 1120">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14213d"/><stop offset="0.62" stop-color="#3a2d5c"/><stop offset="1" stop-color="#e26d3d"/></linearGradient>
  <radialGradient id="moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d8"/><stop offset="1" stop-color="#f3c969"/></radialGradient>
</defs>
<rect width="800" height="1120" fill="url(#sky)"/>
<g fill="#fff6d8" opacity="0.8"><circle cx="90" cy="210" r="2.5"/><circle cx="210" cy="140" r="1.8"/><circle cx="640" cy="120" r="2.2"/><circle cx="720" cy="260" r="1.6"/><circle cx="520" cy="200" r="1.4"/><circle cx="150" cy="330" r="1.5"/></g>
<circle cx="600" cy="300" r="96" fill="url(#moon)"/>
<g fill="none" stroke="#f3c969" stroke-width="5" opacity="0.9"><path d="M-20 760 C 220 600, 560 600, 820 720"/><path d="M-20 800 C 220 640, 560 640, 820 760" opacity="0.5"/></g>
<g transform="translate(250 600)"><rect x="0" y="0" width="300" height="120" rx="22" fill="#e9b949"/><rect x="24" y="24" width="64" height="48" rx="8" fill="#14213d"/><rect x="118" y="24" width="64" height="48" rx="8" fill="#14213d"/><rect x="212" y="24" width="64" height="48" rx="8" fill="#14213d"/><rect x="0" y="92" width="300" height="12" fill="#c8862a"/><line x1="150" y1="0" x2="150" y2="-80" stroke="#f3c969" stroke-width="4"/></g>
<rect x="0" y="0" width="800" height="64" fill="#f3c969"/>
<text x="400" y="43" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="8" fill="#14213d">${t(sampleWord(say))}</text>
<text x="400" y="470" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="92" font-weight="700" fill="#fff6d8">Night Tram</text>
<text x="400" y="545" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="64" font-style="italic" fill="#f3c969">Quartet</text>
<text x="400" y="830" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#fff6d8" letter-spacing="2">${t(liveWord(say))}</text>
<text x="400" y="920" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="70" font-weight="800" fill="#fff6d8">${date}</text>
<text x="400" y="980" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="600" fill="#14213d">${t(doorsWord(say))} 19:00 · ${t(startWord(say))} 20:00</text>
<text x="400" y="1032" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#14213d">${t(VENUE)} · ${t(ADDRESS)}</text>
<text x="400" y="1078" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#14213d">${t(price)} · ${t(LINK)}</text>
</svg>`;
}

/** What the AI reads off the sample — the fixture answer, made from the same date as the poster. */
export function sampleReading(today: Date, say: Say): PosterReading {
  const day = sampleDay(today);
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return {
    title: SAMPLE_TITLE,
    dateText: sampleDateText(day, say),
    date: iso,
    endDate: null,
    yearPrinted: false,
    start: "20:00",
    end: null,
    doors: "19:00",
    timezone: null,
    venue: VENUE,
    address: ADDRESS,
    price: `12 € · 8 € ${studentsWord(say)}`,
    link: LINK,
    description: say.t({
      en: "A sample event, made up to show how this app works. Delete it whenever you like.",
      "pt-BR": "Um evento de exemplo, inventado para mostrar como este app funciona. Apague quando quiser.",
      de: "Ein erfundener Beispieltermin, der zeigt, wie diese App funktioniert. Lösch ihn, wann du willst.",
      es: "Un evento de ejemplo, inventado para enseñar cómo funciona esta app. Bórralo cuando quieras.",
      pl: "Przykładowe, wymyślone wydarzenie, które pokazuje, jak działa ta aplikacja. Usuń je, kiedy chcesz.",
      it: "Un evento di esempio, inventato per mostrare come funziona questa app. Eliminalo quando vuoi.",
    }),
  };
}
