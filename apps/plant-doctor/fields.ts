// A plant's fields and a check-up's, and the form a plant is saved with — the same fields, so what
// the form shows is exactly what is kept.

import type { Field } from "potyro";
import { HEALTH, KINDS, LIGHTS, SURE, TRENDS } from "./care.js";
import { HEALTH_WORDS, KIND_WORDS, LIGHT_WORDS, SURE_WORDS, TREND_WORDS } from "./words.js";

const photo = { type: "media", accept: "image", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } } satisfies Field;

export const PLANT_FIELDS = {
  name: {
    type: "text",
    required: true,
    label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
    placeholder: { en: "The pothos by the window", "pt-BR": "A jiboia da janela", de: "Die Efeutute am Fenster", es: "El poto de la ventana", pl: "Epipremnum przy oknie", it: "Il pothos alla finestra" },
  },
  species: { type: "text", label: { en: "Kind of plant", "pt-BR": "Espécie", de: "Art", es: "Especie", pl: "Gatunek", it: "Specie" } },
  photo,
  light: {
    type: "enum",
    options: [...LIGHTS],
    default: "medium",
    control: "picker",
    width: "half",
    label: { en: "Light", "pt-BR": "Luz", de: "Licht", es: "Luz", pl: "Światło", it: "Luce" },
    labels: LIGHT_WORDS,
  },
  waterEvery: {
    type: "number",
    integer: true,
    min: 1,
    max: 30,
    default: 7,
    width: "half",
    unit: { en: "days", "pt-BR": "dias", de: "Tage", es: "días", pl: "dni", it: "giorni" },
    label: { en: "Water every", "pt-BR": "Regar a cada", de: "Gießen alle", es: "Regar cada", pl: "Podlewać co", it: "Annaffiare ogni" },
  },
  lastWatered: { type: "datetime", label: { en: "Last watered", "pt-BR": "Última rega", de: "Zuletzt gegossen", es: "Último riego", pl: "Ostatnio podlana", it: "Ultima annaffiatura" } },
  watch: { type: "text", multiline: true, label: { en: "Keep an eye on", "pt-BR": "Fique de olho em", de: "Im Blick behalten", es: "Vigilar", pl: "Obserwuj", it: "Tieni d'occhio" } },
  health: {
    type: "enum",
    options: [...HEALTH],
    default: "okay",
    label: { en: "How it's doing", "pt-BR": "Como está", de: "Wie es ihr geht", es: "Cómo está", pl: "Jak się ma", it: "Come sta" },
    labels: HEALTH_WORDS,
    colors: { thriving: "green", okay: "teal", struggling: "orange", serious: "red" },
  },
  nextCheck: { type: "datetime", label: { en: "Next check-up photo", "pt-BR": "Próxima foto de revisão", de: "Nächstes Check-Foto", es: "Próxima foto de revisión", pl: "Następne zdjęcie kontrolne", it: "Prossima foto di controllo" } },
} satisfies Record<string, Field>;

