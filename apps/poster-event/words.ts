// How an event reads: its day and time, its reminder, the heading it sits under, and the message a
// friend gets. Words through `ctx.t`, dates through `ctx.format`, so they read the same in the sealed
// box as in the person's own copy, in all six languages.

import type { Ctx } from "potyro";
import { daysUntil, endsAt, isOver, toDate } from "./dates.js";
import { remindAt } from "./calendar.js";

export type Say = Pick<Ctx, "t" | "format">;

export interface EventRow {
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  doors?: unknown;
  venue?: unknown;
  address?: unknown;
  price?: unknown;
  link?: unknown;
  remind?: unknown;
  [field: string]: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Fri 20 Nov" — with the year only when it is not this one. */
export function dayText(d: Date, say: Say, today: Date): string {
  return say.format.date(d, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

/** "20:00", or "8:00 PM" where that is how the person's clock reads. */
export const timeText = (d: Date, say: Say): string => say.format.date(d, { hour: "numeric", minute: "2-digit" });

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Fri 20 Nov, 20:00–23:00", "Fri 12 – Sun 14 Jun", "Fri 20 Nov · all day". Empty when there is no start. */
export function whenText(r: EventRow, say: Say, today: Date): string {
  const start = toDate(r.start);
  if (!start) return "";
  const end = toDate(r.end);
  const later = end && end.getTime() > start.getTime() ? end : null;
  if (r.allDay) {
    if (later && !sameDay(start, later)) return `${dayText(start, say, today)} – ${dayText(later, say, today)}`;
    return say.t({ en: "{day} · all day", "pt-BR": "{day} · o dia todo", de: "{day} · ganztägig", es: "{day} · todo el día", pl: "{day} · cały dzień", it: "{day} · tutto il giorno" }, { day: dayText(start, say, today) });
  }
  const from = `${dayText(start, say, today)}, ${timeText(start, say)}`;
  if (!later) return from;
  // An end in the small hours belongs to the same night: "Fri 20 Nov, 22:00–02:00".
  const sameNight = sameDay(start, later) || (later.getTime() - start.getTime() < 12 * 3_600_000 && later.getHours() < 8);
  return sameNight ? `${from}–${timeText(later, say)}` : `${from} – ${dayText(later, say, today)}, ${timeText(later, say)}`;
}

/** "Doors 19:00" when the poster gave doors apart from the start. */
export function doorsText(r: EventRow, say: Say): string {
  const doors = str(r.doors);
  return doors ? say.t({ en: "Doors {time}", "pt-BR": "Portas às {time}", de: "Einlass {time}", es: "Puertas a las {time}", pl: "Wejście od {time}", it: "Apertura porte {time}" }, { time: doors }) : "";
}

/** The reminder as it will happen: "Thu 19 Nov, 20:00", "No reminder", or nothing for an event that is over. */
export function reminderText(r: EventRow, say: Say, now: Date): string {
  if (r.remind === "none") return say.t({ en: "No reminder", "pt-BR": "Sem lembrete", de: "Keine Erinnerung", es: "Sin recordatorio", pl: "Bez przypomnienia", it: "Nessun promemoria" });
  if (isOver(r, now)) return "";
  const at = remindAt(r, now);
  if (!at) return "";
  if (at.getTime() <= now.getTime()) return say.t({ en: "Now — it's coming up", "pt-BR": "Agora — está chegando", de: "Jetzt — es ist bald so weit", es: "Ahora — ya llega", pl: "Teraz — to już niedługo", it: "Adesso — ci siamo quasi" });
  return `${dayText(at, say, now)}, ${timeText(at, say)}`;
}

/** The heading an upcoming event sits under: Now on, Today, Tomorrow, Next 7 days, then its month. */
export function bucket(r: EventRow, say: Say, now: Date): string {
  const start = toDate(r.start);
  if (!start) return say.t({ en: "No date yet", "pt-BR": "Ainda sem data", de: "Noch ohne Datum", es: "Aún sin fecha", pl: "Jeszcze bez daty", it: "Ancora senza data" });
  if (start.getTime() <= now.getTime() && !isOver(r, now)) return say.t({ en: "On now", "pt-BR": "Acontecendo agora", de: "Läuft gerade", es: "Ahora mismo", pl: "Trwa teraz", it: "In corso" });
  const days = daysUntil(start, now);
  if (days <= 0) return say.t({ en: "Today", "pt-BR": "Hoje", de: "Heute", es: "Hoy", pl: "Dziś", it: "Oggi" });
  if (days === 1) return say.t({ en: "Tomorrow", "pt-BR": "Amanhã", de: "Morgen", es: "Mañana", pl: "Jutro", it: "Domani" });
  if (days < 7) return say.t({ en: "Next 7 days", "pt-BR": "Próximos 7 dias", de: "Nächste 7 Tage", es: "Próximos 7 días", pl: "Najbliższe 7 dni", it: "Prossimi 7 giorni" });
  const month = say.format.date(start, { month: "long", ...(start.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
  return month.charAt(0).toLocaleUpperCase() + month.slice(1);
}

/** The heading a past event sits under: its month and year. */
export function pastBucket(r: EventRow, say: Say): string {
  const start = toDate(r.start);
  if (!start) return "";
  const month = say.format.date(start, { month: "long", year: "numeric" });
  return month.charAt(0).toLocaleUpperCase() + month.slice(1);
}

/** A list row's second line: "Fri 20 Nov, 20:00 · The Lantern Room". */
export function rowText(r: EventRow, say: Say, today: Date): string {
  return [whenText(r, say, today), str(r.venue)].filter(Boolean).join(" · ");
}

/**
 * What a friend gets: the event in a few lines they can read in a chat. The link goes separately, so
 * a phone's share sheet can show it as a link. Records are the person's own words, never translated.
 */
export function shareText(r: EventRow, say: Say, today: Date): string {
  const when = [whenText(r, say, today), doorsText(r, say)].filter(Boolean).join(" · ");
  const where = [str(r.venue), str(r.address)].filter(Boolean).join(", ");
  return [str(r.title), when, where, str(r.price)].filter(Boolean).join("\n");
}

/** Over by now — for the Coming up / Past split. */
export const over = (r: EventRow, now: Date): boolean => isOver(r, now);

/** For sorting: the start, or the far future for an event with none. */
export const startTime = (r: EventRow): number => toDate(r.start)?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** For sorting past events: when they ended. */
export const endTime = (r: EventRow): number => endsAt(r)?.getTime() ?? 0;
