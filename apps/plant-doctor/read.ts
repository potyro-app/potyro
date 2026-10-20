// Looking at a plant: a photo in, a finding the person has read, and — for a new plant — a care plan
// they have checked. A check-up compares today's photo with the last one. Every step reaches the
// device only through ctx (the camera, the AI, the dialogs, the store).
//
// What leaves the device: the photo and the instructions; on a check-up, also the earlier photo and
// the one line the app kept about it (its date and what it seemed to be). Nothing else (docs/23).

import type { Ctx, MediaRef, Resolved, Words } from "potyro";
import { nextCheckup, startOfDay, toDate, WATER_DAYS, type Light } from "./care.js";
import { SAVE_FIELDS } from "./fields.js";
import { bullets, DIAGNOSIS, firstInstructions, followUpInstructions, toFinding, type DiagnosisAnswer, type Finding } from "./reading.js";
import { samplePlantSvg, sampleReading } from "./sample.js";
import { checkText, expertText, headline, KIND_WORDS, plantLine, trendText, waterText } from "./words.js";

export const W = {
  sheetTitle: { en: "Check a plant", "pt-BR": "Examinar uma planta", de: "Pflanze ansehen", es: "Revisar una planta", pl: "Obejrzyj roślinę", it: "Controlla una pianta" },
  checkupTitle: { en: "A check-up photo", "pt-BR": "Uma foto de revisão", de: "Ein Check-Foto", es: "Una foto de revisión", pl: "Zdjęcie kontrolne", it: "Una foto di controllo" },
  camera: { en: "Take a photo", "pt-BR": "Tirar uma foto", de: "Foto aufnehmen", es: "Hacer una foto", pl: "Zrób zdjęcie", it: "Scatta una foto" },
  cameraDetail: {
    en: "The whole plant in daylight, or close up on a sick leaf",
    "pt-BR": "A planta inteira com luz do dia, ou de perto numa folha doente",
    de: "Die ganze Pflanze bei Tageslicht, oder nah an einem kranken Blatt",
    es: "La planta entera con luz de día, o de cerca una hoja enferma",
    pl: "Cała roślina w świetle dnia albo z bliska chory liść",
    it: "Tutta la pianta alla luce del giorno, o da vicino una foglia malata",
  },
  library: { en: "Choose a photo", "pt-BR": "Escolher uma foto", de: "Foto auswählen", es: "Elegir una foto", pl: "Wybierz zdjęcie", it: "Scegli una foto" },
  sample: { en: "Try it on a sample photo", "pt-BR": "Testar com uma foto de exemplo", de: "Mit einem Beispielfoto ausprobieren", es: "Probar con una foto de ejemplo", pl: "Wypróbuj na przykładowym zdjęciu", it: "Prova con una foto di esempio" },
  sampleDetail: {
    en: "A made-up plant, looked at without AI — nothing is sent",
    "pt-BR": "Uma planta inventada, examinada sem IA — nada é enviado",
    de: "Eine erfundene Pflanze, ohne KI angesehen — nichts wird gesendet",
    es: "Una planta inventada, revisada sin IA: no se envía nada",
    pl: "Wymyślona roślina, obejrzana bez AI — nic nie jest wysyłane",
    it: "Una pianta inventata, guardata senza IA: non si invia niente",
  },
  manual: { en: "Add it without a photo", "pt-BR": "Adicionar sem foto", de: "Ohne Foto hinzufügen", es: "Añadirla sin foto", pl: "Dodaj bez zdjęcia", it: "Aggiungila senza foto" },
  looking: { en: "Looking at the plant…", "pt-BR": "Examinando a planta…", de: "Pflanze wird angesehen…", es: "Mirando la planta…", pl: "Oglądam roślinę…", it: "Guardo la pianta…" },
  noAi: {
    en: "AI isn't available here, so a photo can't be looked at",
    "pt-BR": "A IA não está disponível aqui, então a foto não pode ser examinada",
    de: "Hier gibt es keine KI, also kann das Foto nicht angesehen werden",
    es: "Aquí no hay IA, así que la foto no se puede revisar",
    pl: "AI nie jest tu dostępne, więc nie da się obejrzeć zdjęcia",
    it: "Qui l'IA non è disponibile, quindi la foto non si può guardare",
  },
  notPlant: { en: "There's no plant on this photo", "pt-BR": "Não há planta nesta foto", de: "Auf diesem Foto ist keine Pflanze", es: "En esta foto no hay ninguna planta", pl: "Na tym zdjęciu nie ma rośliny", it: "In questa foto non c'è una pianta" },
  unclear: {
    en: "The photo is too blurry or dark to judge",
    "pt-BR": "A foto está tremida ou escura demais para avaliar",
    de: "Das Foto ist zu unscharf oder zu dunkel zum Beurteilen",
    es: "La foto está demasiado borrosa u oscura para juzgar",
    pl: "Zdjęcie jest zbyt nieostre albo ciemne, by coś ocenić",
    it: "La foto è troppo sfocata o scura per giudicare",
  },
  unclearDetail: {
    en: "In daylight, closer, with the leaves in focus",
    "pt-BR": "Com luz do dia, mais perto, com as folhas em foco",
    de: "Bei Tageslicht, näher, die Blätter scharf",
    es: "Con luz de día, más cerca y con las hojas enfocadas",
    pl: "W świetle dnia, bliżej, z ostrymi liśćmi",
    it: "Alla luce del giorno, più vicino, con le foglie a fuoco",
  },
  again: { en: "Take another photo", "pt-BR": "Tirar outra foto", de: "Noch ein Foto aufnehmen", es: "Hacer otra foto", pl: "Zrób kolejne zdjęcie", it: "Scatta un'altra foto" },
  another: { en: "Choose another photo", "pt-BR": "Escolher outra foto", de: "Anderes Foto auswählen", es: "Elegir otra foto", pl: "Wybierz inne zdjęcie", it: "Scegli un'altra foto" },
  saveIt: { en: "Save it with a care plan", "pt-BR": "Salvar com um plano de cuidados", de: "Mit Pflegeplan speichern", es: "Guardarla con un plan de cuidados", pl: "Zapisz z planem pielęgnacji", it: "Salvala con un piano di cura" },
  notNow: { en: "Not now", "pt-BR": "Agora não", de: "Jetzt nicht", es: "Ahora no", pl: "Nie teraz", it: "Non ora" },
  saveTitle: { en: "Your plant and its care plan", "pt-BR": "Sua planta e o plano de cuidados", de: "Deine Pflanze und ihr Pflegeplan", es: "Tu planta y su plan de cuidados", pl: "Twoja roślina i plan pielęgnacji", it: "La tua pianta e il suo piano di cura" },
  save: { en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" },
  seen: { en: "What it looks like:", "pt-BR": "Como parece:", de: "Wie es aussieht:", es: "Cómo se ve:", pl: "Jak to wygląda:", it: "Come appare:" },
  toCheck: { en: "What to check:", "pt-BR": "O que verificar:", de: "Was du prüfen kannst:", es: "Qué revisar:", pl: "Co sprawdzić:", it: "Cosa controllare:" },
  myPlant: { en: "My plant", "pt-BR": "Minha planta", de: "Meine Pflanze", es: "Mi planta", pl: "Moja roślina", it: "La mia pianta" },
  saved: {
    en: "Saved. {water}. {check}.",
    "pt-BR": "Salvo. {water}. {check}.",
    de: "Gespeichert. {water}. {check}.",
    es: "Guardado. {water}. {check}.",
    pl: "Zapisano. {water}. {check}.",
    it: "Salvato. {water}. {check}.",
  },
  watered: { en: "Watered. {next}.", "pt-BR": "Regada. {next}.", de: "Gegossen. {next}.", es: "Regada. {next}.", pl: "Podlana. {next}.", it: "Annaffiata. {next}." },
} as const;

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
  // No camera here (a desktop without one, or a device that refused it): the file picker.
  const [file] = await ctx.files.import({ folder: "photos", accept: "image/*" });
  if (!file) return null;
  const bytes = await ctx.files.bytes(file);
  const blob = bytes ? new Blob([bytes as BlobPart], { type: file.mime }) : null;
  await ctx.files.remove(file);
  return blob;
}

