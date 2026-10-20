// How an item reads: its kind, its place, how long it has left (and whether that is a guess), the
// reminder, the heading it sits under. Words through `ctx.t`, dates through `ctx.format`, so they
// read the same in the sealed box as in the person's own copy, in all six languages.
//
// In six languages (docs/20); every language but English is a model's draft (#297). An item's name
// is a record and is never translated.

import type { Ctx, Words } from "potyro";
import { daysBetween, remindAt, toDate, type Category, type Freshness, type Place, type Status } from "./shelf-life.js";

export type Say = Pick<Ctx, "t" | "format">;

export const CATEGORY_WORDS: Record<Category, Words> = {
  produce: { en: "Fruit & veg", "pt-BR": "Frutas e verduras", de: "Obst & Gemüse", es: "Fruta y verdura", pl: "Owoce i warzywa", it: "Frutta e verdura" },
  dairy: { en: "Dairy", "pt-BR": "Laticínios", de: "Milchprodukte", es: "Lácteos", pl: "Nabiał", it: "Latticini" },
  meat: { en: "Meat", "pt-BR": "Carne", de: "Fleisch", es: "Carne", pl: "Mięso", it: "Carne" },
  fish: { en: "Fish", "pt-BR": "Peixe", de: "Fisch", es: "Pescado", pl: "Ryby", it: "Pesce" },
  bakery: { en: "Bread & bakery", "pt-BR": "Pães", de: "Brot & Gebäck", es: "Pan y bollería", pl: "Pieczywo", it: "Pane e dolci" },
  frozen: { en: "Frozen", "pt-BR": "Congelados", de: "Tiefkühlware", es: "Congelados", pl: "Mrożonki", it: "Surgelati" },
  dry: { en: "Dry & tins", "pt-BR": "Secos e enlatados", de: "Vorrat & Konserven", es: "Despensa y latas", pl: "Suche i puszki", it: "Dispensa e scatolame" },
  drinks: { en: "Drinks", "pt-BR": "Bebidas", de: "Getränke", es: "Bebidas", pl: "Napoje", it: "Bevande" },
  leftovers: { en: "Leftovers", "pt-BR": "Sobras", de: "Reste", es: "Sobras", pl: "Resztki", it: "Avanzi" },
  other: { en: "Other", "pt-BR": "Outros", de: "Sonstiges", es: "Otros", pl: "Inne", it: "Altro" },
};

export const PLACE_WORDS: Record<Place, Words> = {
  fridge: { en: "Fridge", "pt-BR": "Geladeira", de: "Kühlschrank", es: "Nevera", pl: "Lodówka", it: "Frigo" },
  freezer: { en: "Freezer", "pt-BR": "Freezer", de: "Gefrierfach", es: "Congelador", pl: "Zamrażarka", it: "Freezer" },
  cupboard: { en: "Cupboard", "pt-BR": "Armário", de: "Schrank", es: "Alacena", pl: "Szafka", it: "Credenza" },
};

export const STATUS_WORDS: Record<Status, Words> = {
  in: { en: "In the kitchen", "pt-BR": "Na cozinha", de: "In der Küche", es: "En la cocina", pl: "W kuchni", it: "In cucina" },
  used: { en: "Used", "pt-BR": "Usado", de: "Verbraucht", es: "Usado", pl: "Zużyte", it: "Usato" },
  wasted: { en: "Thrown away", "pt-BR": "Jogado fora", de: "Weggeworfen", es: "Tirado", pl: "Wyrzucone", it: "Buttato" },
};

export const FRESHNESS_WORDS: Record<Freshness, Words> = {
  expired: { en: "Past its date", "pt-BR": "Passou da data", de: "Abgelaufen", es: "Caducado", pl: "Po terminie", it: "Scaduto" },
  today: { en: "Use today", "pt-BR": "Usar hoje", de: "Heute verbrauchen", es: "Usar hoy", pl: "Zużyj dziś", it: "Da usare oggi" },
  soon: { en: "In the next 3 days", "pt-BR": "Nos próximos 3 dias", de: "In den nächsten 3 Tagen", es: "En los próximos 3 días", pl: "W ciągu 3 dni", it: "Nei prossimi 3 giorni" },
  week: { en: "This week", "pt-BR": "Nesta semana", de: "Diese Woche", es: "Esta semana", pl: "W tym tygodniu", it: "Questa settimana" },
  later: { en: "Later", "pt-BR": "Mais tarde", de: "Später", es: "Más adelante", pl: "Później", it: "Più avanti" },
  none: { en: "No date", "pt-BR": "Sem data", de: "Ohne Datum", es: "Sin fecha", pl: "Bez daty", it: "Senza data" },
};

