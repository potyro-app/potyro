// plants.app.ts
// Stresses: datetime logic, season-dependent computed interval (real branching), reminders
// as functions returning Date|null, a quick action, calendar view. And words built inside functions
// (#302): "in 3 days" from `ctx.format.relative`, a plural from `ctx.t`, both right in any language
// and in the sealed box — a hand-written "in 3d" was English only.
//
// In six languages (#303). A plant's name, photo and labels are records and stay as written; every
// word the app says around them is a map. Every language but English is a model's draft (#297).
import { defineApp } from "potyro";

// plain helpers — full code, your own module in a real project
const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const seasonOf = (d: Date): "spring" | "summer" | "autumn" | "winter" => {
  const m = d.getMonth(); // northern hemisphere
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
};

// arbitrary logic: seasonal override falls back to the base interval
type Plant = {
  lastWatered?: Date; wateringIntervalDays: number; active: boolean; name: string;
  seasonalCare: { season: string; intervalDays: number }[];
};
const effectiveIntervalDays = (p: Plant) => {
  const s = seasonOf(new Date());
  const override = p.seasonalCare.find((r) => r.season === s);
  return override?.intervalDays ?? p.wateringIntervalDays;
};
// Never watered counts as long overdue: a new plant is due the moment it exists.
const nextWatering = (p: Plant) => addDays(p.lastWatered ?? new Date(0), effectiveIntervalDays(p));

