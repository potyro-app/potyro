// The person's language, on the model side (#301): which language Studio and Ask answer in, and which
// language an app's own words are written in.
//
// The system prompts and the generated reference stay English (docs/epic #297). What changes is one
// instruction per turn, built here, saying which language to reply in and which to write the app in.
// For English there is NO instruction at all, so an English turn is byte-for-byte what it was before
// and English eval numbers stay comparable with every earlier run.
//
// Browser-safe and dependency-free: the shell, the agent barrel and the eval harness all import it.

/** The languages Potyro speaks (#297), as BCP-47 tags. */
export const LANGUAGES = ["en", "pt-BR", "de", "es", "pl", "it"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language's name in English, as the model is told it. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  de: "German",
  es: "Spanish",
  pl: "Polish",
  it: "Italian",
};

export function isLanguage(x: unknown): x is Language {
  return typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
}

/**
 * The supported language a BCP-47 tag matches, or null. Matched on the primary subtag, case-blind:
 * `pl-PL` is Polish, `en-GB` English, and any Portuguese (`pt`, `pt-PT`) is Brazilian Portuguese,
 * the only Portuguese there is.
 */
export function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "pt") return "pt-BR";
  return LANGUAGES.find((l) => l === primary) ?? null;
}

/** The first of the device's preferred tags Potyro speaks; English when it speaks none of them. */
export function bestLanguage(tags: ReadonlyArray<string | null | undefined>): Language {
  for (const t of tags) {
    const l = matchLanguage(t);
    if (l) return l;
  }
  return "en";
}

/** Which language a change is said in, and which the app's own words are in. */
export interface TurnLanguage {
  /** The person's language: what the reply is written in. Absent means English. */
  person?: Language;
  /**
   * The language of the app's own words (labels, page titles…): a declared one (#302), or the one
   * `appLanguage` reads off its source. Null or absent when nobody can tell — new words then follow
   * the person's language.
   */
  app?: Language | null;
}

const foreign = (l: Language | null | undefined): l is Exclude<Language, "en"> => Boolean(l && l !== "en");

/** What "the app's words" covers — said the same way in every instruction. */
const APP_WORDS = "every label, page title, option, help text, placeholder and message the person sees";
const KEEP_CODE = "Keep ids, field keys and code identifiers in English.";
const LABEL_EVERY_FIELD = "Give every field a `label`, because a field without one shows its key.";

/**
 * The create turn's language line, or null for English (nothing is added).
 * The QUESTION: marker stays as written: `questionIn` (prompt.ts) reads it.
 */
export function createLanguageInstruction(language: Language | undefined): string | null {
  if (!foreign(language)) return null;
  const name = LANGUAGE_NAMES[language];
  return [
    `LANGUAGE: the person speaks ${name}. Write the app in ${name}: its name and ${APP_WORDS}. ${LABEL_EVERY_FIELD}`,
    KEEP_CODE,
    `If you ask a QUESTION: instead, keep the marker exactly as written and ask the question in ${name}.`,
  ].join(" ");
}

/**
 * The language line for a change (modify, repair, fix), or null when both the person and the app
 * are English (nothing is added).
 *
 * The person is answered in their language; the app's NEW words follow the app's existing language,
 * so a Polish app stays Polish for an English speaker and an English app stays English for a Polish
 * one — unless the person asks otherwise. The markers the loops parse (ASK:, NOT-IN-APP:, Not done:)
 * stay English: they are how a reply is read.
 */
