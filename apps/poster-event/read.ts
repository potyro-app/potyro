// Read a poster: a photo in, an event the person has checked out. Everything a person meets on the
// way is here — the choice of photo, the reading, the honest failures, the confirm form — and every
// step reaches the device only through ctx (the camera, the AI, the form, the store).
//
// What leaves the device is the photo and the instructions below, nothing else: no record is ever
// passed to the AI (docs/23).

import type { AiValue, Ctx, MediaRef, Resolved } from "potyro";
import { isOver, toDraft, type Draft, type PosterReading } from "./dates.js";
import { FORM_FIELDS } from "./fields.js";
import { DEFAULT_REMIND, remindAt } from "./calendar.js";
import { samplePosterSvg, sampleReading } from "./sample.js";
import { reminderText, whenText } from "./words.js";

/** What a poster is read into. Checked by the host before the app sees it: a missing text is `null`. */
export const POSTER = {
  legible: "boolean",
  events: [
    {
      title: "text",
      dateText: "text?",
      date: "date?",
      endDate: "date?",
      yearPrinted: "boolean",
      start: "text?",
      end: "text?",
      doors: "text?",
      timezone: "text?",
      venue: "text?",
      address: "text?",
      price: "text?",
      link: "text?",
      description: "text?",
    },
  ],
} as const;

export type PosterAnswer = AiValue<typeof POSTER>;

/** What the model is told. Model-facing, so English (#297); the date of today, so it can place a date without a year. */
export function instructions(today: Date): string {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return [
    "A photo of a poster, flyer, ticket or invitation for an event. Read the event(s) off it.",
    "legible: false when the photo is too blurry, dark, cropped or small to read its text; then events may be empty.",
    "events: one entry per separate event. A line-up of different nights is several events; one event over several days is one entry with date and endDate. Not an event at all (a menu, a photo of a person): no entries.",
    "title: the event's name as printed (a band, a play, a party), not the venue.",
    "dateText: the date exactly as printed, weekday included. date: the first day as YYYY-MM-DD; endDate: the last day, only for several days.",
    `yearPrinted: whether a year is printed. Today is ${iso}; when no year is printed, give the year in which the date is next to come.`,
    "start: when it starts, as HH:MM on a 24-hour clock (8pm is 20:00). end: when it ends, if printed. doors: when doors open, if printed apart from the start (\"Doors 19:00 / Start 20:00\").",
    "timezone: only if printed beside the time (CET, UTC+2, ET); otherwise null.",
    "venue: the place's name. address: the street address, as printed. price: as printed, with its currency (\"12 € / 8 € students\", \"Free\").",
    "link: a web address or the text of a QR code if one is printed or readable. description: one or two sentences of what it is, from the poster's own words.",
    "Copy names as written, in the poster's language. Never invent what is not on it: leave it null.",
  ].join("\n");
}

// ---- words the flow says ----

