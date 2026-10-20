// Add from a photo: a photo in, items the person has checked out. Everything a person meets on the
// way is here — the choice of photo, the reading, the honest failures, the confirm form — and every
// step reaches the device only through ctx (the camera, the AI, the form, the store).
//
// What leaves the device is the photo and the instructions, nothing else: no record is passed to the
// AI (docs/23).

import type { Ctx, MediaRef, Words } from "potyro";
import { ROW_FIELDS } from "./fields.js";
import { finishRow, instructions, SHELF, toDrafts, type Draft, type ShelfAnswer } from "./reading.js";
import { sampleReading, sampleShelfSvg } from "./sample.js";
import { leftText } from "./words.js";

export const W = {
  sheetTitle: { en: "Add from a photo", "pt-BR": "Adicionar por foto", de: "Per Foto hinzufügen", es: "Añadir con una foto", pl: "Dodaj ze zdjęcia", it: "Aggiungi da una foto" },
  camera: { en: "Take a photo", "pt-BR": "Tirar uma foto", de: "Foto aufnehmen", es: "Hacer una foto", pl: "Zrób zdjęcie", it: "Scatta una foto" },
  cameraDetail: {
    en: "A fridge shelf, the shopping on the table, or a receipt",
    "pt-BR": "Uma prateleira da geladeira, as compras na mesa ou um recibo",
    de: "Ein Kühlschrankfach, der Einkauf auf dem Tisch oder ein Kassenbon",
    es: "Un estante de la nevera, la compra en la mesa o un tique",
    pl: "Półka w lodówce, zakupy na stole albo paragon",
    it: "Un ripiano del frigo, la spesa sul tavolo o uno scontrino",
  },
  library: { en: "Choose a photo", "pt-BR": "Escolher uma foto", de: "Foto auswählen", es: "Elegir una foto", pl: "Wybierz zdjęcie", it: "Scegli una foto" },
  sample: { en: "Try it on a sample photo", "pt-BR": "Testar com uma foto de exemplo", de: "Mit einem Beispielfoto ausprobieren", es: "Probar con una foto de ejemplo", pl: "Wypróbuj na przykładowym zdjęciu", it: "Prova con una foto di esempio" },
  sampleDetail: {
    en: "A made-up fridge shelf, read without AI — nothing is sent",
    "pt-BR": "Uma prateleira inventada, lida sem IA — nada é enviado",
    de: "Ein erfundenes Kühlschrankfach, ohne KI gelesen — nichts wird gesendet",
    es: "Un estante inventado, leído sin IA: no se envía nada",
    pl: "Wymyślona półka w lodówce, odczytana bez AI — nic nie jest wysyłane",
    it: "Un ripiano inventato, letto senza IA: non si invia niente",
  },
  manual: { en: "Type it in myself", "pt-BR": "Digitar eu mesmo", de: "Selbst eintippen", es: "Escribirlo yo", pl: "Wpiszę sam", it: "Lo scrivo io" },
  reading: { en: "Reading the photo…", "pt-BR": "Lendo a foto…", de: "Foto wird gelesen…", es: "Leyendo la foto…", pl: "Odczytuję zdjęcie…", it: "Leggo la foto…" },
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
    en: "Closer, with more light, labels facing you",
    "pt-BR": "Mais perto, com mais luz, rótulos de frente",
    de: "Näher, mit mehr Licht, die Etiketten nach vorn",
    es: "Más cerca, con más luz y las etiquetas de frente",
    pl: "Bliżej, przy lepszym świetle, etykietami do przodu",
    it: "Più vicino, con più luce, etichette verso di te",
  },
  noFood: {
    en: "There's no food on this photo",
    "pt-BR": "Não há comida nesta foto",
    de: "Auf diesem Foto sind keine Lebensmittel",
    es: "En esta foto no hay comida",
    pl: "Na tym zdjęciu nie ma jedzenia",
    it: "In questa foto non c'è cibo",
  },
  again: { en: "Take another photo", "pt-BR": "Tirar outra foto", de: "Noch ein Foto aufnehmen", es: "Hacer otra foto", pl: "Zrób kolejne zdjęcie", it: "Scatta un'altra foto" },
  another: { en: "Choose another photo", "pt-BR": "Escolher outra foto", de: "Anderes Foto auswählen", es: "Elegir otra foto", pl: "Wybierz inne zdjęcie", it: "Scegli un'altra foto" },
  check: { en: "Check what was found", "pt-BR": "Confira o que foi encontrado", de: "Prüfe, was gefunden wurde", es: "Revisa lo que se encontró", pl: "Sprawdź, co znaleziono", it: "Controlla cosa è stato trovato" },
  checkSample: {
    en: "Sample shelf — check what was found",
    "pt-BR": "Prateleira de exemplo — confira o que foi encontrado",
    de: "Beispielfach — prüfe, was gefunden wurde",
    es: "Estante de ejemplo: revisa lo que se encontró",
    pl: "Przykładowa półka — sprawdź, co znaleziono",
    it: "Ripiano di esempio: controlla cosa è stato trovato",
  },
  checkManual: { en: "Add to my kitchen", "pt-BR": "Adicionar à minha cozinha", de: "Zu meiner Küche hinzufügen", es: "Añadir a mi cocina", pl: "Dodaj do mojej kuchni", it: "Aggiungi alla mia cucina" },
  items: { en: "Items", "pt-BR": "Itens", de: "Sachen", es: "Productos", pl: "Produkty", it: "Prodotti" },
  itemsHelp: {
    en: "A date marked as a guess wasn't printed on it — change it if you know better. Remove anything that isn't yours.",
    "pt-BR": "Uma data marcada como estimativa não vinha impressa — corrija se souber. Tire o que não for seu.",
    de: "Ein als geschätzt markiertes Datum stand nicht drauf — ändere es, wenn du es besser weißt. Entferne, was nicht dir gehört.",
    es: "Una fecha marcada como estimación no venía impresa: cámbiala si la sabes. Quita lo que no sea tuyo.",
    pl: "Data oznaczona jako szacunkowa nie była nadrukowana — popraw ją, jeśli wiesz lepiej. Usuń to, co nie twoje.",
    it: "Una data segnata come stima non era stampata: cambiala se la conosci. Togli ciò che non è tuo.",
  },
  save: { en: "Add to my kitchen", "pt-BR": "Adicionar à cozinha", de: "In die Küche", es: "Añadir a la cocina", pl: "Dodaj do kuchni", it: "Aggiungi alla cucina" },
  added: {
    en: "{n, plural, one {Added # thing.} other {Added # things.}} First to go: {name} ({left}).",
    "pt-BR": "{n, plural, one {# item adicionado.} other {# itens adicionados.}} O primeiro a vencer: {name} ({left}).",
    de: "{n, plural, one {# Sache hinzugefügt.} other {# Sachen hinzugefügt.}} Zuerst dran: {name} ({left}).",
    es: "{n, plural, one {Añadido # producto.} other {Añadidos # productos.}} Lo primero en caducar: {name} ({left}).",
    pl: "{n, plural, one {Dodano # produkt.} few {Dodano # produkty.} many {Dodano # produktów.} other {Dodano # produktu.}} Najpierw: {name} ({left}).",
    it: "{n, plural, one {Aggiunto # prodotto.} other {Aggiunti # prodotti.}} Il primo a scadere: {name} ({left}).",
  },
} as const;

