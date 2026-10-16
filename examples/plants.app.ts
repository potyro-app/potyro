// plants.app.ts
// A calm greenhouse: who wants water today, as photo cards you tick with one tap — or tell it "the
// soil is still wet", and after two of those the plant's rhythm stretches by a day, with a rule you
// can read. Every watering, feed, mist and repot goes in a care log you can backdate. A new plant can
// come from a photo: AI suggests the name and the rhythm, you check them.
//
// Stresses: datetime logic, season-dependent computed interval (real branching), reminders as
// functions returning Date|null, actions with input (log care on any day), `ctx.caps.ai` with a
// confirm form, a calendar and a timeline. And words built inside functions (#302): "in 3 days" from
// `ctx.format.relative`, a plural from `ctx.t`, both right in any language and in the sealed box.
//
// In six languages (#303). A plant's name, photo and labels are records and stay as written; every
// word the app says around them is a map. Every language but English is a model's draft (#297).
import { defineApp, type AiImage, type Ctx, type Resolved } from "potyro";

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
  seasonalCare?: { season: string; intervalDays: number }[];
  snoozedUntil?: Date | null;
};
const effectiveIntervalDays = (p: Plant) => {
  const s = seasonOf(new Date());
  const override = (p.seasonalCare ?? []).find((r) => r.season === s);
  return override?.intervalDays ?? p.wateringIntervalDays;
};
// Never watered counts as long overdue: a new plant is due the moment it exists. "Soil still wet"
// pushes it to the snooze date, never earlier than its rhythm says.
const nextWatering = (p: Plant) => {
  const due = addDays(p.lastWatered ? new Date(p.lastWatered) : new Date(0), effectiveIntervalDays(p));
  const snoozed = p.snoozedUntil ? new Date(p.snoozedUntil) : null;
  return snoozed && snoozed > due ? snoozed : due;
};
const FEED_EVERY = 28;
/** Feeding is for the growing months: every four weeks in spring and summer, never in the rest. */
const nextFeed = (p: Resolved, now: Date): Date | null => {
  const s = seasonOf(now);
  if (p.active === false || (s !== "spring" && s !== "summer")) return null;
  return addDays(p.lastFertilized ? new Date(p.lastFertilized) : new Date(0), FEED_EVERY);
};

/** "in 2 days", "today", "3 days ago" — in the person's language. */
const when = (d: Date, ctx: Ctx): string => ctx.format.relative(d, { unit: "day" });

/** A kind of care in words: the same as `kind`'s labels. */
const careName = (k: unknown, ctx: Ctx): string => {
  switch (k) {
    case "water":
      return ctx.t({ en: "Watered", "pt-BR": "Regada", de: "Gegossen", es: "Regada", pl: "Podlana", it: "Annaffiata" });
    case "fertilize":
      return ctx.t({ en: "Fed", "pt-BR": "Adubada", de: "Gedüngt", es: "Abonada", pl: "Nawieziona", it: "Concimata" });
    case "mist":
      return ctx.t({ en: "Misted", "pt-BR": "Borrifada", de: "Besprüht", es: "Pulverizada", pl: "Zroszona", it: "Nebulizzata" });
    case "repot":
      return ctx.t({ en: "Repotted", "pt-BR": "Replantada", de: "Umgetopft", es: "Trasplantada", pl: "Przesadzona", it: "Rinvasata" });
    case "prune":
      return ctx.t({ en: "Pruned", "pt-BR": "Podada", de: "Beschnitten", es: "Podada", pl: "Przycięta", it: "Potata" });
    default:
      return ctx.t({ en: "Note", "pt-BR": "Anotação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" });
  }
};

/** Write one care event, and what it means for the plant's own dates. */
async function logCare(ctx: Ctx, plant: Resolved, kind: string, at: Date, note = ""): Promise<void> {
  await ctx.create("care", { plant: plant.id, kind, at, note });
  if (kind === "water" && (!plant.lastWatered || at >= new Date(plant.lastWatered))) {
    await ctx.patch("plant", plant.id, { lastWatered: at, snoozedUntil: null, snoozes: 0 });
  }
  if (kind === "fertilize" && (!plant.lastFertilized || at >= new Date(plant.lastFertilized))) {
    await ctx.patch("plant", plant.id, { lastFertilized: at });
  }
}