export function changeLanguageInstruction(l: TurnLanguage | undefined): string | null {
  const person = l?.person;
  const app = l?.app ?? person;
  if (!foreign(person) && !foreign(app)) return null;
  const parts: string[] = ["LANGUAGE:"];
  if (foreign(person)) {
    const name = LANGUAGE_NAMES[person];
    parts.push(
      `reply to the person in ${name}: the explanation before your edits, an ASK: question, the lines under Not done: and a NOT-IN-APP: reason.`,
      "Keep those markers exactly as written, in English.",
    );
  }
  const appName = LANGUAGE_NAMES[app ?? "en"];
  parts.push(
    `The app's own words are in ${appName}: write ${APP_WORDS} that you add or change in ${appName} too` +
      `${app && app !== "en" ? " (give every new field a `label`)" : ""}, unless the person asks for another language.`,
    KEEP_CODE,
  );
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------------
// Reading which language a text is in.
//
// A heuristic, and a deliberately small one: a few dozen words per language that are common in apps
// and NOT shared with another of the six (no "lista", "data", "foto", "status", "total"), plus the
// letters only one of them uses (ą ł ż… for Polish, ã õ ç for Portuguese, ñ for Spanish, ä ö ü ß for
// German). Its limits, which matter when reading an eval number:
//   - a short label with no listed word and no telling letter ("Link", "Website", "Status", "Kcal")
//     is unknown, not wrong — such labels are left out of the rate rather than counted either way;
//   - Italian has the weakest letters (à è ì ò ù, which Italian labels often lack), so it leans on
//     words alone;
//   - names and proper nouns read as whatever they happen to look like.
// Good enough to tell "the model wrote Polish" from "the model wrote English"; never a grammar check.
// ---------------------------------------------------------------------------------------------------

const WORDS: Readonly<Record<Language, readonly string[]>> = {
  en: [
    "the", "of", "and", "to", "for", "on", "with", "my", "your", "all", "notes", "add", "new", "done", "page", "rating",
    "room", "time", "day", "days", "today", "week", "month", "year", "place", "places", "plant", "plants", "recipe",
    "recipes", "session", "sessions", "exercise", "exercises", "title", "description", "last", "next", "watered",
    "watering", "every", "how", "many", "when", "where", "which", "is", "are", "this", "that", "open", "hours", "photo",
    "favourite", "favorite", "favourites", "favorites", "amount", "cost", "price", "category", "type", "due", "task",
    "tasks", "items", "item", "book", "books", "visited", "yes", "show", "only", "need", "needs", "from", "by", "date",
    "list", "address", "reminder", "phone", "number", "notes", "note", "kind", "who", "what", "opening", "website",
  ],
  pl: [
    "na", "z", "ze", "w", "we", "dla", "się", "jest", "nie", "tak", "moje", "moja", "mój", "nazwa", "notatki", "notatka", "dodaj", "nowy", "nowa",
    "nowe", "strona", "ocena", "pokój", "czas", "dzień", "dni", "dzisiaj", "dziś", "tydzień", "miesiąc", "rok", "miejsce",
    "miejsca", "roślina", "rośliny", "przepis", "przepisy", "sesja", "sesje", "ćwiczenie", "ćwiczenia", "tytuł", "opis",
    "ostatni", "ostatnie", "następne", "podlewanie", "każdy", "każda", "ile", "kiedy", "gdzie", "który", "która",
    "godziny", "otwarcia", "zdjęcie", "ulubione", "ulubiony", "kwota", "koszt", "cena", "kategoria", "koniec", "termin",
    "zadanie", "zadania", "książka", "książki", "odwiedzone", "pokaż", "tylko", "od", "przez", "oraz", "lub", "czy", "jak",
    "co", "wszystkie", "pomieszczenie", "adres", "uwagi", "gwiazdki", "wizyta", "przypomnienie", "zrobione", "gotowe",
    "numer", "telefonu", "rodzaj", "pokoju", "internetowa", "notatki", "mieszka", "domu", "zrobić",
  ],
  "pt-BR": [
    "com", "em", "os", "um", "uma", "meu", "minha", "meus", "minhas", "anotações", "adicionar", "novo", "avaliação",
    "quarto", "cômodo", "dia", "dias", "hoje", "mês", "ano", "receita", "receitas", "sessão", "sessões", "exercício",
    "exercícios", "descrição", "última", "próxima", "rega", "quantos", "qual", "horário", "horários", "funcionamento",
    "favorita", "valor", "custo", "preço", "fim", "prazo", "tarefa", "tarefas", "itens", "livro", "livros", "sim",
    "apenas", "só", "precisa", "precisam", "não", "é", "são", "você", "seu", "sua", "endereço", "lembrete", "feito",
    "concluído", "nome", "anotação", "casa", "fica", "onde", "telefone", "tipo", "local", "das", "dos", "da", "no", "na",
  ],
  de: [
    "der", "die", "das", "und", "ist", "mit", "für", "von", "zu", "auf", "ein", "eine", "mein", "meine", "neu", "neue",
    "hinzufügen", "notizen", "notiz", "seite", "bewertung", "zimmer", "raum", "zeit", "tag", "tage", "heute", "woche",
    "monat", "jahr", "ort", "orte", "pflanze", "pflanzen", "rezept", "rezepte", "sitzung", "übung", "übungen", "titel",
    "beschreibung", "letzte", "nächste", "gegossen", "jede", "jeder", "wie", "wann", "wo", "welche", "öffnungszeiten",
    "favoriten", "betrag", "kosten", "preis", "kategorie", "ende", "fällig", "aufgabe", "aufgaben", "buch", "bücher",
    "besucht", "nein", "zeigen", "nur", "braucht", "alle", "datum", "adresse", "erinnerung", "erledigt", "art",
  ],
  es: [
    "el", "la", "los", "las", "en", "nombre", "fecha", "añadir", "agregar", "nueva", "nuevo", "valoración", "calificación",
    "habitación", "cuarto", "tiempo", "día", "días", "hoy", "mes", "año", "receta", "recetas", "sesión", "sesiones",
    "ejercicio", "ejercicios", "descripción", "siguiente", "riego", "cuántos", "cuándo", "dónde", "cuál", "horario",
    "favoritas", "importe", "coste", "precio", "vencimiento", "tarea", "tareas", "artículos", "libro", "libros", "sí",
    "necesita", "todas", "dirección", "recordatorio", "hecho", "hecha", "es", "teléfono", "lugares", "y",
  ],
  it: [
    "il", "gli", "della", "delle", "dei", "di", "mio", "mia", "miei", "nuovo", "nuova", "aggiungi", "appunti", "pagina",
    "valutazione", "voto", "stanza", "ore", "giorno", "giorni", "oggi", "settimana", "mese", "anno", "luogo", "luoghi",
    "posto", "posti", "pianta", "piante", "ricetta", "ricette", "sessione", "sessioni", "esercizio", "esercizi", "titolo",
    "descrizione", "ultimo", "prossimo", "prossima", "annaffiatura", "ogni", "quanti", "dove", "quale", "orari", "orario",
    "preferiti", "preferito", "importo", "prezzo", "scadenza", "attività", "compito", "compiti", "libri", "visitato", "sì",
    "mostra", "serve", "tutti", "tutte", "indirizzo", "promemoria", "fatto", "è", "sono", "non", "che", "nome", "telefono",
  ],
};

/** Letters only one of the six writes. */
const LETTERS: Readonly<Partial<Record<Language, RegExp>>> = {
  pl: /[ąćęłńśźż]/giu,
  "pt-BR": /[ãõçâêô]/giu,
  es: /[ñ¿¡]/giu,
  de: /[äöüß]/giu,
  it: /[èìòù]/giu,
};

/** Words that two of the lexicons above share are worth nothing: counted once per language, they cancel. */
const LEXICON: ReadonlyMap<string, Language[]> = (() => {
  const m = new Map<string, Language[]>();
  for (const l of LANGUAGES) for (const w of new Set(WORDS[l])) m.set(w, [...(m.get(w) ?? []), l]);
  return m;
})();

/** How strongly a text reads as each language: listed words, plus each telling letter. */
export function languageScores(text: string): Record<Language, number> {
  const scores = Object.fromEntries(LANGUAGES.map((l) => [l, 0])) as Record<Language, number>;
  const lower = text.toLowerCase();
  for (const token of lower.match(/\p{L}+/gu) ?? []) {
    const langs = LEXICON.get(token);
    if (langs?.length === 1) scores[langs[0]!] += 1;
  }
  for (const l of LANGUAGES) {
    const re = LETTERS[l];
    if (re) scores[l] += (lower.match(re) ?? []).length;
  }
  return scores;
}

/** The language a text reads as, or null when it says too little to tell (or two languages tie). */
export function classifyText(text: string): Language | null {
  const ranked = Object.entries(languageScores(text)).sort((a, b) => b[1] - a[1]) as Array<[Language, number]>;
  const [first, second] = ranked;
  if (!first || first[1] < 1 || (second && second[1] === first[1])) return null;
  return first[0];
}

/**
 * The words of an app the person reads, from its source: the string values of `name`, `label`,
 * `title`, `subtitle`, `help`, `placeholder`, `description` and `emptyText`, and enum `options`.
 * Read from the text rather than a loaded definition, so it works on a candidate that does not load
 * and costs no bundling — and it misses words built at run time (a computed title), which is the
 * price of that.
 */
export function userFacingStrings(source: string): string[] {
  const out: string[] = [];
  const keyed = /\b(?:name|label|title|subtitle|help|placeholder|description|emptyText)\s*:\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const m of source.matchAll(keyed)) if (m[2]!.trim() && !m[2]!.includes("${")) out.push(m[2]!);
  for (const m of source.matchAll(/\boptions\s*:\s*\[([^\]]*)\]/g)) {
    for (const s of m[1]!.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (s[2]!.trim()) out.push(s[2]!);
  }
  return out;
}

/** The language an app's own words are in, read off its source; null when they say too little. */
export function appLanguage(source: string): Language | null {
  // A declared `language: "en"` (#302) says it outright — and an app in several languages has words
  // in all of them, which no reading of its strings could settle.
  const declared = /(?:^|[\s{,])language:\s*["']([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)["']/m.exec(source)?.[1];
  const matched = matchLanguage(declared);
  if (matched) return matched;
  return classifyText(userFacingStrings(source).join("\n"));
}
