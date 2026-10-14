// What the check-ins say: the 30-day series, the scatter by tag, and the one sentence worth reading.
// Plain functions over plain rows, so they are tested without a browser and the chart only draws.
//
// Every sentence is in six languages (#303), told with `ctx.t` and `ctx.format` — passed in as `say`,
// so the tests can hand in their own. A sentence's numbers are coloured on screen, so its template
// names them ("{a}", "{long}") and `parts` splits it where they go: the numbers land wherever each
// language puts them. Every language but English is a model's draft (#297).

import type { Ctx } from "potyro";

/** What the sentences need from `ctx`: its words, and how the person writes numbers and dates. */
export type Say = Pick<Ctx, "t" | "format">;

export interface CheckinRow {
  id?: string;
  date?: string | Date | null;
  hours?: number | null;
  mood?: number | null;
  note?: string | null;
  tags?: string[] | null;
}

/** One check-in, normalised: a local calendar day and numbers or nulls. */
export interface Night {
  day: string; // YYYY-MM-DD
  hours: number | null;
  mood: number | null;
  tags: string[];
  note: string;
  id?: string;
}

export const TAGS = ["exercise", "coffee", "alcohol", "late screen", "nap", "stressed"] as const;
export const MOOD_FACES = ["", "😫", "😕", "😐", "🙂", "😄"] as const;

/** A tag in the person's words; a tag the app does not know (typed by hand) is a record, as typed. */
export function tagName(tag: string, say: Say): string {
  switch (tag) {
    case "exercise":
      return say.t({ en: "exercise", "pt-BR": "exercício", de: "Sport", es: "ejercicio", pl: "ćwiczenia", it: "sport" });
    case "coffee":
      return say.t({ en: "coffee", "pt-BR": "café", de: "Kaffee", es: "café", pl: "kawa", it: "caffè" });
    case "alcohol":
      return say.t({ en: "alcohol", "pt-BR": "álcool", de: "Alkohol", es: "alcohol", pl: "alkohol", it: "alcol" });
    case "late screen":
      return say.t({ en: "late screen", "pt-BR": "tela até tarde", de: "spät am Bildschirm", es: "pantalla hasta tarde", pl: "ekran do późna", it: "schermi fino a tardi" });
    case "nap":
      return say.t({ en: "nap", "pt-BR": "cochilo", de: "Mittagsschlaf", es: "siesta", pl: "drzemka", it: "pisolino" });
    case "stressed":
      return say.t({ en: "stressed", "pt-BR": "estresse", de: "gestresst", es: "estrés", pl: "stres", it: "stress" });
    case "":
      return say.t({ en: "nothing tagged", "pt-BR": "sem etiqueta", de: "ohne Schlagwort", es: "sin etiqueta", pl: "bez tagu", it: "senza tag" });
    default:
      return tag;
  }
}

/** A mood, 1–5, in a word. */
export function moodWord(mood: number, say: Say): string {
  switch (mood) {
    case 1:
      return say.t({ en: "rough", "pt-BR": "péssimo", de: "mies", es: "fatal", pl: "fatalnie", it: "malissimo" });
    case 2:
      return say.t({ en: "low", "pt-BR": "pra baixo", de: "gedrückt", es: "bajo", pl: "słabo", it: "giù" });
    case 3:
      return say.t({ en: "okay", "pt-BR": "ok", de: "okay", es: "normal", pl: "w porządku", it: "così così" });
    case 4:
      return say.t({ en: "good", "pt-BR": "bem", de: "gut", es: "bien", pl: "dobrze", it: "bene" });
    case 5:
      return say.t({ en: "great", "pt-BR": "ótimo", de: "super", es: "genial", pl: "świetnie", it: "benissimo" });
    default:
      return "";
  }
}

/** Nights at or over this many hours are "long"; under SHORT are "short". */
export const LONG = 7;
export const SHORT = 6;
/** Fewer nights than this in a group and a comparison says nothing worth saying. */
export const MIN_GROUP = 3;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The calendar day a check-in is for. A date-only string is that day as written — reading it as a
 * Date would move it to the previous day west of Greenwich. A Date (or a full timestamp) is read
 * in local time, the day the person lived it.
 */
export function dayKey(v: string | Date): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === "string" ? new Date(v) : v;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day `key` moved by `n` days, as a key. Noon avoids daylight-saving edges. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d, 12);
  t.setDate(t.getDate() + n);
  return dayKey(t);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Rows → nights, oldest first. Two check-ins for one day: the later row wins. Undated rows are skipped. */