const sources = (withSample: boolean) => [
  { id: "camera" as const, label: W.camera, detail: W.cameraDetail, icon: "📷" },
  { id: "library" as const, label: W.library, icon: "🖼️" },
  ...(withSample ? [{ id: "sample" as const, label: W.sample, detail: W.sampleDetail, icon: "✨" }] : []),
];

/** Ask the AI, or say in its own words why it could not. Null when there is nothing to show. */
async function look(ctx: Ctx, image: Blob | MediaRef | Array<Blob | MediaRef>, instructions: string): Promise<DiagnosisAnswer | { failed: string }> {
  const ai = ctx.caps.ai;
  if (!ai) return { failed: ctx.t(W.noAi) };
  const bar = ctx.ui.progress(W.looking);
  try {
    return await ai.extract({ image, instructions, schema: DIAGNOSIS });
  } catch (e) {
    return { failed: e instanceof Error && e.message ? e.message : ctx.t(W.noAi) };
  } finally {
    bar.done();
  }
}

// ---- a new plant ----

/** The page action: look at a plant for the first time. */
export async function checkAPlant(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet<Source | "sample" | "manual">({ title: W.sheetTitle, items: [...sources(true), { id: "manual", label: W.manual, icon: "✏️" }] });
  if (how === "sample") return firstLook(ctx, sampleReading(ctx), new Blob([samplePlantSvg(ctx)], { type: "image/svg+xml" }), true);
  if (how === "manual") return void (await savePlant(ctx, null, null, false));
  if (how !== "camera" && how !== "library") return;
  if (!ctx.caps.ai) return offerInstead(ctx, W.noAi);
  const photo = await takePhoto(ctx, how);
  if (!photo) return;
  const answer = await look(ctx, photo, firstInstructions());
  if ("failed" in answer) return offerInstead(ctx, answer.failed);
  await firstLook(ctx, answer, photo, false);
}