export const CHECK_FIELDS = {
  plant: { type: "relation", to: "plant", label: { en: "Plant", "pt-BR": "Planta", de: "Pflanze", es: "Planta", pl: "Roślina", it: "Pianta" } },
  date: { type: "datetime", precision: "minute", label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
  photo,
  problem: { type: "text", label: { en: "Problem", "pt-BR": "Problema", de: "Problem", es: "Problema", pl: "Problem", it: "Problema" } },
  kind: {
    type: "enum",
    options: [...KINDS],
    label: { en: "Kind of problem", "pt-BR": "Tipo de problema", de: "Art des Problems", es: "Tipo de problema", pl: "Rodzaj problemu", it: "Tipo di problema" },
    labels: KIND_WORDS,
    colors: { none: "green", overwatering: "blue", underwatering: "orange", light: "yellow", pests: "red", nutrients: "purple", disease: "red", temperature: "teal", unsure: "grey" },
  },
  sure: { type: "enum", options: [...SURE], label: { en: "How sure", "pt-BR": "Certeza", de: "Wie sicher", es: "Seguridad", pl: "Pewność", it: "Quanto sicuro" }, labels: SURE_WORDS },
  plantName: { type: "text", hidden: true, label: { en: "Plant guess", "pt-BR": "Planta provável", de: "Vermutete Pflanze", es: "Planta probable", pl: "Prawdopodobna roślina", it: "Pianta probabile" } },
  latin: { type: "text", hidden: true, label: { en: "Botanical name", "pt-BR": "Nome científico", de: "Botanischer Name", es: "Nombre botánico", pl: "Nazwa łacińska", it: "Nome botanico" } },
  plantSure: { type: "enum", options: [...SURE], hidden: true, label: { en: "How sure of the plant", "pt-BR": "Certeza da planta", de: "Wie sicher die Pflanze", es: "Seguridad de la planta", pl: "Pewność co do rośliny", it: "Quanto sicuro della pianta" }, labels: SURE_WORDS },
  signs: { type: "text", multiline: true, label: { en: "What it looks like", "pt-BR": "Como parece", de: "Wie es aussieht", es: "Cómo se ve", pl: "Jak to wygląda", it: "Come appare" } },
  toCheck: { type: "text", multiline: true, label: { en: "What to check", "pt-BR": "O que verificar", de: "Was du prüfen kannst", es: "Qué revisar", pl: "Co sprawdzić", it: "Cosa controllare" } },
  toDo: { type: "text", multiline: true, label: { en: "What to do", "pt-BR": "O que fazer", de: "Was du tun kannst", es: "Qué hacer", pl: "Co zrobić", it: "Cosa fare" } },
  serious: { type: "boolean", label: { en: "Could be serious", "pt-BR": "Pode ser sério", de: "Könnte ernst sein", es: "Podría ser serio", pl: "Może być poważne", it: "Potrebbe essere serio" } },
  trend: {
    type: "enum",
    options: [...TRENDS],
    label: { en: "Since last time", "pt-BR": "Desde a última vez", de: "Seit dem letzten Mal", es: "Desde la última vez", pl: "Od ostatniego razu", it: "Dall'ultima volta" },
    labels: TREND_WORDS,
    colors: { first: "blue", better: "green", same: "grey", worse: "red", unsure: "grey" },
  },
  trendNote: { type: "text", hidden: true, label: { en: "What changed", "pt-BR": "O que mudou", de: "Was sich geändert hat", es: "Qué cambió", pl: "Co się zmieniło", it: "Cosa è cambiato" } },
  sample: { type: "boolean", hidden: true, label: { en: "Sample", "pt-BR": "Exemplo", de: "Beispiel", es: "Ejemplo", pl: "Przykład", it: "Esempio" } },
} satisfies Record<string, Field>;

/** The form a new plant is saved with: what to call it, and its care plan — filled in from the look. */
export const SAVE_FIELDS: Record<string, Field> = {
  name: PLANT_FIELDS.name,
  species: PLANT_FIELDS.species,
  light: PLANT_FIELDS.light,
  waterEvery: PLANT_FIELDS.waterEvery,
  lastWatered: {
    ...PLANT_FIELDS.lastWatered,
    help: {
      en: "Don't remember? Leave it empty: it shows as due today — water it if the soil is dry a finger deep",
      "pt-BR": "Não lembra? Deixe vazio: aparece para hoje — regue se a terra estiver seca a um dedo de profundidade",
      de: "Weißt du es nicht? Leer lassen: dann ist es heute fällig — gieß, wenn die Erde einen Finger tief trocken ist",
      es: "¿No lo recuerdas? Déjalo vacío: saldrá para hoy; riega si la tierra está seca a un dedo de profundidad",
      pl: "Nie pamiętasz? Zostaw puste: będzie na dziś — podlej, jeśli ziemia jest sucha na głębokość palca",
      it: "Non ricordi? Lascialo vuoto: risulterà per oggi; annaffia se il terriccio è asciutto a un dito di profondità",
    },
  },
};