export function toNights(rows: readonly CheckinRow[]): Night[] {
  const byDay = new Map<string, Night>();
  for (const r of rows) {
    if (r.date == null || r.date === "") continue;
    const day = dayKey(r.date);
    if (day.includes("NaN")) continue;
    byDay.set(day, {
      day,
      hours: num(r.hours),
      mood: num(r.mood),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      note: typeof r.note === "string" ? r.note : "",
      id: r.id,
    });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface Window {
  /** Every calendar day in the window, oldest first. */
  days: string[];
  /** The check-ins inside it. */
  nights: Night[];
}

/**
 * Up to `size` days ending on the latest check-in, starting no earlier than the first one. Ending
 * there rather than on today keeps a chart full when the last weeks were not logged (and keeps sample
 * data alive whenever the app is opened); starting at the first check-in keeps a new log from being
 * drawn as a month of nothing.
 */
export function lastDays(nights: readonly Night[], size = 30): Window {
  const last = nights[nights.length - 1];
  if (!last) return { days: [], nights: [] };
  const earliest = addDays(last.day, -(size - 1));
  const first = nights[0]!.day > earliest ? nights[0]!.day : earliest;
  const days: string[] = [];
  for (let d = first; d <= last.day; d = addDays(d, 1)) days.push(d);
  return { days, nights: nights.filter((n) => n.day >= first) };
}

/** One value per calendar day, null where nothing was logged: the chart leaves a gap there. */
export function dailySeries(w: Window): { hours: Array<number | null>; mood: Array<number | null> } {
  const at = new Map(w.nights.map((n) => [n.day, n]));
  return { hours: w.days.map((d) => at.get(d)?.hours ?? null), mood: w.days.map((d) => at.get(d)?.mood ?? null) };
}

/** A day key as a Date at noon, the day it names wherever the device is. */
const noonOf = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

/** "Mon 12" — short enough for thirty ticks on a phone; in the person's calendar ("pon. 12"). */
export function shortDay(key: string, say: Say): string {
  return say.format.date(noonOf(key), { weekday: "short", day: "numeric" });
}

/** "Oct 11", "11 paź". */
export function monthDay(key: string, say: Say): string {
  return say.format.date(noonOf(key), { month: "short", day: "numeric" });
}

/** "Sat, Oct 11": a night on its own, for a tooltip or a list row. */
export function nightDate(key: string, say: Say): string {
  return say.format.date(noonOf(key), { weekday: "short", month: "short", day: "numeric" });
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** One decimal, without a trailing ".0" doing nothing: 4.1, 3, 7.5 — "4,1" in Polish. */
export function one(n: number, say: Say): string {
  return say.format.number(Math.round(n * 10) / 10, { maximumFractionDigits: 1 });
}

/** "7.5h", "7,5 godz." */
export function hoursText(h: number, say: Say): string {
  return say.t({ en: "{h}h", "pt-BR": "{h} h", de: "{h} Std.", es: "{h} h", pl: "{h} godz.", it: "{h} h" }, { h: Math.round(h * 10) / 10 });
}

/** "7 hours", "7 godzin": whole hours, as a phrase. */
function hoursPhrase(n: number, say: Say): string {
  return say.t(
    {
      en: "{n, plural, one {# hour} other {# hours}}",
      "pt-BR": "{n, plural, one {# hora} other {# horas}}",
      de: "{n, plural, one {# Stunde} other {# Stunden}}",
      es: "{n, plural, one {# hora} other {# horas}}",
      pl: "{n, plural, one {# godzina} few {# godziny} many {# godzin} other {# godziny}}",
      it: "{n, plural, one {# ora} other {# ore}}",
    },
    { n },
  );
}

type Part = Insight["parts"][number];

/**
 * A sentence in parts: `template` (words only, no plural forms) split at each `{name}`, which
 * becomes `values[name]`. Each language puts the numbers where its grammar wants them.
 */
function parts(template: string, values: Record<string, Part>): Part[] {
  return template
    .split(/(\{\w+\})/)
    .filter((s) => s !== "")
    .map((s) => {
      const name = /^\{(\w+)\}$/.exec(s)?.[1];
      return name && name in values ? values[name]! : s;
    });
}

/** Nights with both numbers: the only ones a comparison can use. */
const complete = (nights: readonly Night[]) => nights.filter((n): n is Night & { hours: number; mood: number } => n.hours != null && n.mood != null);

/**
 * A sentence, the numbers in it (so the view can colour them), and how much it matters: the gap it
 * reports as a share of the scale it is on, so a mood gap and a sleep gap can be ranked together.
 */
export interface Insight {
  kind: "sleep" | "tag" | "none";
  parts: Array<string | { value: string; series: "sleep" | "mood" }>;
  strength: number;
}

export const insightText = (i: Insight): string => i.parts.map((p) => (typeof p === "string" ? p : p.value)).join("");

/** "On nights of 7 hours or more your mood averages 4.1. Under 6 hours, it's 2.8." */
export function sleepInsight(nights: readonly Night[], say: Say): Insight | null {
  const all = complete(nights);
  const long = all.filter((n) => n.hours >= LONG).map((n) => n.mood);
  const short = all.filter((n) => n.hours < SHORT).map((n) => n.mood);
  if (long.length < MIN_GROUP || short.length < MIN_GROUP) return null;
  const a = mean(long)!;
  const b = mean(short)!;
  if (Math.abs(a - b) < 0.3) {
    const flat = say.t({
      en: "Long nights or short, your mood stays close to {m}. Sleep is not what moves it.",
      "pt-BR": "Com noites longas ou curtas, seu humor fica perto de {m}. Não é o sono que o mexe.",
      de: "Ob lange oder kurze Nächte, deine Stimmung bleibt bei etwa {m}. Am Schlaf liegt es nicht.",
      es: "Con noches largas o cortas, tu ánimo se queda cerca de {m}. No es el sueño lo que lo mueve.",
      pl: "Długie noce czy krótkie — twój nastrój trzyma się około {m}. To nie sen go zmienia.",
      it: "Notti lunghe o corte, il tuo umore resta intorno a {m}. Non è il sonno a muoverlo.",
    });
    return { kind: "sleep", parts: parts(flat, { m: { value: one((a + b) / 2, say), series: "mood" } }), strength: 0.05 };
  }
  const template = say.t({
    en: "On nights of {long} or more your mood averages {a}. Under {short}, it's {b}.",
    "pt-BR": "Nas noites de {long} ou mais, seu humor fica em média em {a}. Com menos de {short}, fica em {b}.",
    de: "In Nächten mit {long} oder mehr liegt deine Stimmung im Schnitt bei {a}. Unter {short} bei {b}.",
    es: "Las noches de {long} o más, tu ánimo medio es {a}. Con menos de {short}, es {b}.",
    pl: "Po nocach, w które śpisz {long} lub dłużej, twój nastrój wynosi średnio {a}. Poniżej {short} — {b}.",
    it: "Nelle notti di {long} o più il tuo umore è in media {a}. Sotto le {short}, è {b}.",
  });
  return {
    kind: "sleep",
    parts: parts(template, {
      long: { value: hoursPhrase(LONG, say), series: "sleep" },
      a: { value: one(a, say), series: "mood" },
      short: { value: hoursPhrase(SHORT, say), series: "sleep" },
      b: { value: one(b, say), series: "mood" },
    }),
    strength: Math.abs(a - b) / 4,
  };
}

/** How a sentence about a tag begins: "On days you exercise", "W dni z ćwiczeniami". */
function tagLead(tag: string, say: Say): string {
  switch (tag) {
    case "exercise":
      return say.t({ en: "On days you exercise", "pt-BR": "Nos dias em que você se exercita", de: "An Tagen mit Sport", es: "Los días que haces ejercicio", pl: "W dni z ćwiczeniami", it: "Nei giorni in cui fai sport" });
    case "coffee":
      return say.t({ en: "On coffee days", "pt-BR": "Nos dias com café", de: "An Kaffeetagen", es: "Los días con café", pl: "W dni z kawą", it: "Nei giorni con il caffè" });
    case "alcohol":
      return say.t({ en: "After a drink", "pt-BR": "Depois de beber", de: "Nach einem Drink", es: "Después de beber", pl: "Po alkoholu", it: "Dopo aver bevuto" });
    case "late screen":
      return say.t({
        en: "After late screens",
        "pt-BR": "Depois de tela até tarde",
        de: "Nach spätem Bildschirm",
        es: "Tras pantallas hasta tarde",
        pl: "Po wieczorze przed ekranem",
        it: "Dopo gli schermi fino a tardi",
      });
    case "nap":
      return say.t({ en: "On days with a nap", "pt-BR": "Nos dias com cochilo", de: "An Tagen mit Mittagsschlaf", es: "Los días con siesta", pl: "W dni z drzemką", it: "Nei giorni con il pisolino" });
    case "stressed":
      return say.t({ en: "On stressful days", "pt-BR": "Nos dias estressantes", de: "An stressigen Tagen", es: "Los días de estrés", pl: "W stresujące dni", it: "Nei giorni stressanti" });
    default:
      // A tag typed by hand is the person's own word: quoted as it is.
      return say.t(
        { en: "On days tagged “{tag}”", "pt-BR": "Nos dias com “{tag}”", de: "An Tagen mit „{tag}“", es: "Los días con «{tag}»", pl: "W dni z tagiem „{tag}”", it: "Nei giorni con “{tag}”" },
        { tag },
      );
  }
}

/**
 * The tag that makes the biggest difference, to mood or to sleep: "On days you exercise your mood
 * averages 4.3, against 3.1 without." Only tags with enough nights both with and without them.
 */
export function tagInsight(nights: readonly Night[], say: Say): Insight | null {
  const all = complete(nights);
  let best: Insight | null = null;
  const tags = [...new Set(all.flatMap((n) => n.tags))];
  for (const tag of tags) {
    const withIt = all.filter((n) => n.tags.includes(tag));
    const without = all.filter((n) => !n.tags.includes(tag));
    if (withIt.length < MIN_GROUP || without.length < MIN_GROUP) continue;
    const lead = tagLead(tag, say);
    const moodGap = mean(withIt.map((n) => n.mood))! - mean(without.map((n) => n.mood))!;
    const sleepGap = mean(withIt.map((n) => n.hours))! - mean(without.map((n) => n.hours))!;
    const byMood = Math.abs(moodGap) / 4;
    const bySleep = Math.abs(sleepGap) / 4;
    const moodTemplate = {
      en: "{lead} your mood averages {a}, against {b} without.",
      "pt-BR": "{lead}, seu humor fica em média em {a}, contra {b} nos outros dias.",
      de: "{lead} liegt deine Stimmung im Schnitt bei {a}, sonst bei {b}.",
      es: "{lead}, tu ánimo medio es {a}, frente a {b} el resto de días.",
      pl: "{lead} twój nastrój wynosi średnio {a}, a w pozostałe dni {b}.",
      it: "{lead} il tuo umore è in media {a}, contro {b} negli altri giorni.",
    };
    const sleepTemplate = {
      en: "{lead} you sleep {a} on average, against {b} without.",
      "pt-BR": "{lead}, você dorme em média {a}, contra {b} nos outros dias.",
      de: "{lead} schläfst du im Schnitt {a}, sonst {b}.",
      es: "{lead}, duermes {a} de media, frente a {b} el resto de días.",
      pl: "{lead} śpisz średnio {a}, a w pozostałe dni {b}.",
      it: "{lead} dormi in media {a}, contro {b} negli altri giorni.",
    };
    const candidate: Insight =
      byMood >= bySleep
        ? {
            kind: "tag",
            parts: parts(say.t(moodTemplate), {
              lead,
              a: { value: one(mean(withIt.map((n) => n.mood))!, say), series: "mood" },
              b: { value: one(mean(without.map((n) => n.mood))!, say), series: "mood" },
            }),
            strength: byMood,
          }
        : {
            kind: "tag",
            parts: parts(say.t(sleepTemplate), {
              lead,
              a: { value: hoursText(mean(withIt.map((n) => n.hours))!, say), series: "sleep" },
              b: { value: hoursText(mean(without.map((n) => n.hours))!, say), series: "sleep" },
            }),
            strength: bySleep,
          };
    if (!best || candidate.strength > best.strength) best = candidate;
  }
  return best;
}

/**
 * What to say, most telling first. Always at least one line: with too little logged yet it says how
 * many more check-ins it needs, rather than inventing a pattern from three nights.
 */
export function insights(nights: readonly Night[], say: Say): Insight[] {
  const found = [sleepInsight(nights, say), tagInsight(nights, say)].filter((x): x is Insight => x !== null).sort((a, b) => b.strength - a.strength);
  if (found.length) return found;
  const have = complete(nights).length;
  const need = Math.max(1, 2 * MIN_GROUP - have);
  return [
    {
      kind: "none",
      parts: have
        ? [
            say.t(
              {
                en: "{have, plural, one {# check-in} other {# check-ins}} so far. A few more nights — about {need} — and a pattern starts to show.",
                "pt-BR": "{have, plural, one {# registro} other {# registros}} até agora. Mais algumas noites — umas {need} — e um padrão começa a aparecer.",
                de: "Bisher {have, plural, one {# Eintrag} other {# Einträge}}. Noch ein paar Nächte — etwa {need} — und ein Muster zeigt sich.",
                es: "{have, plural, one {# registro} other {# registros}} hasta ahora. Unas cuantas noches más — unas {need} — y empezará a verse un patrón.",
                pl: "Na razie {have, plural, one {# wpis} few {# wpisy} many {# wpisów} other {# wpisu}}. Jeszcze kilka nocy — około {need} — i zacznie się rysować wzór.",
                it: "{have, plural, one {# registrazione} other {# registrazioni}} finora. Ancora qualche notte — circa {need} — e comincia a vedersi uno schema.",
              },
              { have, need },
            ),
          ]
        : [
            say.t({
              en: "Log how you slept tonight. After a week or so, this is where the pattern shows up.",
              "pt-BR": "Registre como você dormiu esta noite. Depois de mais ou menos uma semana, é aqui que o padrão aparece.",
              de: "Trag ein, wie du heute Nacht geschlafen hast. Nach etwa einer Woche zeigt sich hier das Muster.",
              es: "Apunta cómo has dormido esta noche. Después de una semana o así, aquí aparecerá el patrón.",
              pl: "Zapisz, jak ci się spało tej nocy. Po mniej więcej tygodniu tutaj pojawi się wzór.",
              it: "Segna come hai dormito stanotte. Dopo una settimana circa, qui comparirà lo schema.",
            }),
          ],
      strength: 0,
    },
  ];
}

export interface Stats {
  nights: number;
  avgHours: number | null;
  avgMood: number | null;
  /** Share of logged nights at or over LONG hours, 0–1. */
  longShare: number | null;
}

export function stats(nights: readonly Night[]): Stats {
  const hours = nights.map((n) => n.hours).filter((h): h is number => h != null);
  const moods = nights.map((n) => n.mood).filter((m): m is number => m != null);
  return {
    nights: nights.length,
    avgHours: mean(hours),
    avgMood: mean(moods),
    longShare: hours.length ? hours.filter((h) => h >= LONG).length / hours.length : null,
  };
}

/** A small, stable offset per day, so nights with the same mood do not sit on top of each other. */
export function jitter(day: string, spread = 0.14): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

export interface ScatterGroup {
  tag: string; // a tag, or "" for nights with none
  points: Array<{ x: number; y: number; day: string; note: string }>;
}

/** One group per tag in `order` that has nights, then the untagged ones. A night with two tags is in both. */
export function scatterGroups(nights: readonly Night[], order: readonly string[] = TAGS): ScatterGroup[] {
  const all = complete(nights);
  const point = (n: Night & { hours: number; mood: number }) => ({ x: n.hours, y: n.mood + jitter(n.day), day: n.day, note: n.note });
  const known = new Set(order);
  const extra = [...new Set(all.flatMap((n) => n.tags).filter((t) => !known.has(t)))].sort();
  const groups: ScatterGroup[] = [...order, ...extra].map((tag) => ({ tag, points: all.filter((n) => n.tags.includes(tag)).map(point) }));
  groups.push({ tag: "", points: all.filter((n) => n.tags.length === 0).map(point) });
  return groups.filter((g) => g.points.length > 0);
}

/** Least-squares line through (hours, mood), as its two ends over the hours logged; null when flat or too few. */
export function trend(nights: readonly Night[]): { from: { x: number; y: number }; to: { x: number; y: number }; slope: number } | null {
  const all = complete(nights);
  if (all.length < 4) return null;
  const mx = mean(all.map((n) => n.hours))!;
  const my = mean(all.map((n) => n.mood))!;
  let sxy = 0;
  let sxx = 0;
  for (const n of all) {
    sxy += (n.hours - mx) * (n.mood - my);
    sxx += (n.hours - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const lo = Math.min(...all.map((n) => n.hours));
  const hi = Math.max(...all.map((n) => n.hours));
  const at = (x: number) => Math.min(5.4, Math.max(0.6, my + slope * (x - mx)));
  return { from: { x: lo, y: at(lo) }, to: { x: hi, y: at(hi) }, slope };
}