/** Looking cannot happen: say why, and offer what still works. */
async function offerInstead(ctx: Ctx, why: Words): Promise<void> {
  const next = await ctx.ui.sheet<"sample" | "manual">({
    title: why,
    items: [
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
      { id: "manual", label: W.manual, icon: "✏️" },
    ],
  });
  if (next === "sample") return firstLook(ctx, sampleReading(ctx), new Blob([samplePlantSvg(ctx)], { type: "image/svg+xml" }), true);
  if (next === "manual") await savePlant(ctx, null, null, false);
}

/** No plant, or no telling: say which, and offer another photo. */
async function cannotJudge(ctx: Ctx, why: "not a plant" | "unclear", retry: (from: Source) => Promise<void>): Promise<void> {
  const next = await ctx.ui.sheet<Source>({
    title: why === "unclear" ? W.unclear : W.notPlant,
    items: [
      { id: "camera", label: W.again, ...(why === "unclear" ? { detail: W.unclearDetail } : {}), icon: "📷" },
      { id: "library", label: W.another, icon: "🖼️" },
    ],
  });
  if (next) await retry(next);
}

/** The finding, read first; then the care plan, checked; then both saved and the finding opened. */
export async function firstLook(ctx: Ctx, answer: DiagnosisAnswer, photo: Blob, sample: boolean): Promise<void> {
  const f = toFinding(answer, false);
  if (f === "not a plant" || f === "unclear") {
    return cannotJudge(ctx, f, async (from) => {
      const again = await takePhoto(ctx, from);
      if (!again) return;
      const next = await look(ctx, again, firstInstructions());
      if ("failed" in next) return offerInstead(ctx, next.failed);
      await firstLook(ctx, next, again, false);
    });
  }
  const go = await ctx.ui.confirm(headline(f, ctx), { detail: summary(f, ctx), ok: W.saveIt, cancel: W.notNow });
  if (!go) return;
  await savePlant(ctx, f, photo, sample);
}

/** What the person reads before deciding to keep it: which plant, what is seen, what to check, and the caveat. */
export function summary(f: Finding, ctx: Pick<Ctx, "t" | "format">): string {
  return [
    plantLine(f, ctx),
    f.signs.length ? `${ctx.t(W.seen)} ${f.signs.join("; ")}` : "",
    f.check.length ? `${ctx.t(W.toCheck)}\n${bullets(f.check)}` : "",
    expertText(f, ctx),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A demo link's first look (docs/04 §Demo): the sample plant, looked at and kept with its care plan
 * and first check-up — what "Try it on a sample photo" leads to, without the questions.
 */
export async function demo(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const f = toFinding(sampleReading(ctx), false);
  if (f === "not a plant" || f === "unclear") return;
  const light: Light = f.light ?? "medium";
  const ref = await ctx.media.put(new Blob([samplePlantSvg(ctx)], { type: "image/svg+xml" }));
  const health = f.health ?? "okay";
  const plant = await ctx.create("plant", {
    name: f.plantName || ctx.t(W.myPlant),
    light,
    waterEvery: f.waterEvery ?? WATER_DAYS[light],
    ...(f.latin || f.plantName ? { species: f.latin || f.plantName } : {}),
    photo: ref,
    watch: bullets(f.watch),
    health,
    nextCheck: nextCheckup(health, now),
  });
  await ctx.create("check", checkRecord(ctx, f, String(plant.id), ref, now, true));
}

/** The care plan form, filled in from the finding (or empty, for a plant added without a photo). */
async function savePlant(ctx: Ctx, f: Finding | null, photo: Blob | null, sample: boolean): Promise<void> {
  const now = ctx.now();
  const light: Light = f?.light ?? "medium";
  const initial: Record<string, unknown> = {
    name: f?.plantName || ctx.t(W.myPlant),
    light,
    waterEvery: f?.waterEvery ?? WATER_DAYS[light],
    ...(f && (f.latin || f.plantName) ? { species: f.latin || f.plantName } : {}),
  };
  const plan = await ctx.ui.form<Record<string, unknown>>({ title: W.saveTitle, fields: SAVE_FIELDS, initial, submit: W.save });
  if (!plan) return;
  const ref = photo ? await ctx.media.put(photo) : null;
  const health = f?.health ?? "okay";
  const plant = await ctx.create("plant", {
    ...plan,
    ...(plan.lastWatered ? { lastWatered: startOfDay(toDate(plan.lastWatered) ?? now) } : {}),
    ...(ref ? { photo: ref } : {}),
    ...(f ? { watch: bullets(f.watch), health, nextCheck: nextCheckup(health, now) } : { health }),
  });
  if (f && ref) {
    const check = await ctx.create("check", checkRecord(ctx, f, String(plant.id), ref, now, sample));
    ctx.ui.toast(ctx.t(W.saved, { water: waterText(plant, ctx, now), check: checkText(plant, ctx, now) }));
    ctx.navigate("check", { checkId: String(check.id) });
    return;
  }
  ctx.navigate("plant", { plantId: String(plant.id) });
}

/** A check-up as the store keeps it. A healthy plant's "problem" says so, in the person's words. */
export function checkRecord(ctx: Pick<Ctx, "t">, f: Finding, plantId: string, photo: MediaRef, now: Date, sample: boolean): Record<string, unknown> {
  return {
    plant: plantId,
    date: now,
    photo,
    problem: f.problem || ctx.t(KIND_WORDS[f.kind]),
    kind: f.kind,
    sure: f.sure,
    plantName: f.plantName,
    latin: f.latin,
    plantSure: f.plantSure,
    signs: bullets(f.signs),
    toCheck: bullets(f.check),
    toDo: bullets(f.todo),
    serious: f.serious,
    trend: f.trend,
    trendNote: f.trendNote,
    sample,
  };
}

// ---- a check-up ----

/** A check-up's plant id, whether the relation came resolved (a record) or raw (an id). */
export const plantIdOf = (c: Resolved): string => {
  const p = c.plant as { id?: unknown } | string | null | undefined;
  return p && typeof p === "object" ? String(p.id ?? "") : String(p ?? "");
};

/** The latest check-up of a plant, if there is one. */
async function latestCheck(ctx: Ctx, plantId: string): Promise<Resolved | null> {
  const rows = (await ctx.query("check")).filter((c) => plantIdOf(c) === plantId);
  return rows.sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0))[0] ?? null;
}