const GUESS = { en: "date guessed", "pt-BR": "data estimada", de: "Datum geschätzt", es: "fecha estimada", pl: "data szacunkowa", it: "data stimata" };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Expires tomorrow", "5 days left", "Expired 2 days ago" — empty when there is no date. */
export function leftText(expires: Date | null, say: Say, today: Date): string {
  if (!expires) return "";
  const n = daysBetween(today, expires);
  if (n < -1)
    return say.t(
      {
        en: "Expired {n, plural, other {# days ago}}",
        "pt-BR": "Venceu há {n, plural, one {# dia} other {# dias}}",
        de: "Seit {n, plural, one {# Tag} other {# Tagen}} abgelaufen",
        es: "Caducó hace {n, plural, one {# día} other {# días}}",
        pl: "Po terminie od {n, plural, one {# dnia} few {# dni} many {# dni} other {# dnia}}",
        it: "Scaduto da {n, plural, one {# giorno} other {# giorni}}",
      },
      { n: -n },
    );
  if (n === -1) return say.t({ en: "Expired yesterday", "pt-BR": "Venceu ontem", de: "Seit gestern abgelaufen", es: "Caducó ayer", pl: "Termin minął wczoraj", it: "Scaduto ieri" });
  if (n === 0) return say.t({ en: "Expires today", "pt-BR": "Vence hoje", de: "Läuft heute ab", es: "Caduca hoy", pl: "Termin mija dziś", it: "Scade oggi" });
  if (n === 1) return say.t({ en: "Expires tomorrow", "pt-BR": "Vence amanhã", de: "Läuft morgen ab", es: "Caduca mañana", pl: "Termin mija jutro", it: "Scade domani" });
  return say.t(
    {
      en: "{n, plural, one {# day left} other {# days left}}",
      "pt-BR": "{n, plural, one {Falta # dia} other {Faltam # dias}}",
      de: "Noch {n, plural, one {# Tag} other {# Tage}}",
      es: "{n, plural, one {Queda # día} other {Quedan # días}}",
      pl: "{n, plural, one {Został # dzień} few {Zostały # dni} many {Zostało # dni} other {Zostało # dnia}}",
      it: "{n, plural, one {Manca # giorno} other {Mancano # giorni}}",
    },
    { n },
  );
}

export interface ItemRow {
  name?: unknown;
  amount?: unknown;
  category?: unknown;
  where?: unknown;
  expires?: unknown;
  guessed?: unknown;
  status?: unknown;
  finished?: unknown;
  [field: string]: unknown;
}

/** How long it has left, saying so when the date is the app's guess: "5 days left · date guessed". */
export function expiryText(r: ItemRow, say: Say, today: Date): string {
  const left = leftText(toDate(r.expires), say, today);
  if (!left) return say.t(FRESHNESS_WORDS.none);
  return r.guessed ? `${left} · ${say.t(GUESS)}` : left;
}

/** The row's second line: how long it has left, how much, and where it is. */
export function rowText(r: ItemRow, say: Say, today: Date): string {
  const place = PLACE_WORDS[r.where as Place];
  return [expiryText(r, say, today), str(r.amount), place ? say.t(place) : ""].filter(Boolean).join(" · ");
}

/** "Used on 12 Oct" / "Thrown away on 12 Oct": a finished item's line on the Waste page. */
export function finishedText(r: ItemRow, say: Say): string {
  const when = toDate(r.finished);
  const day = when ? say.format.date(when, { day: "numeric", month: "short" }) : "";
  if (r.status === "wasted")
    return day
      ? say.t({ en: "Thrown away on {day}", "pt-BR": "Jogado fora em {day}", de: "Weggeworfen am {day}", es: "Tirado el {day}", pl: "Wyrzucone {day}", it: "Buttato il {day}" }, { day })
      : say.t(STATUS_WORDS.wasted);
  return day
    ? say.t({ en: "Used on {day}", "pt-BR": "Usado em {day}", de: "Verbraucht am {day}", es: "Usado el {day}", pl: "Zużyte {day}", it: "Usato il {day}" }, { day })
    : say.t(STATUS_WORDS.used);
}

/** The reminder as it will come: "Thu 16 Oct, 09:00", or why there is none. */
export function reminderText(r: ItemRow, say: Say, now: Date): string {
  const at = remindAt(r, now);
  if (at) return say.format.date(at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if ((r.status ?? "in") !== "in") return "";
  return toDate(r.expires)
    ? say.t({ en: "None — it is too late for one", "pt-BR": "Nenhum — já é tarde para isso", de: "Keine — dafür ist es zu spät", es: "Ninguno: ya es tarde", pl: "Brak — na to już za późno", it: "Nessuno: ormai è tardi" })
    : say.t({ en: "None — there is no date", "pt-BR": "Nenhum — não há data", de: "Keine — es gibt kein Datum", es: "Ninguno: no hay fecha", pl: "Brak — nie ma daty", it: "Nessuno: non c'è una data" });
}

/** The notification's title: "Milk expires tomorrow", or "today" when it comes on the day. */
export function reminderTitle(r: ItemRow, say: Say, now: Date): string {
  const at = remindAt(r, now);
  const expires = toDate(r.expires);
  const name = str(r.name);
  if (at && expires && daysBetween(at, expires) === 0)
    return say.t({ en: "{name} expires today", "pt-BR": "{name} vence hoje", de: "{name} läuft heute ab", es: "{name} caduca hoy", pl: "{name}: termin mija dziś", it: "{name} scade oggi" }, { name });
  return say.t({ en: "{name} expires tomorrow", "pt-BR": "{name} vence amanhã", de: "{name} läuft morgen ab", es: "{name} caduca mañana", pl: "{name}: termin mija jutro", it: "{name} scade domani" }, { name });
}

export const REMINDER_BODY: Words = {
  en: "Cook it, freeze it or give it away — and tick it off in Kitchen.",
  "pt-BR": "Cozinhe, congele ou dê para alguém — e marque na Cozinha.",
  de: "Koch es, frier es ein oder verschenk es — und hak es in der Küche ab.",
  es: "Cocínalo, congélalo o regálalo, y márcalo en Cocina.",
  pl: "Ugotuj, zamroź albo oddaj — i odhacz w Kuchni.",
  it: "Cucinalo, congelalo o regalalo, e segnalo in Cucina.",
};
