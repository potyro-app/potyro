// An event's fields: the record's shape, and the confirm form the person checks a reading in — the
// same fields, so what the form shows is exactly what is saved.

import type { Field } from "potyro";
import { DEFAULT_REMIND, REMIND } from "./calendar.js";

export const FIELDS = {
  title: {
    type: "text",
    required: true,
    label: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" },
    placeholder: { en: "Night Tram Quartet", "pt-BR": "Show de jazz", de: "Jazzkonzert", es: "Concierto de jazz", pl: "Koncert jazzowy", it: "Concerto jazz" },
  },
  start: {
    type: "datetime",
    precision: "minute",
    required: true,
    width: "half",
    label: { en: "Starts", "pt-BR": "Começa", de: "Beginn", es: "Empieza", pl: "Początek", it: "Inizio" },
  },
  end: {
    type: "datetime",
    precision: "minute",
    width: "half",
    label: { en: "Ends", "pt-BR": "Termina", de: "Ende", es: "Termina", pl: "Koniec", it: "Fine" },
  },
  allDay: {
    type: "boolean",
    label: { en: "All day", "pt-BR": "Dia todo", de: "Ganztägig", es: "Todo el día", pl: "Cały dzień", it: "Tutto il giorno" },
    help: {
      en: "The poster gives a day but no time",
      "pt-BR": "O cartaz dá o dia, mas não a hora",
      de: "Das Plakat nennt einen Tag, aber keine Uhrzeit",
      es: "El cartel dice el día, pero no la hora",
      pl: "Plakat podaje dzień, ale nie godzinę",
      it: "La locandina dice il giorno ma non l'ora",
    },
  },
  doors: {
    type: "text",
    width: "half",
    label: { en: "Doors open", "pt-BR": "Abertura das portas", de: "Einlass", es: "Apertura de puertas", pl: "Wejście od", it: "Apertura porte" },
    placeholder: "19:00",
  },
  remind: {
    type: "enum",
    options: [...REMIND],
    default: DEFAULT_REMIND,
    width: "half",
    control: "picker",
    label: { en: "Remind me", "pt-BR": "Lembrar-me", de: "Erinnern", es: "Recordármelo", pl: "Przypomnij", it: "Ricordamelo" },
    labels: {
      none: { en: "Don't remind me", "pt-BR": "Não lembrar", de: "Nicht erinnern", es: "No recordar", pl: "Nie przypominaj", it: "Non ricordare" },
      "at start": { en: "When it starts", "pt-BR": "Quando começar", de: "Zum Beginn", es: "Al empezar", pl: "Gdy się zacznie", it: "All'inizio" },
      "1 hour before": { en: "1 hour before", "pt-BR": "1 hora antes", de: "1 Stunde vorher", es: "1 hora antes", pl: "Godzinę przed", it: "1 ora prima" },
      "3 hours before": { en: "3 hours before", "pt-BR": "3 horas antes", de: "3 Stunden vorher", es: "3 horas antes", pl: "3 godziny przed", it: "3 ore prima" },
      "1 day before": { en: "1 day before", "pt-BR": "1 dia antes", de: "1 Tag vorher", es: "1 día antes", pl: "Dzień przed", it: "1 giorno prima" },
      "1 week before": { en: "1 week before", "pt-BR": "1 semana antes", de: "1 Woche vorher", es: "1 semana antes", pl: "Tydzień przed", it: "1 settimana prima" },
    },
  },
  venue: {
    type: "text",
    label: { en: "Venue", "pt-BR": "Local", de: "Ort", es: "Lugar", pl: "Miejsce", it: "Locale" },
    placeholder: { en: "The Lantern Room", "pt-BR": "Teatro Municipal", de: "Stadthalle", es: "Sala Apolo", pl: "Klub Pardon, To Tu", it: "Teatro Comunale" },
  },
  address: {
    type: "text",
    label: { en: "Address", "pt-BR": "Endereço", de: "Adresse", es: "Dirección", pl: "Adres", it: "Indirizzo" },
  },
  price: {
    type: "text",
    width: "half",
    label: { en: "Price", "pt-BR": "Preço", de: "Preis", es: "Precio", pl: "Cena", it: "Prezzo" },
    placeholder: { en: "Free, 12 €…", "pt-BR": "Grátis, R$ 40…", de: "Frei, 12 €…", es: "Gratis, 12 €…", pl: "Wstęp wolny, 40 zł…", it: "Gratis, 12 €…" },
  },
  link: {
    type: "url",
    width: "half",
    label: { en: "Tickets or website", "pt-BR": "Ingressos ou site", de: "Tickets oder Website", es: "Entradas o web", pl: "Bilety lub strona", it: "Biglietti o sito" },
  },
  description: {
    type: "text",
    multiline: true,
    label: { en: "About it", "pt-BR": "Sobre", de: "Worum es geht", es: "De qué va", pl: "O wydarzeniu", it: "Di cosa si tratta" },
  },
  poster: {
    type: "media",
    accept: "image",
    label: { en: "Poster", "pt-BR": "Cartaz", de: "Plakat", es: "Cartel", pl: "Plakat", it: "Locandina" },
  },
} satisfies Record<string, Field>;

/** The confirm form: every field but the poster, which is the photo just read. */
export const FORM_FIELDS: Record<string, Field> = Object.fromEntries(Object.entries(FIELDS).filter(([k]) => k !== "poster"));