export default defineApp({
  id: "plants",
  name: { en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" },
  icon: "🌱",
  version: "1.2.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#7FCF8E" },
  permissions: { camera: true, notifications: true },

  entities: {
    plant: {
      label: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        photo: { type: "media", accept: "image", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
        wiki: { type: "url", label: "Wiki" }, // the same in every language
        // No options on purpose: these are the owner's own words — "from Ana", "needs repotting" —
        // so the control is type-a-word-press-Enter, not a fixed set (#98).
        labels: {
          type: "tags",
          label: { en: "Labels", "pt-BR": "Etiquetas", de: "Schlagwörter", es: "Etiquetas", pl: "Etykiety", it: "Etichette" },
          help: {
            en: "Your own words: where it lives, who gave it to you",
            "pt-BR": "Com as suas palavras: onde ela fica, quem deu para você",
            de: "In deinen Worten: wo sie steht, wer sie dir geschenkt hat",
            es: "Con tus palabras: dónde está, quién te la regaló",
            pl: "Własnymi słowami: gdzie stoi, kto ci ją dał",
            it: "Con parole tue: dove sta, chi te l'ha regalata",
          },
        },
        needsDirectSun: {
          type: "boolean",
          default: false,
          label: {
            en: "Needs Direct Sun",
            "pt-BR": "Precisa de sol direto",
            de: "Braucht direkte Sonne",
            es: "Necesita sol directo",
            pl: "Potrzebuje pełnego słońca",
            it: "Vuole il sole diretto",
          },
        },
        active: { type: "boolean", default: true, label: { en: "Active", "pt-BR": "Ativa", de: "Aktiv", es: "Activa", pl: "Aktywna", it: "Attiva" } },
        lastWatered: {
          type: "datetime",
          width: "half",
          label: { en: "Last Watered", "pt-BR": "Última rega", de: "Zuletzt gegossen", es: "Último riego", pl: "Ostatnie podlanie", it: "Ultima annaffiatura" },
        },
        wateringIntervalDays: {
          type: "number",
          unit: { en: "days", "pt-BR": "dias", de: "Tage", es: "días", pl: "dni", it: "giorni" },
          min: 1,
          default: 7,
          integer: true,
          width: "half",
          label: {
            en: "Watering Interval Days",
            "pt-BR": "Regar a cada",
            de: "Gießen alle",
            es: "Regar cada",
            pl: "Podlewać co",
            it: "Annaffiare ogni",
          },
          help: {
            en: "The reminder comes this many days after a watering",
            "pt-BR": "O lembrete chega esse número de dias depois da rega",
            de: "Die Erinnerung kommt so viele Tage nach dem Gießen",
            es: "El recordatorio llega tantos días después de regar",
            pl: "Przypomnienie przyjdzie po tylu dniach od podlania",
            it: "Il promemoria arriva tanti giorni dopo l'annaffiatura",
          },
        },
        seasonalCare: {
          type: "list",
          label: { en: "Seasonal Care", "pt-BR": "Cuidados por estação", de: "Pflege nach Jahreszeit", es: "Cuidados por estación", pl: "Pielęgnacja w porach roku", it: "Cura stagionale" },
          of: {
            season: {
              type: "enum",
              label: { en: "Season", "pt-BR": "Estação", de: "Jahreszeit", es: "Estación", pl: "Pora roku", it: "Stagione" },
              options: ["spring", "summer", "autumn", "winter"],
              colors: { spring: "green", summer: "yellow", autumn: "orange", winter: "blue" },
              // What each option reads as; records keep "spring", whatever the language.
              labels: {
                spring: { en: "Spring", "pt-BR": "Primavera", de: "Frühling", es: "Primavera", pl: "Wiosna", it: "Primavera" },
                summer: { en: "Summer", "pt-BR": "Verão", de: "Sommer", es: "Verano", pl: "Lato", it: "Estate" },
                autumn: { en: "Autumn", "pt-BR": "Outono", de: "Herbst", es: "Otoño", pl: "Jesień", it: "Autunno" },
                winter: { en: "Winter", "pt-BR": "Inverno", de: "Winter", es: "Invierno", pl: "Zima", it: "Inverno" },
              },
            },
            intervalDays: {
              type: "number",
              min: 1,
              integer: true,
              label: { en: "Interval Days", "pt-BR": "A cada (dias)", de: "Alle (Tage)", es: "Cada (días)", pl: "Co ile dni", it: "Ogni (giorni)" },
            },
            note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
          },
        },
      },
      computed: {
        currentIntervalDays: (p) => effectiveIntervalDays(p as unknown as Plant),
        nextWatering: (p) => nextWatering(p as unknown as Plant),
        overdue: (p) => p.active && Date.now() > nextWatering(p as unknown as Plant).getTime(),
      },
      actions: {
        water: {
          label: { en: "Water", "pt-BR": "Regar", de: "Gießen", es: "Regar", pl: "Podlej", it: "Annaffia" },
          run: async (p, ctx) => {
            await ctx.patch("plant", p.id, { lastWatered: ctx.now() });
          },
        },
      },
    },
  },

  pages: [
    // A home page made of three views (#105): the figures, the overdue plants, the month. Each is
    // an ordinary view, so this page renders for someone this app is shared with, in the sandbox.
    {
      id: "today",
      title: { en: "Today", "pt-BR": "Hoje", de: "Heute", es: "Hoy", pl: "Dziś", it: "Oggi" },
      icon: "☀️",
      layout: {
        type: "grid",
        items: [
          {
            title: { en: "Watering", "pt-BR": "Rega", de: "Gießen", es: "Riego", pl: "Podlewanie", it: "Annaffiatura" },
            span: 1,
            view: {
              type: "aggregate",
              entity: "plant",
              rows: (plants, ctx) => {
                const week = Date.now() + 7 * DAY;
                const thisWeek = plants.filter((p) => p.active && p.nextWatering.getTime() <= week).length;
                // The value stays a number — the view formats it; the words around it come from ctx.t.
                return [
                  {
                    label: ctx.t({ en: "Due now", "pt-BR": "Regar agora", de: "Jetzt fällig", es: "Regar ya", pl: "Do podlania teraz", it: "Da annaffiare ora" }),
                    value: plants.filter((p) => p.overdue).length,
                    tone: plants.some((p) => p.overdue) ? "negative" : undefined,
                  },
                  {
                    label: ctx.t({ en: "This week", "pt-BR": "Esta semana", de: "Diese Woche", es: "Esta semana", pl: "W tym tygodniu", it: "Questa settimana" }),
                    value: thisWeek,
                    detail: ctx.t(
                      {
                        en: "{n, plural, =0 {nothing to water} one {# plant to water} other {# plants to water}}",
                        "pt-BR": "{n, plural, =0 {nada para regar} one {# planta para regar} other {# plantas para regar}}",
                        de: "{n, plural, =0 {nichts zu gießen} one {# Pflanze zu gießen} other {# Pflanzen zu gießen}}",
                        es: "{n, plural, =0 {nada que regar} one {# planta que regar} other {# plantas que regar}}",
                        pl: "{n, plural, =0 {nic do podlania} one {# roślina do podlania} few {# rośliny do podlania} many {# roślin do podlania} other {# rośliny do podlania}}",
                        it: "{n, plural, =0 {niente da annaffiare} one {# pianta da annaffiare} other {# piante da annaffiare}}",
                      },
                      { n: thisWeek },
                    ),
                  },
                  {
                    label: ctx.t({ en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" }),
                    value: plants.filter((p) => p.active).length,
                  },
                ];
              },
            },
          },
          {
            title: { en: "Overdue", "pt-BR": "Atrasadas", de: "Überfällig", es: "Atrasadas", pl: "Zaległe", it: "In ritardo" },
            span: 2,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.overdue,
              sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: {
                primary: "name",
                secondary: (p, ctx) =>
                  ctx.t(
                    { en: "due {when}", "pt-BR": "vence {when}", de: "fällig {when}", es: "toca {when}", pl: "termin: {when}", it: "scadenza: {when}" },
                    { when: ctx.format.relative(p.nextWatering, { unit: "day" }) },
                  ),
              },
              rowActions: ["water"],
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: { en: "Nothing to water. 🌱", "pt-BR": "Nada para regar. 🌱", de: "Nichts zu gießen. 🌱", es: "Nada que regar. 🌱", pl: "Nic do podlania. 🌱", it: "Niente da annaffiare. 🌱" },
            },
          },
          {
            title: { en: "This month", "pt-BR": "Este mês", de: "Diesen Monat", es: "Este mes", pl: "W tym miesiącu", it: "Questo mese" },
            span: 3,
            view: { type: "calendar", entity: "plant", date: "nextWatering", title: (p) => p.name, color: (p) => (p.needsDirectSun ? "#E4A93C" : "#7FCF8E") },
          },
        ],
      },
    },
    {
      id: "list",
      title: { en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" },
      view: {
        type: "list",
        entity: "plant",
        sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
        display: {
          primary: (p) => p.name,
          secondary: (p, ctx) =>
            p.overdue
              ? ctx.t({ en: "overdue!", "pt-BR": "atrasada!", de: "überfällig!", es: "¡atrasada!", pl: "po terminie!", it: "in ritardo!" })
              : ctx.t(
                  { en: "next: {when}", "pt-BR": "próxima: {when}", de: "nächstes Mal: {when}", es: "próximo riego: {when}", pl: "następne: {when}", it: "prossima: {when}" },
                  { when: ctx.format.relative(p.nextWatering, { unit: "day" }) },
                ),
          media: "photo",
          badges: ["needsDirectSun"],
        },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
      },
    },
    {
      id: "due",
      title: { en: "Due", "pt-BR": "Para regar", de: "Fällig", es: "Por regar", pl: "Do podlania", it: "Da annaffiare" },
      view: {
        type: "list",
        entity: "plant",
        filter: (p) => p.overdue,
        sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
        display: {
          primary: "name",
          secondary: (p, ctx) =>
            ctx.t(
              { en: "due {when}", "pt-BR": "vence {when}", de: "fällig {when}", es: "toca {when}", pl: "termin: {when}", it: "scadenza: {when}" },
              { when: ctx.format.relative(p.nextWatering, { unit: "day" }) },
            ),
          media: "photo",
        },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
        emptyText: { en: "Nothing to water. 🌱", "pt-BR": "Nada para regar. 🌱", de: "Nichts zu gießen. 🌱", es: "Nada que regar. 🌱", pl: "Nic do podlania. 🌱", it: "Niente da annaffiare. 🌱" },
      },
    },
    {
      // A plant's own page: Water is its one filled action; Edit and Delete sit behind More actions.
      id: "plant",
      title: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      hidden: true,
      view: { type: "detail", entity: "plant", param: "plantId", actions: ["water"] },
    },
    {
      id: "schedule",
      title: { en: "Schedule", "pt-BR": "Agenda", de: "Gießplan", es: "Calendario", pl: "Harmonogram", it: "Calendario" },
      view: {
        type: "calendar",
        entity: "plant",
        date: "nextWatering",
        title: (p) => p.name,
        color: (p) => (p.needsDirectSun ? "#E4A93C" : "#7FCF8E"),
      },
    },
  ],

  reminders: [
    {
      id: "water-due",
      entity: "plant",
      when: (p) => (p.active ? p.nextWatering : null),
      // The plant's name is a record, so it is never translated: the app's words go around it.
      title: (p, ctx) =>
        ctx.t({ en: "Water {name}", "pt-BR": "Regar: {name}", de: "{name} gießen", es: "Regar: {name}", pl: "Podlej: {name}", it: "Annaffia: {name}" }, { name: p.name }),
      body: (p, ctx) =>
        p.lastWatered
          ? ctx.t(
              {
                en: "Last watered {when}",
                "pt-BR": "Última rega {when}",
                de: "Zuletzt gegossen {when}",
                es: "Último riego {when}",
                pl: "Ostatnio podlana {when}",
                it: "Ultima annaffiatura {when}",
              },
              { when: ctx.format.relative(p.lastWatered, { unit: "day" }) },
            )
          : ctx.t({
              en: "Never watered yet",
              "pt-BR": "Ainda não foi regada",
              de: "Noch nie gegossen",
              es: "Todavía no se ha regado",
              pl: "Jeszcze nie była podlewana",
              it: "Non è ancora stata annaffiata",
            }),
    },
  ],
});