const W = {
  sheetTitle: { en: "Read a poster", "pt-BR": "Ler um cartaz", de: "Plakat lesen", es: "Leer un cartel", pl: "Odczytaj plakat", it: "Leggi una locandina" },
  camera: { en: "Take a photo", "pt-BR": "Tirar uma foto", de: "Foto aufnehmen", es: "Hacer una foto", pl: "Zrób zdjęcie", it: "Scatta una foto" },
  cameraDetail: {
    en: "Fill the frame with the poster, flat on",
    "pt-BR": "Enquadre o cartaz inteiro, de frente",
    de: "Das ganze Plakat ins Bild, gerade von vorn",
    es: "Que el cartel llene la foto, de frente",
    pl: "Cały plakat w kadrze, na wprost",
    it: "Tutta la locandina nell'inquadratura, di fronte",
  },
  library: { en: "Choose a photo", "pt-BR": "Escolher uma foto", de: "Foto auswählen", es: "Elegir una foto", pl: "Wybierz zdjęcie", it: "Scegli una foto" },
  libraryDetail: {
    en: "A poster, flyer, ticket or invitation you already have",
    "pt-BR": "Um cartaz, folheto, ingresso ou convite que você já tem",
    de: "Ein Plakat, Flyer, Ticket oder eine Einladung, die du schon hast",
    es: "Un cartel, folleto, entrada o invitación que ya tengas",
    pl: "Plakat, ulotka, bilet albo zaproszenie, które już masz",
    it: "Una locandina, un volantino, un biglietto o un invito che hai già",
  },
  sample: { en: "Try it on a sample poster", "pt-BR": "Testar com um cartaz de exemplo", de: "Mit einem Beispielplakat ausprobieren", es: "Probar con un cartel de ejemplo", pl: "Wypróbuj na przykładowym plakacie", it: "Prova con una locandina di esempio" },
  sampleDetail: {
    en: "A made-up poster, read without AI — nothing is sent",
    "pt-BR": "Um cartaz inventado, lido sem IA — nada é enviado",
    de: "Ein erfundenes Plakat, ohne KI gelesen — nichts wird gesendet",
    es: "Un cartel inventado, leído sin IA: no se envía nada",
    pl: "Wymyślony plakat, odczytany bez AI — nic nie jest wysyłane",
    it: "Una locandina inventata, letta senza IA: non si invia niente",
  },
  manual: { en: "Type it in myself", "pt-BR": "Digitar eu mesmo", de: "Selbst eintippen", es: "Escribirlo yo", pl: "Wpiszę sam", it: "Lo scrivo io" },
  reading: { en: "Reading the poster…", "pt-BR": "Lendo o cartaz…", de: "Plakat wird gelesen…", es: "Leyendo el cartel…", pl: "Odczytuję plakat…", it: "Leggo la locandina…" },
  noAi: {
    en: "AI isn't available here, so a photo can't be read",
    "pt-BR": "A IA não está disponível aqui, então a foto não pode ser lida",
    de: "Hier gibt es keine KI, also kann das Foto nicht gelesen werden",
    es: "Aquí no hay IA, así que la foto no se puede leer",
    pl: "AI nie jest tu dostępne, więc nie da się odczytać zdjęcia",
    it: "Qui l'IA non è disponibile, quindi la foto non si può leggere",
  },
  blurry: {
    en: "The photo is too blurry to read",
    "pt-BR": "A foto está tremida demais para ler",
    de: "Das Foto ist zu unscharf zum Lesen",
    es: "La foto está demasiado borrosa para leerla",
    pl: "Zdjęcie jest zbyt nieostre, żeby je odczytać",
    it: "La foto è troppo sfocata per leggerla",
  },
  blurryDetail: {
    en: "Closer, flat on, with more light",
    "pt-BR": "Mais perto, de frente, com mais luz",
    de: "Näher, gerade von vorn, mit mehr Licht",
    es: "Más cerca, de frente y con más luz",
    pl: "Bliżej, na wprost, przy lepszym świetle",
    it: "Più vicino, di fronte, con più luce",
  },
  noEvent: {
    en: "There's no event on this photo",
    "pt-BR": "Não há nenhum evento nesta foto",
    de: "Auf diesem Foto ist kein Termin zu finden",
    es: "No hay ningún evento en esta foto",
    pl: "Na tym zdjęciu nie ma żadnego wydarzenia",
    it: "In questa foto non c'è nessun evento",
  },
  again: { en: "Take another photo", "pt-BR": "Tirar outra foto", de: "Noch ein Foto aufnehmen", es: "Hacer otra foto", pl: "Zrób kolejne zdjęcie", it: "Scatta un'altra foto" },
  another: { en: "Choose another photo", "pt-BR": "Escolher outra foto", de: "Anderes Foto auswählen", es: "Elegir otra foto", pl: "Wybierz inne zdjęcie", it: "Scegli un'altra foto" },
  several: {
    en: "{n, plural, other {This poster has # events}}",
    "pt-BR": "{n, plural, one {Este cartaz tem # evento} other {Este cartaz tem # eventos}}",
    de: "{n, plural, one {Auf diesem Plakat steht # Termin} other {Auf diesem Plakat stehen # Termine}}",
    es: "{n, plural, one {Este cartel tiene # evento} other {Este cartel tiene # eventos}}",
    pl: "{n, plural, one {Na plakacie jest # wydarzenie} few {Na plakacie są # wydarzenia} many {Na plakacie jest # wydarzeń} other {Na plakacie jest # wydarzenia}}",
    it: "{n, plural, one {Questa locandina ha # evento} other {Questa locandina ha # eventi}}",
  },
  all: {
    en: "{n, plural, other {All #, one after another}}",
    "pt-BR": "{n, plural, other {Todos os #, um de cada vez}}",
    de: "{n, plural, other {Alle #, einen nach dem anderen}}",
    es: "{n, plural, other {Los #, uno detrás de otro}}",
    pl: "{n, plural, few {Wszystkie #, po kolei} many {Wszystkie #, po kolei} other {Wszystkie #, po kolei}}",
    it: "{n, plural, other {Tutti e #, uno alla volta}}",
  },
  noDateYet: { en: "No date found", "pt-BR": "Nenhuma data encontrada", de: "Kein Datum gefunden", es: "No se encontró fecha", pl: "Nie znaleziono daty", it: "Nessuna data trovata" },
  check: { en: "Check the event", "pt-BR": "Confira o evento", de: "Termin prüfen", es: "Revisa el evento", pl: "Sprawdź wydarzenie", it: "Controlla l'evento" },
  checkSample: {
    en: "Sample poster — check the event",
    "pt-BR": "Cartaz de exemplo — confira o evento",
    de: "Beispielplakat — Termin prüfen",
    es: "Cartel de ejemplo: revisa el evento",
    pl: "Przykładowy plakat — sprawdź wydarzenie",
    it: "Locandina di esempio: controlla l'evento",
  },
  checkNoDate: {
    en: "Add the date — it isn't on the poster",
    "pt-BR": "Adicione a data — ela não está no cartaz",
    de: "Datum ergänzen — es steht nicht auf dem Plakat",
    es: "Añade la fecha: no está en el cartel",
    pl: "Dodaj datę — nie ma jej na plakacie",
    it: "Aggiungi la data: non è sulla locandina",
  },
  checkPast: {
    en: "Check the date — this has already happened",
    "pt-BR": "Confira a data — isto já aconteceu",
    de: "Datum prüfen — das ist schon vorbei",
    es: "Revisa la fecha: esto ya ha pasado",
    pl: "Sprawdź datę — to już się odbyło",
    it: "Controlla la data: è già passato",
  },
  checkManual: { en: "New event", "pt-BR": "Novo evento", de: "Neuer Termin", es: "Nuevo evento", pl: "Nowe wydarzenie", it: "Nuovo evento" },
  save: { en: "Save event", "pt-BR": "Salvar evento", de: "Termin speichern", es: "Guardar evento", pl: "Zapisz wydarzenie", it: "Salva evento" },
  savedRemind: { en: "Saved. Reminder: {when}.", "pt-BR": "Salvo. Lembrete: {when}.", de: "Gespeichert. Erinnerung: {when}.", es: "Guardado. Recordatorio: {when}.", pl: "Zapisano. Przypomnienie: {when}.", it: "Salvato. Promemoria: {when}." },
  saved: { en: "Saved.", "pt-BR": "Salvo.", de: "Gespeichert.", es: "Guardado.", pl: "Zapisano.", it: "Salvato." },
  savedPast: { en: "Saved under Past.", "pt-BR": "Salvo em Passados.", de: "Unter Vorbei gespeichert.", es: "Guardado en Pasados.", pl: "Zapisano w Minionych.", it: "Salvato in Passati." },
} as const;

