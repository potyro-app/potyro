// Plant Doctor: photograph a plant, or a sick leaf, and get the likely plant and the likely problem —
// in plain words, as sure as the photo allows and no surer — with what to check, what to do, and when
// to ask someone who can see it. Save the plant with a care plan and reminders; a check-up photo later
// says whether it is better or worse since last time, and the check-ups line up into a timeline.
//
// The looking is one `ctx.caps.ai.extract` (docs/23). The care sense — the watering interval, how
// soon to look again, what counts as serious, when to remind — is the app's own (care.ts), the same
// every time. How it talks about certainty is in words.ts: never "is", always "probably".
//
// Every screen is a built-in view, on purpose: a friend who opens a shared copy runs it sealed, where
// custom views do not render. In six languages (docs/20); every language but English is a model's
// draft (#297). What the model wrote is in the person's language already, and is never translated.

import { defineApp, type Ctx, type Resolved } from "potyro";
import { checkRemindAt, checkupDue, isHealth, needsWater, toDate, waterRemindAt } from "./care.js";
import { CHECK_FIELDS, PLANT_FIELDS } from "./fields.js";
import { checkAPlant, checkUp, plantIdOf, watered } from "./read.js";
import { carePlanShare, checkShare, checkText, expertText, headline, HEALTH_WORDS, planText, plantLine, remindersText, trendText, waterText } from "./words.js";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const plantName = (c: Resolved): string => str((c.plant as { name?: unknown } | null)?.name);

/** The share sheet with a plant's care plan and its latest check-up. */
async function sharePlan(plant: Resolved, ctx: Ctx): Promise<void> {
  const checks = (await ctx.query("check")).filter((c) => plantIdOf(c) === String(plant.id));
  const latest = checks.sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0))[0] ?? null;
  await ctx.ui.share({ title: str(plant.name), text: carePlanShare(plant, latest, ctx) });
}

const T = {
  whatToCheck: { en: "What to check", "pt-BR": "O que verificar", de: "Was du prüfen kannst", es: "Qué revisar", pl: "Co sprawdzić", it: "Cosa controllare" },
  whatToDo: { en: "What to do", "pt-BR": "O que fazer", de: "Was du tun kannst", es: "Qué hacer", pl: "Co zrobić", it: "Cosa fare" },
  looksLike: { en: "What it looks like", "pt-BR": "Como parece", de: "Wie es aussieht", es: "Cómo se ve", pl: "Jak to wygląda", it: "Come appare" },
  since: { en: "Since last time", "pt-BR": "Desde a última vez", de: "Seit dem letzten Mal", es: "Desde la última vez", pl: "Od ostatniego razu", it: "Dall'ultima volta" },
  expert: { en: "When to ask someone", "pt-BR": "Quando pedir ajuda", de: "Wann du jemanden fragen solltest", es: "Cuándo preguntar a alguien", pl: "Kiedy kogoś zapytać", it: "Quando chiedere a qualcuno" },
  plan: { en: "Care plan", "pt-BR": "Plano de cuidados", de: "Pflegeplan", es: "Plan de cuidados", pl: "Plan pielęgnacji", it: "Piano di cura" },
  watch: { en: "Keep an eye on", "pt-BR": "Fique de olho em", de: "Im Blick behalten", es: "Vigilar", pl: "Obserwuj", it: "Tieni d'occhio" },
  checkups: { en: "Check-ups", "pt-BR": "Revisões", de: "Checks", es: "Revisiones", pl: "Sprawdzenia", it: "Controlli" },
  more: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" },
} as const;