// ---- Add a plant from a photo: AI suggests, the person confirms. Nothing it says is saved unchecked. ----

const GUESS = {
  commonName: "text",
  species: "text?",
  waterEveryDays: "number",
  directSun: "boolean",
  tip: "text?",
} as const;

async function addPlant(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet({
    title: { en: "Add a plant", "pt-BR": "Adicionar planta", de: "Pflanze hinzufügen", es: "Añadir planta", pl: "Dodaj roślinę", it: "Aggiungi pianta" },
    items: [
      { id: "photo", icon: "📷", label: { en: "From a photo", "pt-BR": "De uma foto", de: "Aus einem Foto", es: "Desde una foto", pl: "Ze zdjęcia", it: "Da una foto" }, detail: { en: "AI suggests what it is and how often to water", "pt-BR": "A IA sugere o que é e de quanto em quanto tempo regar", de: "KI schlägt vor, was es ist und wie oft gießen", es: "La IA sugiere qué es y cada cuánto regarla", pl: "AI podpowie, co to jest i jak często podlewać", it: "L'IA suggerisce cos'è e ogni quanto annaffiarla" } },
      { id: "type", icon: "✏️", label: { en: "Type it in", "pt-BR": "Digitar", de: "Selbst eintippen", es: "Escribirla", pl: "Wpisz ręcznie", it: "Scrivila tu" } },
    ],
  });
  if (!how) return;
  let guess: { commonName?: string; species?: string | null; waterEveryDays?: number; directSun?: boolean; tip?: string | null } = {};
  let photo: unknown;
  if (how === "photo") {
    const [file] = await ctx.files.import({ folder: "plants", accept: "image/*" });
    if (!file) return;
    const bytes = await ctx.files.bytes(file);
    if (bytes) photo = await ctx.media.put(new Blob([bytes as BlobPart], { type: file.mime }));
    if (ctx.caps.ai) {
      const bar = ctx.ui.progress(ctx.t({ en: "Looking at your plant…", "pt-BR": "Olhando sua planta…", de: "Deine Pflanze wird angeschaut…", es: "Mirando tu planta…", pl: "Oglądam twoją roślinę…", it: "Guardo la tua pianta…" }));
      try {
        guess = await ctx.caps.ai.extract({
          image: file as AiImage,
          instructions: "A houseplant. Its common name, its species if you can tell, roughly how many days between waterings indoors, and whether it wants direct sun. One short care tip.",
          schema: GUESS,
        });
      } catch {
        // A guess that failed is no guess: the form opens empty and the person fills it in.
      } finally {
        bar.done();
      }
    }
  }
  const checked = await ctx.ui.form<{ name: string; species: string; wateringIntervalDays: number; needsDirectSun: boolean }>({
    title: guess.commonName
      ? ctx.t({ en: "AI's guess — check it", "pt-BR": "Palpite da IA — confira", de: "Tipp der KI — prüf ihn", es: "Lo que cree la IA — revísalo", pl: "Domysł AI — sprawdź", it: "L'ipotesi dell'IA — controlla" })
      : ctx.t({ en: "New plant", "pt-BR": "Nova planta", de: "Neue Pflanze", es: "Planta nueva", pl: "Nowa roślina", it: "Nuova pianta" }),
    fields: {
      name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
      species: { type: "text", label: { en: "Species", "pt-BR": "Espécie", de: "Art", es: "Especie", pl: "Gatunek", it: "Specie" } },
      wateringIntervalDays: { type: "number", min: 1, integer: true, label: { en: "Water every (days)", "pt-BR": "Regar a cada (dias)", de: "Gießen alle (Tage)", es: "Regar cada (días)", pl: "Podlewaj co (dni)", it: "Annaffia ogni (giorni)" } },
      needsDirectSun: { type: "boolean", label: { en: "Wants direct sun", "pt-BR": "Gosta de sol direto", de: "Mag direkte Sonne", es: "Quiere sol directo", pl: "Lubi pełne słońce", it: "Vuole il sole diretto" } },
    },
    initial: { name: guess.commonName ?? "", species: guess.species ?? "", wateringIntervalDays: Math.max(1, Math.round(guess.waterEveryDays ?? 7)), needsDirectSun: guess.directSun ?? false },
    submit: ctx.t({ en: "Add plant", "pt-BR": "Adicionar planta", de: "Pflanze hinzufügen", es: "Añadir planta", pl: "Dodaj roślinę", it: "Aggiungi pianta" }),
  });
  if (!checked) return;
  const plant = await ctx.create("plant", {
    ...checked,
    active: true,
    labels: [],
    seasonalCare: [],
    ...(photo ? { photo } : {}),
    ...(guess.tip ? { tip: guess.tip } : {}),
  });
  ctx.navigate("plant", { plantId: plant.id });
}