// ---- the photo ----

type Source = "camera" | "library";

/** One photo, from the camera or the library — or null when the person closed the picker. */
async function takePhoto(ctx: Ctx, from: Source): Promise<Blob | null> {
  if (ctx.caps.camera) {
    try {
      return await ctx.caps.camera.capture({ source: from });
    } catch (e) {
      // Closing the camera or the library is an answer — "not now" — not a failure to report.
      if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
      throw e;
    }
  }
  // No camera here (a desktop browser without one, or a device that refused it): the file picker.
  const [file] = await ctx.files.import({ folder: "posters", accept: "image/*" });
  if (!file) return null;
  const bytes = await ctx.files.bytes(file);
  const blob = bytes ? new Blob([bytes as BlobPart], { type: file.mime }) : null;
  await ctx.files.remove(file);
  return blob;
}

// ---- the flow ----

/** The page action: how the person brings a poster in. */
export async function readPoster(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet<"camera" | "library" | "sample" | "manual">({
    title: W.sheetTitle,
    items: [
      { id: "camera", label: W.camera, detail: W.cameraDetail, icon: "📷" },
      { id: "library", label: W.library, detail: W.libraryDetail, icon: "🖼️" },
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
      { id: "manual", label: W.manual, icon: "✏️" },
    ],
  });
  if (how === "sample") return trySample(ctx);
  if (how === "manual") return void (await confirmAndSave(ctx, emptyDraft(), null, "manual"));
  if (how === "camera" || how === "library") return readFrom(ctx, how);
}

async function readFrom(ctx: Ctx, from: Source): Promise<void> {
  const ai = ctx.caps.ai;
  if (!ai) return offerWithoutAi(ctx);
  const photo = await takePhoto(ctx, from);
  if (!photo) return;
  const bar = ctx.ui.progress(W.reading);
  let answer: PosterAnswer;
  try {
    answer = await ai.extract({ image: photo, instructions: instructions(ctx.now()), schema: POSTER });
  } finally {
    bar.done();
  }
  await fromAnswer(ctx, answer, photo, "photo");
}