type Source = "camera" | "library";
type Kind = "photo" | "sample" | "manual";

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
  // No camera here (a desktop without one, or a device that refused it): the file picker.
  const [file] = await ctx.files.import({ folder: "photos", accept: "image/*" });
  if (!file) return null;
  const bytes = await ctx.files.bytes(file);
  const blob = bytes ? new Blob([bytes as BlobPart], { type: file.mime }) : null;
  await ctx.files.remove(file);
  return blob;
}

/** The page action: how the person brings food in. */
export async function addFromPhoto(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet<Source | "sample" | "manual">({
    title: W.sheetTitle,
    items: [
      { id: "camera", label: W.camera, detail: W.cameraDetail, icon: "📷" },
      { id: "library", label: W.library, icon: "🖼️" },
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
      { id: "manual", label: W.manual, icon: "✏️" },
    ],
  });
  if (how === "sample") return trySample(ctx);
  if (how === "manual") return void (await confirmAndSave(ctx, [], null, "manual"));
  if (how === "camera" || how === "library") return readFrom(ctx, how);
}

async function readFrom(ctx: Ctx, from: Source): Promise<void> {
  const ai = ctx.caps.ai;
  if (!ai) return offerInstead(ctx, W.noAi);
  const photo = await takePhoto(ctx, from);
  if (!photo) return;
  const bar = ctx.ui.progress(W.reading);
  let answer: ShelfAnswer;
  try {
    answer = await ai.extract({ image: photo, instructions: instructions(ctx.now()), schema: SHELF });
  } catch (e) {
    // The AI's own words for what went wrong — offline, no key, turned off, too slow — and what else to do.
    return offerInstead(ctx, e instanceof Error && e.message ? e.message : W.noAi);
  } finally {
    bar.done();
  }
  await fromAnswer(ctx, answer, photo, "photo");
}