export default defineApp({
  id: "plants",
  name: { en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" },
  icon: "🌱",
  version: "2.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#7FCF8E" },
  category: "everyday",
  nav: "tabs",
  // The launcher tile (docs/04 §Tile): how many plants want water now, which ones, and one's photo.
  tile: async (ctx) => {
    const now = ctx.now().getTime();
    const due = (await ctx.query("plant"))
      .filter((p) => p.active !== false && nextWatering(p as unknown as Plant).getTime() <= now)
      .sort((a, b) => nextWatering(a as unknown as Plant).getTime() - nextWatering(b as unknown as Plant).getTime());
    return {
      count: due.length,
      title: ctx.t(
        {
          en: "{n, plural, =0 {All watered} one {# to water} other {# to water}}",
          "pt-BR": "{n, plural, =0 {Tudo regado} one {# para regar} other {# para regar}}",
          de: "{n, plural, =0 {Alles gegossen} one {# zu gießen} other {# zu gießen}}",
          es: "{n, plural, =0 {Todo regado} one {# que regar} other {# que regar}}",
          pl: "{n, plural, =0 {Wszystko podlane} one {# do podlania} few {# do podlania} many {# do podlania} other {# do podlania}}",
          it: "{n, plural, =0 {Tutto annaffiato} one {# da annaffiare} other {# da annaffiare}}",
        },
        { n: due.length },
      ),
      lines: due.slice(0, 3).map((p) => String(p.name)),
      ...(due.find((p) => p.photo) ? { image: due.find((p) => p.photo)!.photo as never } : {}),
    };
  },
  permissions: { camera: true, notifications: true, ai: true },
  quickActions: [
    { id: "add-plant", label: { en: "Add: Plant", "pt-BR": "Adicionar: Planta", de: "Hinzufügen: Pflanze", es: "Añadir: Planta", pl: "Dodaj: Roślina", it: "Aggiungi: Pianta" }, icon: "🌱", entity: "plant", mode: "form" },
  ],

  entities: {
    plant: {
      label: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      icon: "🌱",
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
            en: "Wants direct sun",
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
          label: { en: "Last watered", "pt-BR": "Última rega", de: "Zuletzt gegossen", es: "Último riego", pl: "Ostatnie podlanie", it: "Ultima annaffiatura" },
        },
        wateringIntervalDays: {
          type: "number",
          unit: { en: "days", "pt-BR": "dias", de: "Tage", es: "días", pl: "dni", it: "giorni" },
          min: 1,
          default: 7,
          integer: true,
          width: "half",
          label: {
            en: "Water every",
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
          label: { en: "Seasonal care", "pt-BR": "Cuidados por estação", de: "Pflege nach Jahreszeit", es: "Cuidados por estación", pl: "Pielęgnacja w porach roku", it: "Cura stagionale" },
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
              unit: { en: "days", "pt-BR": "dias", de: "Tage", es: "días", pl: "dni", it: "giorni" },
              label: { en: "Water every", "pt-BR": "Regar a cada", de: "Gießen alle", es: "Regar cada", pl: "Podlewać co", it: "Annaffiare ogni" },
            },
            note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
          },
        },
        species: { type: "text", label: { en: "Species", "pt-BR": "Espécie", de: "Art", es: "Especie", pl: "Gatunek", it: "Specie" }, placeholder: "Monstera deliciosa" },
        tip: { type: "text", multiline: true, label: { en: "Care tip", "pt-BR": "Dica de cuidado", de: "Pflegetipp", es: "Consejo de cuidado", pl: "Wskazówka", it: "Consiglio di cura" } },
        lastFertilized: {
          type: "datetime",
          width: "half",
          label: { en: "Last fed", "pt-BR": "Última adubação", de: "Zuletzt gedüngt", es: "Último abono", pl: "Ostatnie nawożenie", it: "Ultima concimazione" },
        },
        // "Soil still wet": not before this day, and how many times in a row it was said.
        snoozedUntil: { type: "datetime", hidden: true, label: { en: "Not before", "pt-BR": "Não antes de", de: "Nicht vor", es: "No antes de", pl: "Nie wcześniej niż", it: "Non prima di" } },
        snoozes: { type: "number", integer: true, default: 0, hidden: true, label: { en: "Still wet, in a row", "pt-BR": "Ainda úmida, seguidas", de: "Noch nass, hintereinander", es: "Aún húmeda, seguidas", pl: "Wciąż wilgotna, z rzędu", it: "Ancora umida, di fila" } },
      },
      groups: [
        { fields: ["name", "species", "photo", "labels", "needsDirectSun"] },
        { title: { en: "Watering", "pt-BR": "Rega", de: "Gießen", es: "Riego", pl: "Podlewanie", it: "Annaffiatura" }, fields: ["lastWatered", "wateringIntervalDays", "rhythm", "nextText", "seasonalCare"] },
        { title: { en: "Care", "pt-BR": "Cuidados", de: "Pflege", es: "Cuidados", pl: "Pielęgnacja", it: "Cura" }, fields: ["lastFertilized", "feedText", "tip", "wiki", "active"], collapsible: true },
      ],
      computed: {
        currentIntervalDays: (p) => effectiveIntervalDays(p as unknown as Plant),
        nextWatering: (p) => nextWatering(p as unknown as Plant),
        overdue: (p) => p.active && Date.now() > nextWatering(p as unknown as Plant).getTime(),
        // The cover's chips and the record page's words: no "OVERDUE!", just what to do and when.
        nextText: {
          label: "💧",
          value: (p, ctx) =>
            !p.active
              ? ""
              : Date.now() > nextWatering(p as unknown as Plant).getTime()
                ? ctx.t({ en: "Thirsty — water today", "pt-BR": "Com sede — regar hoje", de: "Durstig — heute gießen", es: "Tiene sed — regar hoy", pl: "Spragniona — podlej dziś", it: "Ha sete — annaffia oggi" })
                : ctx.t({ en: "Water {when}", "pt-BR": "Regar {when}", de: "Gießen {when}", es: "Regar {when}", pl: "Podlej {when}", it: "Annaffia {when}" }, { when: when(nextWatering(p as unknown as Plant), ctx) }),
        },
        rhythm: {
          label: "🗓",
          value: (p, ctx) =>
            ctx.t(
              { en: "Every {n, plural, one {day} other {# days}}", "pt-BR": "A cada {n, plural, one {dia} other {# dias}}", de: "Alle {n, plural, one {Tag} other {# Tage}}", es: "Cada {n, plural, one {día} other {# días}}", pl: "Co {n, plural, one {dzień} few {# dni} many {# dni} other {# dnia}}", it: "Ogni {n, plural, one {giorno} other {# giorni}}" },
              { n: effectiveIntervalDays(p as unknown as Plant) },
            ),
        },
        sun: {
          label: "☀️",
          value: (p, ctx) =>
            p.needsDirectSun
              ? ctx.t({ en: "Direct sun", "pt-BR": "Sol direto", de: "Direkte Sonne", es: "Sol directo", pl: "Pełne słońce", it: "Sole diretto" })
              : ctx.t({ en: "Bright, no direct sun", "pt-BR": "Claridade, sem sol direto", de: "Hell, ohne direkte Sonne", es: "Luz, sin sol directo", pl: "Jasno, bez słońca", it: "Luminosa, senza sole diretto" }),
        },
        feedText: {
          label: { en: "Feeding", "pt-BR": "Adubação", de: "Düngen", es: "Abono", pl: "Nawożenie", it: "Concime" },
          value: (p, ctx) => {
            const next = nextFeed(p, ctx.now());
            return next
              ? ctx.t({ en: "Feed {when} (every 4 weeks in spring and summer)", "pt-BR": "Adubar {when} (a cada 4 semanas na primavera e no verão)", de: "Düngen {when} (alle 4 Wochen im Frühling und Sommer)", es: "Abonar {when} (cada 4 semanas en primavera y verano)", pl: "Nawóz {when} (co 4 tygodnie wiosną i latem)", it: "Concima {when} (ogni 4 settimane in primavera ed estate)" }, { when: when(next < ctx.now() ? ctx.now() : next, ctx) })
              : ctx.t({ en: "Resting: no feed until spring", "pt-BR": "Em repouso: sem adubo até a primavera", de: "Ruhezeit: kein Dünger bis zum Frühling", es: "En reposo: sin abono hasta la primavera", pl: "Odpoczywa: bez nawozu do wiosny", it: "A riposo: niente concime fino alla primavera" });
          },
        },
      },
      actions: {
        water: {
          label: { en: "Water", "pt-BR": "Regar", de: "Gießen", es: "Regar", pl: "Podlej", it: "Annaffia" },
          icon: "💧",
          description: "Record that this plant was watered now.",
          run: async (p, ctx) => {
            await logCare(ctx, p, "water", ctx.now());
          },
        },
        snooze: {
          label: { en: "Soil still wet", "pt-BR": "Terra ainda úmida", de: "Erde noch nass", es: "Tierra aún húmeda", pl: "Ziemia wciąż wilgotna", it: "Terra ancora umida" },
          icon: "⏳",
          description: "The soil is still wet: ask again in two days. Twice in a row stretches the plant's rhythm by a day.",
          run: async (p, ctx) => {
            // The rule, readable: two "still wet" in a row and the plant drinks less often than you thought.
            const snoozes = Number(p.snoozes ?? 0) + 1;
            const stretch = snoozes >= 2;
            const interval = Number(p.wateringIntervalDays) + (stretch ? 1 : 0);
            await ctx.patch("plant", p.id, { snoozedUntil: addDays(ctx.now(), 2), snoozes: stretch ? 0 : snoozes, wateringIntervalDays: interval });
            ctx.ui.toast(
              stretch
                ? ctx.t({ en: "{name} stays wet longer: every {n} days from now", "pt-BR": "{name} fica úmida por mais tempo: a cada {n} dias a partir de agora", de: "{name} bleibt länger feucht: ab jetzt alle {n} Tage", es: "{name} tarda más en secarse: cada {n} días desde ahora", pl: "{name} dłużej trzyma wilgoć: od teraz co {n} dni", it: "{name} resta umida più a lungo: d'ora in poi ogni {n} giorni" }, { name: String(p.name), n: interval })
                : ctx.t({ en: "Asking again in two days", "pt-BR": "Pergunto de novo em dois dias", de: "In zwei Tagen frage ich wieder", es: "Vuelvo a preguntar en dos días", pl: "Zapytam znowu za dwa dni", it: "Te lo richiedo tra due giorni" }),
            );
          },
        },
        logCare: {
          label: { en: "Log care…", "pt-BR": "Registrar cuidado…", de: "Pflege eintragen…", es: "Anotar cuidado…", pl: "Zapisz pielęgnację…", it: "Annota una cura…" },
          icon: "📝",
          description: "Record a watering, a feed, misting, repotting or a note, on any day — today or earlier.",
          input: {
            kind: {
              type: "enum",
              options: ["water", "fertilize", "mist", "repot", "prune", "note"],
              default: "water",
              label: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" },
              labels: {
                water: { en: "water", "pt-BR": "rega", de: "gießen", es: "riego", pl: "podlewanie", it: "annaffiatura" },
                fertilize: { en: "feed", "pt-BR": "adubo", de: "düngen", es: "abono", pl: "nawożenie", it: "concime" },
                mist: { en: "mist", "pt-BR": "borrifar", de: "besprühen", es: "pulverizar", pl: "zraszanie", it: "nebulizzare" },
                repot: { en: "repot", "pt-BR": "replantar", de: "umtopfen", es: "trasplantar", pl: "przesadzanie", it: "rinvaso" },
                prune: { en: "prune", "pt-BR": "podar", de: "schneiden", es: "podar", pl: "przycinanie", it: "potatura" },
                note: { en: "note", "pt-BR": "anotação", de: "Notiz", es: "nota", pl: "notatka", it: "nota" },
              },
            },
            at: { type: "datetime", required: true, label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
            note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
          },
          run: async (p, ctx, input) => {
            const { kind, at, note } = (input ?? {}) as { kind?: string; at?: Date | string; note?: string };
            await logCare(ctx, p, kind ?? "water", at ? new Date(at) : ctx.now(), note ?? "");
          },
        },
      },
    },

    // Every watering, feed and repot, on the day it happened: the plant's history.
    care: {
      label: { en: "Care", "pt-BR": "Cuidado", de: "Pflege", es: "Cuidado", pl: "Pielęgnacja", it: "Cura" },
      icon: "💧",
      displayField: "title",
      fields: {
        plant: { type: "relation", to: "plant", required: true, label: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" } },
        kind: {
          type: "enum",
          options: ["water", "fertilize", "mist", "repot", "prune", "note"],
          default: "water",
          colors: { water: "blue", fertilize: "green", mist: "teal", repot: "orange", prune: "yellow", note: "grey" },
          labels: {
            water: { en: "water", "pt-BR": "rega", de: "gießen", es: "riego", pl: "podlewanie", it: "annaffiatura" },
            fertilize: { en: "feed", "pt-BR": "adubo", de: "düngen", es: "abono", pl: "nawożenie", it: "concime" },
            mist: { en: "mist", "pt-BR": "borrifar", de: "besprühen", es: "pulverizar", pl: "zraszanie", it: "nebulizzare" },
            repot: { en: "repot", "pt-BR": "replantar", de: "umtopfen", es: "trasplantar", pl: "przesadzanie", it: "rinvaso" },
            prune: { en: "prune", "pt-BR": "podar", de: "schneiden", es: "podar", pl: "przycinanie", it: "potatura" },
            note: { en: "note", "pt-BR": "anotação", de: "Notiz", es: "nota", pl: "notatka", it: "nota" },
          },
          label: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" },
        },
        at: { type: "datetime", required: true, label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
        note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
      computed: {
        title: (c, ctx) => `${careName(c.kind, ctx)} · ${String(c.plant?.name ?? "—")}`,
        // On the plant's own page the plant goes without saying: what was done, and its glyph.
        what: (c, ctx) => careName(c.kind, ctx),
        glyph: (c) => ({ water: "💧", fertilize: "🌱", mist: "💨", repot: "🪴", prune: "✂️" } as Record<string, string>)[String(c.kind)] ?? "📝",
        picture: (c) => c.plant?.photo ?? null,
      },
    },
  },

  pages: [
    // Today: who wants water now, as photo rows you tick in one tap, what comes up this week, and the
    // figures. Each block is an ordinary view, so this page renders the same in the sealed box.
    {
      id: "today",
      title: { en: "Today", "pt-BR": "Hoje", de: "Heute", es: "Hoy", pl: "Dziś", it: "Oggi" },
      icon: "☀️",
      description: { en: "Who wants water today, and who can wait.", "pt-BR": "Quem quer água hoje, e quem pode esperar.", de: "Wer heute Wasser will, und wer warten kann.", es: "Quién quiere agua hoy, y quién puede esperar.", pl: "Kto dziś chce wody, a kto może poczekać.", it: "Chi vuole acqua oggi, e chi può aspettare." },
      background: { image: "art/leaves.webp" },
      actions: [{ label: { en: "Add a plant", "pt-BR": "Adicionar planta", de: "Pflanze hinzufügen", es: "Añadir planta", pl: "Dodaj roślinę", it: "Aggiungi pianta" }, icon: "＋", run: addPlant }],
      primaryAction: 0,
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
            title: { en: "Thirsty", "pt-BR": "Com sede", de: "Durstig", es: "Con sed", pl: "Spragnione", it: "Assetate" },
            span: 2,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.overdue,
              sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: {
                primary: "name",
                secondary: (p, ctx) =>
                  p.lastWatered
                    ? ctx.t({ en: "watered {when} · every {n} days", "pt-BR": "regada {when} · a cada {n} dias", de: "gegossen {when} · alle {n} Tage", es: "regada {when} · cada {n} días", pl: "podlana {when} · co {n} dni", it: "annaffiata {when} · ogni {n} giorni" }, { when: when(new Date(p.lastWatered), ctx), n: p.currentIntervalDays })
                    : ctx.t({ en: "never watered here yet", "pt-BR": "ainda não regada aqui", de: "hier noch nie gegossen", es: "aún no regada aquí", pl: "jeszcze tu nie podlana", it: "mai annaffiata qui" }),
                media: "photo",
              },
              rowActions: ["water"],
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: { en: "Everyone's had a drink. 🌱", "pt-BR": "Todas já beberam. 🌱", de: "Alle haben getrunken. 🌱", es: "Todas han bebido. 🌱", pl: "Wszystkie napojone. 🌱", it: "Hanno bevuto tutte. 🌱" },
            },
          },
          {
            title: { en: "Coming up", "pt-BR": "Em breve", de: "Demnächst", es: "Próximamente", pl: "Wkrótce", it: "In arrivo" },
            span: 3,
            view: {
              type: "list",
              entity: "plant",
              filter: (p) => p.active && !p.overdue && p.nextWatering.getTime() <= Date.now() + 7 * DAY,
              sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
              display: {
                primary: "name",
                secondary: (p, ctx) => ctx.t({ en: "water {when}", "pt-BR": "regar {when}", de: "gießen {when}", es: "regar {when}", pl: "podlej {when}", it: "annaffia {when}" }, { when: when(p.nextWatering, ctx) }),
                media: "photo",
              },
              onOpen: { page: "plant", param: { plantId: "id" } },
              emptyText: { en: "A quiet week ahead.", "pt-BR": "Uma semana tranquila pela frente.", de: "Eine ruhige Woche.", es: "Una semana tranquila.", pl: "Spokojny tydzień.", it: "Una settimana tranquilla." },
            },
          },
        ],
      },
    },
    {
      // Every plant as a photo, by where it lives.
      id: "list",
      title: { en: "Plants", "pt-BR": "Plantas", de: "Pflanzen", es: "Plantas", pl: "Rośliny", it: "Piante" },
      icon: "🪴",
      description: { en: "Every plant in the house, by its photo.", "pt-BR": "Todas as plantas da casa, pela foto.", de: "Alle Pflanzen im Haus, mit Foto.", es: "Todas las plantas de casa, con su foto.", pl: "Wszystkie rośliny w domu, ze zdjęciem.", it: "Tutte le piante di casa, con la foto." },
      view: {
        type: "list",
        entity: "plant",
        // Search matches the name and the person's own labels ("kitchen", "from Ana").
        filters: [
          {
            label: { en: "Search", "pt-BR": "Buscar", de: "Suche", es: "Buscar", pl: "Szukaj", it: "Cerca" },
            param: "q",
            type: "text",
            placeholder: { en: "Name or label", "pt-BR": "Nome ou etiqueta", de: "Name oder Schlagwort", es: "Nombre o etiqueta", pl: "Nazwa lub etykieta", it: "Nome o etichetta" },
          },
        ],
        filter: (p, ctx) => {
          const q = String(ctx.params.q ?? "").trim().toLowerCase();
          return !q || p.name.toLowerCase().includes(q) || ((p.labels as string[] | undefined) ?? []).some((l) => l.toLowerCase().includes(q));
        },
        sort: (a, b) => a.nextWatering.getTime() - b.nextWatering.getTime(),
        display: {
          primary: (p) => p.name,
          secondary: (p, ctx) =>
            p.overdue
              ? ctx.t({ en: "thirsty", "pt-BR": "com sede", de: "durstig", es: "con sed", pl: "spragniona", it: "assetata" })
              : ctx.t({ en: "water {when}", "pt-BR": "regar {when}", de: "gießen {when}", es: "regar {when}", pl: "podlej {when}", it: "annaffia {when}" }, { when: when(p.nextWatering, ctx) }),
          media: "photo",
          badges: ["labels"],
        },
        rowActions: ["water"],
        onOpen: { page: "plant", param: { plantId: "id" } },
      },
    },
    {
      // What was done, and when: every plant's care on one rail, newest first.
      id: "care-log",
      title: { en: "Care log", "pt-BR": "Diário", de: "Pflegebuch", es: "Diario", pl: "Dziennik", it: "Diario" },
      icon: "📖",
      description: { en: "Every watering, feed and repot. Log one on a plant's page, any day.", "pt-BR": "Cada rega, adubação e replantio. Registre na página da planta, em qualquer dia.", de: "Jedes Gießen, Düngen und Umtopfen. Trag es auf der Seite der Pflanze ein, an jedem Tag.", es: "Cada riego, abono y trasplante. Anótalo en la página de la planta, cualquier día.", pl: "Każde podlewanie, nawożenie i przesadzanie. Zapisz na stronie rośliny, dowolnego dnia.", it: "Ogni annaffiatura, concimazione e rinvaso. Annotali nella pagina della pianta, in qualsiasi giorno." },
      view: {
        type: "timeline",
        entity: "care",
        date: "at",
        groupBy: "week",
        color: "kind",
        display: { primary: "title", secondary: "note", media: "picture" },
        emptyText: { en: "Nothing logged yet. Water a plant and it shows here.", "pt-BR": "Nada registrado ainda. Regue uma planta e ela aparece aqui.", de: "Noch nichts eingetragen. Gieß eine Pflanze, dann steht es hier.", es: "Aún no hay nada. Riega una planta y aparecerá aquí.", pl: "Jeszcze nic. Podlej roślinę, a pojawi się tutaj.", it: "Ancora niente. Annaffia una pianta e comparirà qui." },
      },
    },
    {
      id: "schedule",
      title: { en: "Schedule", "pt-BR": "Agenda", de: "Gießplan", es: "Calendario", pl: "Harmonogram", it: "Calendario" },
      icon: "📅",
      view: {
        type: "calendar",
        entity: "plant",
        date: "nextWatering",
        title: (p) => p.name,
        color: (p) => (p.needsDirectSun ? "#E4A93C" : "#7FCF8E"),
      },
    },
    {
      // A plant's own page: its photo, what it needs, and Water as the one big button.
      id: "plant",
      title: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" },
      hidden: true,
      view: {
        type: "detail",
        entity: "plant",
        param: "plantId",
        cover: "banner",
        facts: ["nextText", "rhythm", "sun"],
        primaryAction: "water",
        actions: ["snooze", "logCare"],
        sections: [
          {
            title: { en: "Watering", "pt-BR": "Rega", de: "Gießen", es: "Riego", pl: "Podlewanie", it: "Annaffiatura" },
            fields: ["lastWatered", "wateringIntervalDays", "seasonalCare"],
          },
          {
            // The plant's history, on its own page: every watering, feed and repot, newest first.
            title: { en: "Care log", "pt-BR": "Diário", de: "Pflegebuch", es: "Diario", pl: "Dziennik", it: "Diario" },
            related: { entity: "care", via: "plant", view: "timeline", date: "at", display: { primary: "what", secondary: "note", icon: "glyph" }, limit: 12 },
          },
          {
            title: { en: "About", "pt-BR": "Sobre", de: "Info", es: "Información", pl: "Informacje", it: "Info" },
            fields: ["species", "labels", "needsDirectSun", "tip", "lastFertilized", "feedText", "wiki", "active"],
            collapsible: true,
          },
        ],
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
    {
      id: "feed-due",
      entity: "plant",
      when: (p, ctx) => nextFeed(p, ctx.now()),
      title: (p, ctx) => ctx.t({ en: "Feed {name}", "pt-BR": "Adubar: {name}", de: "{name} düngen", es: "Abonar: {name}", pl: "Nawieź: {name}", it: "Concima: {name}" }, { name: p.name }),
      body: (_p, ctx) => ctx.t({ en: "Every four weeks while it grows", "pt-BR": "A cada quatro semanas enquanto cresce", de: "Alle vier Wochen, solange sie wächst", es: "Cada cuatro semanas mientras crece", pl: "Co cztery tygodnie, póki rośnie", it: "Ogni quattro settimane finché cresce" }),
    },
  ],
});