/** The sample: the poster drawn for the Friday after next, read by its fixture rather than by AI. */
async function trySample(ctx: Ctx): Promise<void> {
  const svg = samplePosterSvg(ctx.now(), ctx);
  const poster = new Blob([svg], { type: "image/svg+xml" });
  await fromAnswer(ctx, { legible: true, events: [sampleReading(ctx.now(), ctx)] }, poster, "sample");
}

async function offerWithoutAi(ctx: Ctx): Promise<void> {
  const next = await ctx.ui.sheet<"sample" | "manual">({
    title: W.noAi,
    items: [
      { id: "manual", label: W.manual, icon: "✏️" },
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
    ],
  });
  if (next === "sample") return trySample(ctx);
  if (next === "manual") await confirmAndSave(ctx, emptyDraft(), null, "manual");
}

type Kind = "photo" | "sample" | "manual";

/** What the reading found, as events the person checks — or, when it found none, why, and what next. */
export async function fromAnswer(ctx: Ctx, answer: PosterAnswer, photo: Blob, kind: Kind): Promise<void> {
  const events = (answer.events as PosterReading[]).filter((e) => (e.title ?? "").trim() || e.date);
  if (!events.length) return nothingRead(ctx, answer.legible);
  const now = ctx.now();
  const drafts = events.map((e) => toDraft(e, now));
  const chosen = drafts.length === 1 ? drafts : await pickEvents(ctx, drafts);
  if (!chosen?.length) return;
  const poster = await ctx.media.put(photo);
  let last: Resolved | null = null;
  for (const d of chosen) last = (await confirmAndSave(ctx, d, poster, kind)) ?? last;
  if (last && chosen.length === 1) ctx.navigate("event", { eventId: String(last.id) });
}

async function nothingRead(ctx: Ctx, legible: boolean): Promise<void> {
  const next = await ctx.ui.sheet<Source | "manual">({
    title: legible ? W.noEvent : W.blurry,
    items: [
      { id: "camera", label: W.again, detail: legible ? undefined : W.blurryDetail, icon: "📷" },
      { id: "library", label: W.another, icon: "🖼️" },
      { id: "manual", label: W.manual, icon: "✏️" },
    ],
  });
  if (next === "manual") return void (await confirmAndSave(ctx, emptyDraft(), null, "manual"));
  if (next) return readFrom(ctx, next);
}

/** Several events on one poster: the person picks one, or all of them in turn. */
async function pickEvents(ctx: Ctx, drafts: Draft[]): Promise<Draft[] | null> {
  const today = ctx.now();
  const pick = await ctx.ui.sheet<number>({
    title: ctx.t(W.several, { n: drafts.length }),
    items: [
      ...drafts.map((d, i) => ({ id: i, label: d.title || "—", detail: whenText(d, ctx, today) || ctx.t(W.noDateYet), icon: "🎟️" })),
      { id: -1, label: ctx.t(W.all, { n: drafts.length }), icon: "🗓️" },
    ],
  });
  if (pick === null) return null;
  return pick === -1 ? drafts : [drafts[pick]!];
}

const emptyDraft = (): Draft => ({ title: "", start: null, end: null, allDay: false, doors: null, venue: null, address: null, price: null, link: null, description: null });

/** The confirm form, opened on what was read; saving it makes the event. Null when the person cancelled. */
async function confirmAndSave(ctx: Ctx, d: Draft, poster: MediaRef | null, kind: Kind): Promise<Resolved | null> {
  const now = ctx.now();
  const title =
    kind === "manual" ? W.checkManual : kind === "sample" ? W.checkSample : !d.start ? W.checkNoDate : isOver(d, now) ? W.checkPast : W.check;
  const initial: Record<string, unknown> = { remind: DEFAULT_REMIND, allDay: d.allDay };
  for (const k of ["title", "start", "end", "doors", "venue", "address", "price", "link", "description"] as const) {
    if (d[k] !== null && d[k] !== "") initial[k] = d[k];
  }
  const answer = await ctx.ui.form<Record<string, unknown>>({ title, fields: FORM_FIELDS, initial, submit: W.save });
  if (!answer) return null;
  const rec = await ctx.create("event", { ...answer, ...(poster ? { poster } : {}) });
  ctx.ui.toast(saidSaved(ctx, rec));
  return rec;
}

function saidSaved(ctx: Ctx, rec: Resolved): string {
  const now = ctx.now();
  if (isOver(rec, now)) return ctx.t(W.savedPast);
  const at = remindAt(rec, now);
  return at && at.getTime() > now.getTime() ? ctx.t(W.savedRemind, { when: reminderText(rec, ctx, now) }) : ctx.t(W.saved);
}

