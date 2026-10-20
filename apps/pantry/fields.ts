// An item's fields, and the confirm form a photo's findings are checked in — the same fields, so
// what the form shows is exactly what is saved.

import type { Field } from "potyro";
import { CATEGORIES, PLACES, STATUSES } from "./shelf-life.js";
import { CATEGORY_WORDS, PLACE_WORDS, STATUS_WORDS } from "./words.js";

const name = {
  type: "text",
  required: true,
  label: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" },
  placeholder: { en: "Milk", "pt-BR": "Leite", de: "Milch", es: "Leche", pl: "Mleko", it: "Latte" },
} satisfies Field;

const expires = {
  type: "datetime",
  label: { en: "Use by", "pt-BR": "Usar até", de: "Verbrauchen bis", es: "Usar antes de", pl: "Zużyć do", it: "Da usare entro" },
} satisfies Field;

const guessed = {
  type: "boolean",
  label: { en: "The date is a guess", "pt-BR": "A data é uma estimativa", de: "Das Datum ist geschätzt", es: "La fecha es una estimación", pl: "Data jest szacunkowa", it: "La data è una stima" },
  help: {
    en: "Not printed on it: worked out from the kind of food and where it's kept",
    "pt-BR": "Não vem impressa: calculada pelo tipo de alimento e onde fica guardado",
    de: "Nicht aufgedruckt: aus der Art des Lebensmittels und dem Lagerort geschätzt",
    es: "No viene impresa: calculada por el tipo de alimento y dónde se guarda",
    pl: "Nie ma jej na opakowaniu: wyliczona z rodzaju jedzenia i miejsca przechowywania",
    it: "Non è stampata: ricavata dal tipo di cibo e da dove è conservato",
  },
} satisfies Field;

const category = {
  type: "enum",
  options: [...CATEGORIES],
  default: "other",
  control: "picker",
  width: "half",
  label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" },
  labels: CATEGORY_WORDS,
  colors: { produce: "green", dairy: "blue", meat: "red", fish: "teal", bakery: "orange", frozen: "purple", dry: "yellow", drinks: "pink", leftovers: "orange", other: "grey" },
} satisfies Field;

const where = {
  type: "enum",
  options: [...PLACES],
  default: "fridge",
  width: "half",
  label: { en: "Kept in", "pt-BR": "Guardado em", de: "Liegt im", es: "Guardado en", pl: "Gdzie", it: "Tenuto in" },
  labels: PLACE_WORDS,
} satisfies Field;

const amount = {
  type: "text",
  width: "half",
  label: { en: "How much", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ile", it: "Quanto" },
  placeholder: { en: "×4, 500 g", "pt-BR": "×4, 500 g", de: "×4, 500 g", es: "×4, 500 g", pl: "×4, 500 g", it: "×4, 500 g" },
} satisfies Field;

export const FIELDS = {
  name,
  expires,
  guessed,
  category,
  where,
  amount,
  status: {
    type: "enum",
    options: [...STATUSES],
    default: "in",
    label: { en: "Now", "pt-BR": "Agora", de: "Jetzt", es: "Ahora", pl: "Teraz", it: "Ora" },
    labels: STATUS_WORDS,
    colors: { in: "blue", used: "green", wasted: "red" },
  },
  finished: { type: "datetime", hidden: true, label: { en: "Finished", "pt-BR": "Acabou", de: "Erledigt", es: "Terminado", pl: "Skończone", it: "Finito" } },
} satisfies Record<string, Field>;

/**
 * One row of the confirm form: what to check about each thing — its name, its date and whether that is
 * a guess, and its kind. Where it is kept and how much ride along unseen (the photo said, or the usual
 * place for that kind of food) and can be changed on the item afterwards: a card per thing stays short
 * enough to check a whole shelf on a phone.
 */
export const ROW_FIELDS: Record<string, Field> = { name, expires, guessed, category };