/** The plant's action: a new photo, compared with the last one. */
export async function checkUp(plant: Resolved, ctx: Ctx): Promise<void> {
  const plantId = String(plant.id);
  const previous = await latestCheck(ctx, plantId);
  // The sample's second picture only follows the sample's first: it is the same made-up plant.
  const how = await ctx.ui.sheet<Source | "sample">({ title: W.checkupTitle, items: sources(previous?.sample === true) });
  if (!how) return;
  if (how === "sample") return saveCheckUp(ctx, plant, previous, sampleReading(ctx, true), new Blob([samplePlantSvg(ctx, true)], { type: "image/svg+xml" }), true);
  if (!ctx.caps.ai) return void ctx.ui.toast(W.noAi);
  const photo = await takePhoto(ctx, how);
  if (!photo) return;
  const earlier = previous?.photo as MediaRef | undefined;
  const on = toDate(previous?.date);
  const said = previous ? `${String(previous.kind ?? "unsure")}${previous.problem ? ` (${String(previous.problem)})` : ""}` : "";
  const answer = await look(ctx, earlier ? [earlier, photo] : photo, followUpInstructions(previous && on ? { on, said } : null));
  if ("failed" in answer) return void ctx.ui.toast(answer.failed);
  await saveCheckUp(ctx, plant, previous, answer, photo, false);
}

async function saveCheckUp(ctx: Ctx, plant: Resolved, previous: Resolved | null, answer: DiagnosisAnswer, photo: Blob, sample: boolean): Promise<void> {
  const f = toFinding(answer, previous !== null);
  if (f === "not a plant" || f === "unclear") return void ctx.ui.toast(f === "unclear" ? W.unclear : W.notPlant);
  const now = ctx.now();
  const ref = await ctx.media.put(photo);
  const check = await ctx.create("check", checkRecord(ctx, f, String(plant.id), ref, now, sample));
  await ctx.patch("plant", String(plant.id), {
    photo: ref,
    health: f.health,
    nextCheck: nextCheckup(f.health, now),
    ...(f.watch.length ? { watch: bullets(f.watch) } : {}),
  });
  ctx.ui.toast(trendText(f, ctx));
  ctx.navigate("check", { checkId: String(check.id) });
}

/** Watered it: today is the last watering, and the next is counted from it. */
export async function watered(plant: Resolved, ctx: Ctx): Promise<void> {
  const today = startOfDay(ctx.now());
  await ctx.patch("plant", String(plant.id), { lastWatered: today });
  ctx.ui.toast(ctx.t(W.watered, { next: waterText({ ...plant, lastWatered: today }, ctx, ctx.now()) }));
}