export default defineApp({
  id: "plant-doctor",
  name: { en: "Plant Doctor", "pt-BR": "Doutor de Plantas", de: "Pflanzendoktor", es: "Doctor de Plantas", pl: "Lekarz Roślin", it: "Dottore delle Piante" },
  icon: "🪴",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#3d8b5a" },
  nav: "tabs",
  permissions: { ai: true, camera: true, notifications: true },
  // The way in is a photo (the page's own button); this is for a plant you would rather just type in.
  quickActions: [
    {
      id: "add",
      label: { en: "Add without a photo", "pt-BR": "Adicionar sem foto", de: "Ohne Foto hinzufügen", es: "Añadir sin foto", pl: "Dodaj bez zdjęcia", it: "Aggiungi senza foto" },
      icon: "✏️",
      entity: "plant",
      mode: "form",
    },
  ],
  entities: {
    plant: {
      label: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      icon: "🪴",
      displayField: "name",
      fields: PLANT_FIELDS,
      groups: [
        { fields: ["name", "species", "photo"] },
        { title: T.plan, fields: ["light", "waterEvery", "lastWatered", "watch"] },
        { title: T.more, fields: ["health", "nextCheck"], collapsed: true },
      ],
      computed: {
        water: { value: (r, ctx) => waterText(r, ctx, ctx.now()), label: { en: "Water", "pt-BR": "Rega", de: "Gießen", es: "Riego", pl: "Podlewanie", it: "Acqua" } },
        nextLook: { value: (r, ctx) => checkText(r, ctx, ctx.now()), label: { en: "Check-up", "pt-BR": "Revisão", de: "Check", es: "Revisión", pl: "Sprawdzenie", it: "Controllo" } },
        plan: { value: (r, ctx) => planText(r, ctx), label: T.plan },
        reminders: { value: (r, ctx) => remindersText(r, ctx, ctx.now()), label: { en: "Reminders", "pt-BR": "Lembretes", de: "Erinnerungen", es: "Recordatorios", pl: "Przypomnienia", it: "Promemoria" } },
      },
      actions: {
        checkup: {
          label: { en: "New check-up photo", "pt-BR": "Nova foto de revisão", de: "Neues Check-Foto", es: "Nueva foto de revisión", pl: "Nowe zdjęcie kontrolne", it: "Nuova foto di controllo" },
          description: "Take a new photo of the plant and compare it with the last check-up.",
          run: checkUp,
        },
        watered: {
          label: { en: "Watered it", "pt-BR": "Reguei", de: "Gegossen", es: "La regué", pl: "Podlane", it: "Annaffiata" },
          description: "Record that the plant was watered today.",
          run: watered,
        },
        share: {
          label: { en: "Share care plan", "pt-BR": "Compartilhar cuidados", de: "Pflegeplan teilen", es: "Compartir cuidados", pl: "Udostępnij plan", it: "Condividi il piano" },
          description: "Open the share sheet with the plant's care plan and its last check-up.",
          run: sharePlan,
        },
      },
    },
    check: {
      label: { en: "Check-up", "pt-BR": "Revisão", de: "Check", es: "Revisión", pl: "Sprawdzenie", it: "Controllo" },
      icon: "🔎",
      displayField: "problem",
      fields: CHECK_FIELDS,
      computed: {
        headline: { value: (r, ctx) => headline(r, ctx), label: { en: "It seems", "pt-BR": "Parece", de: "Es scheint", es: "Parece", pl: "Wygląda na to", it: "Sembra" } },
        plantText: { value: (r, ctx) => plantLine(r, ctx), label: { en: "Which plant", "pt-BR": "Que planta", de: "Welche Pflanze", es: "Qué planta", pl: "Jaka roślina", it: "Che pianta" } },
        since: { value: (r, ctx) => trendText(r, ctx), label: T.since },
        expert: { value: (r, ctx) => expertText(r, ctx), label: T.expert },
      },
      actions: {
        share: {
          label: { en: "Send to someone", "pt-BR": "Enviar para alguém", de: "Jemandem schicken", es: "Enviar a alguien", pl: "Wyślij komuś", it: "Manda a qualcuno" },
          description: "Open the share sheet with this check-up's finding, what to check and what to do.",
          run: async (r, ctx) => void (await ctx.ui.share({ title: plantName(r), text: checkShare(r, plantName(r), ctx) })),
        },
      },
    },
  },
  pages: [
    {
      id: "plants",
      title: { en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" },
      icon: "🪴",
      summary: [
        { label: { en: "Want water", "pt-BR": "Pedem água", de: "Wollen Wasser", es: "Piden agua", pl: "Do podlania", it: "Da annaffiare" }, value: (rows, ctx) => rows.filter((r) => needsWater(r, ctx.now())).length },
        { label: { en: "Check-up due", "pt-BR": "Revisão pendente", de: "Check fällig", es: "Revisión pendiente", pl: "Do sprawdzenia", it: "Controllo da fare" }, value: (rows, ctx) => rows.filter((r) => checkupDue(r, ctx.now())).length },
      ],
      actions: [{ label: { en: "Check a plant", "pt-BR": "Examinar uma planta", de: "Pflanze ansehen", es: "Revisar una planta", pl: "Obejrzyj roślinę", it: "Controlla una pianta" }, icon: "📷", run: checkAPlant }],
      view: {
        type: "gallery",
        entity: "plant",
        display: {
          primary: "name",
          secondary: (r, ctx) =>
            [waterText(r, ctx, ctx.now()), checkupDue(r, ctx.now()) ? checkText(r, ctx, ctx.now()) : isHealth(r.health) ? ctx.t(HEALTH_WORDS[r.health]) : ""].filter(Boolean).join(" · "),
          media: "photo",
        },
        emptyText: {
          en: "Photograph a plant — or one sick leaf — and see what it most likely is, what might be wrong, and what to check. Try the sample under “Check a plant”.",
          "pt-BR": "Fotografe uma planta — ou uma folha doente — e veja o que ela provavelmente é, o que pode estar errado e o que verificar. Teste o exemplo em “Examinar uma planta”.",
          de: "Fotografiere eine Pflanze — oder ein krankes Blatt — und sieh, was sie wahrscheinlich ist, was fehlen könnte und was du prüfen kannst. Probier das Beispiel unter „Pflanze ansehen“.",
          es: "Haz una foto a una planta —o a una hoja enferma— y mira qué es probablemente, qué le puede pasar y qué revisar. Prueba el ejemplo en «Revisar una planta».",
          pl: "Zrób zdjęcie rośliny — albo chorego liścia — i zobacz, co to najpewniej jest, co może jej dolegać i co sprawdzić. Wypróbuj przykład w „Obejrzyj roślinę”.",
          it: "Fotografa una pianta, o una foglia malata, e scopri cosa probabilmente è, cosa potrebbe avere e cosa controllare. Prova l'esempio in “Controlla una pianta”.",
        },
        onOpen: { page: "plant", param: { plantId: "id" } },
      },
    },
    {
      id: "timeline",
      title: T.checkups,
      icon: "🔎",
      view: {
        type: "timeline",
        entity: "check",
        date: "date",
        color: "trend",
        groupBy: "week",
        display: { primary: (r) => plantName(r), secondary: (r, ctx) => headline(r, ctx), media: "photo" },
        emptyText: {
          en: "Every look at a plant lands here, newest first, with whether it got better or worse.",
          "pt-BR": "Cada exame de uma planta aparece aqui, o mais novo primeiro, dizendo se melhorou ou piorou.",
          de: "Jeder Blick auf eine Pflanze landet hier, der neueste zuerst, mit besser oder schlechter.",
          es: "Cada revisión de una planta llega aquí, la más reciente primero, diciendo si mejoró o empeoró.",
          pl: "Każde oględziny rośliny trafiają tutaj, najnowsze na górze, z informacją, czy jest lepiej, czy gorzej.",
          it: "Ogni controllo di una pianta finisce qui, il più recente per primo, con se è migliorata o peggiorata.",
        },
        onOpen: { page: "check", param: { checkId: "id" } },
      },
    },
    {
      id: "plant",
      title: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      hidden: true,
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "detail",
              entity: "plant",
              param: "plantId",
              actions: ["checkup", "watered", "share"],
              sections: [
                { fields: ["photo", "health"] },
                { fields: ["water", "nextLook"] },
                { title: T.plan, fields: ["plan", "lastWatered", "reminders"] },
                { title: T.watch, fields: ["watch"] },
                { title: T.more, fields: ["species", "light", "waterEvery", "nextCheck"], collapsed: true },
              ],
            },
          },
          {
            title: T.checkups,
            view: {
              type: "timeline",
              entity: "check",
              date: "date",
              color: "trend",
              filter: (r, ctx) => plantIdOf(r) === String(ctx.params.plantId ?? ""),
              display: { primary: (r, ctx) => headline(r, ctx), secondary: (r, ctx) => trendText(r, ctx), media: "photo" },
              onOpen: { page: "check", param: { checkId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "check",
      title: { en: "Check-up", "pt-BR": "Revisão", de: "Check", es: "Revisión", pl: "Sprawdzenie", it: "Controllo" },
      hidden: true,
      view: {
        type: "detail",
        entity: "check",
        param: "checkId",
        actions: ["share"],
        sections: [
          { fields: ["photo", "headline"] },
          { fields: ["plantText"] },
          { title: T.since, fields: ["since"] },
          { title: T.looksLike, fields: ["signs"] },
          { title: T.whatToCheck, fields: ["toCheck"] },
          { title: T.whatToDo, fields: ["toDo"] },
          { title: T.expert, fields: ["expert"] },
        ],
      },
    },
  ],
  reminders: [
    {
      id: "water",
      entity: "plant",
      when: (r, ctx) => waterRemindAt(r, ctx.now()),
      title: (r, ctx) => ctx.t({ en: "{name} wants water today", "pt-BR": "{name} quer água hoje", de: "{name} will heute Wasser", es: "{name} quiere agua hoy", pl: "{name}: dziś podlewanie", it: "{name} vuole acqua oggi" }, { name: str(r.name) }),
      body: (_r, ctx) =>
        ctx.t({
          en: "Feel the soil first: water only if the top is dry.",
          "pt-BR": "Sinta a terra antes: regue só se estiver seca por cima.",
          de: "Erst die Erde fühlen: nur gießen, wenn sie oben trocken ist.",
          es: "Toca la tierra primero: riega solo si está seca por encima.",
          pl: "Najpierw dotknij ziemi: podlej tylko, jeśli z wierzchu jest sucha.",
          it: "Prima tocca il terriccio: annaffia solo se è asciutto in superficie.",
        }),
    },
    {
      id: "checkup",
      entity: "plant",
      when: (r, ctx) => checkRemindAt(r, ctx.now()),
      title: (r, ctx) => ctx.t({ en: "Time for a check-up photo of {name}", "pt-BR": "Hora da foto de revisão de {name}", de: "Zeit für ein Check-Foto von {name}", es: "Toca la foto de revisión de {name}", pl: "Czas na zdjęcie kontrolne: {name}", it: "È ora della foto di controllo di {name}" }, { name: str(r.name) }),
      body: (_r, ctx) =>
        ctx.t({
          en: "Same spot, same light: it will be compared with the last one.",
          "pt-BR": "Mesmo lugar, mesma luz: ela será comparada com a anterior.",
          de: "Gleicher Ort, gleiches Licht: Es wird mit dem letzten verglichen.",
          es: "Mismo sitio, misma luz: se comparará con la anterior.",
          pl: "To samo miejsce, to samo światło: porównamy je z poprzednim.",
          it: "Stesso posto, stessa luce: sarà confrontata con la precedente.",
        }),
    },
  ],
});