/** The sample: the shelf drawn for today, read by its fixture rather than by AI. */
async function trySample(ctx: Ctx): Promise<void> {
  const photo = new Blob([sampleShelfSvg(ctx.now(), ctx)], { type: "image/svg+xml" });
  await fromAnswer(ctx, sampleReading(ctx.now(), ctx), photo, "sample");
}

/**
 * A demo link's first look (docs/04 §Demo): the sample shelf, read and kept as it is — what "Try it
 * on a sample photo" shows, without the check — so the link opens on a kitchen, not an empty one.
 */
export async function demo(ctx: Ctx): Promise<void> {
  const today = ctx.now();
  const photo = await ctx.media.put(new Blob([sampleShelfSvg(today, ctx)], { type: "image/svg+xml" }));
  for (const r of toDrafts(sampleReading(today, ctx), today)) await ctx.create("item", { ...r, status: "in", photo });
}

/** Reading cannot happen: say why, and offer what still works. */
async function offerInstead(ctx: Ctx, why: Words): Promise<void> {
  const next = await ctx.ui.sheet<"sample" | "manual">({
    title: why,
    items: [
      { id: "manual", label: W.manual, icon: "✏️" },
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
    ],
  });
  if (next === "sample") return trySample(ctx);
  if (next === "manual") await confirmAndSave(ctx, [], null, "manual");
}

/** What the reading found, as items the person checks — or, when it found none, why, and what next. */
export async function fromAnswer(ctx: Ctx, answer: ShelfAnswer, photo: Blob, kind: Kind): Promise<void> {
  const drafts = answer.kind === "unreadable" ? [] : toDrafts(answer, ctx.now());
  if (!drafts.length) return nothingRead(ctx, answer.kind === "unreadable");
  const ref = await ctx.media.put(photo);
  await confirmAndSave(ctx, drafts, ref, kind);
}

async function nothingRead(ctx: Ctx, blurry: boolean): Promise<void> {
  const next = await ctx.ui.sheet<Source | "manual">({
    title: blurry ? W.blurry : W.noFood,
    items: [
      { id: "camera", label: W.again, ...(blurry ? { detail: W.blurryDetail } : {}), icon: "📷" },
      { id: "library", label: W.another, icon: "🖼️" },
      { id: "manual", label: W.manual, icon: "✏️" },
    ],
  });
  if (next === "manual") return void (await confirmAndSave(ctx, [], null, "manual"));
  if (next) return readFrom(ctx, next);
}

/** The confirm form, opened on what was read; saving it adds every row that has a name. */
async function confirmAndSave(ctx: Ctx, drafts: Draft[], photo: MediaRef | null, kind: Kind): Promise<number> {
  const today = ctx.now();
  const title = kind === "sample" ? W.checkSample : kind === "manual" ? W.checkManual : W.check;
  const answer = await ctx.ui.form<{ items?: Array<Record<string, unknown>> }>({
    title,
    fields: { items: { type: "list", label: W.items, help: W.itemsHelp, of: ROW_FIELDS } },
    initial: { items: kind === "manual" ? [{ where: "fridge", category: "other" }] : drafts.map((d) => ({ ...d })) },
    submit: W.save,
  });
  if (!answer) return 0;
  const rows = (answer.items ?? []).map((r) => finishRow(r, today)).filter((r): r is Draft => r !== null);
  for (const r of rows) await ctx.create("item", { ...r, status: "in", ...(photo ? { photo } : {}) });
  if (rows.length) {
    const first = [...rows].sort((a, b) => a.expires.getTime() - b.expires.getTime())[0]!;
    ctx.ui.toast(ctx.t(W.added, { n: rows.length, name: first.name, left: leftText(first.expires, ctx, today) }));
    ctx.navigate("kitchen");
  }
  return rows.length;
}
