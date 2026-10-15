// How a plant and a check-up read — and, above all, how sure they sound. The app never says "is":
// a high-confidence look is "most likely", a medium one "probably", a low one "possibly — hard to
// tell from a photo", and every check-up ends with when to ask a person who can see the plant.
//
// Words through `ctx.t`, dates through `ctx.format`, so they read the same in the sealed box as in
// the person's own copy. In six languages (docs/20); every language but English is a model's draft
// (#297). What the model wrote (a problem's name, its signs) is already in the person's language.

import type { Ctx, Words } from "potyro";
import { checkRemindAt, checkupDue, daysBetween, isLight, toDate, waterEvery, waterIn, waterRemindAt, type Health, type Kind, type Light, type Row, type Sure, type Trend } from "./care.js";

export type Say = Pick<Ctx, "t" | "format">;

export const LIGHT_WORDS: Record<Light, Words> = {
  low: { en: "Low light", "pt-BR": "Pouca luz", de: "Wenig Licht", es: "Poca luz", pl: "Mało światła", it: "Poca luce" },
  medium: { en: "Medium light", "pt-BR": "Luz média", de: "Mittleres Licht", es: "Luz media", pl: "Średnio jasno", it: "Luce media" },
  bright: { en: "Bright, indirect light", "pt-BR": "Muita luz, indireta", de: "Hell, ohne direkte Sonne", es: "Mucha luz, indirecta", pl: "Jasno, bez bezpośredniego słońca", it: "Molta luce, indiretta" },
  sun: { en: "Direct sun", "pt-BR": "Sol direto", de: "Direkte Sonne", es: "Sol directo", pl: "Pełne słońce", it: "Sole diretto" },
};

export const KIND_WORDS: Record<Kind, Words> = {
  none: { en: "Looks healthy", "pt-BR": "Parece saudável", de: "Sieht gesund aus", es: "Parece sana", pl: "Wygląda zdrowo", it: "Sembra sana" },
  overwatering: { en: "Too much water", "pt-BR": "Água demais", de: "Zu viel Wasser", es: "Demasiada agua", pl: "Za dużo wody", it: "Troppa acqua" },
  underwatering: { en: "Too little water", "pt-BR": "Pouca água", de: "Zu wenig Wasser", es: "Poca agua", pl: "Za mało wody", it: "Poca acqua" },
  light: { en: "Light", "pt-BR": "Luz", de: "Licht", es: "Luz", pl: "Światło", it: "Luce" },
  pests: { en: "Pests", "pt-BR": "Pragas", de: "Schädlinge", es: "Plagas", pl: "Szkodniki", it: "Parassiti" },
  nutrients: { en: "Nutrients", "pt-BR": "Nutrientes", de: "Nährstoffe", es: "Nutrientes", pl: "Składniki odżywcze", it: "Nutrienti" },
  disease: { en: "Disease", "pt-BR": "Doença", de: "Krankheit", es: "Enfermedad", pl: "Choroba", it: "Malattia" },
  temperature: { en: "Temperature", "pt-BR": "Temperatura", de: "Temperatur", es: "Temperatura", pl: "Temperatura", it: "Temperatura" },
  unsure: { en: "Hard to tell", "pt-BR": "Difícil dizer", de: "Schwer zu sagen", es: "Difícil de decir", pl: "Trudno powiedzieć", it: "Difficile dirlo" },
};

export const SURE_WORDS: Record<Sure, Words> = {
  low: { en: "Not sure", "pt-BR": "Sem certeza", de: "Unsicher", es: "Sin seguridad", pl: "Niepewne", it: "Incerto" },
  medium: { en: "Fairly sure", "pt-BR": "Razoavelmente seguro", de: "Ziemlich sicher", es: "Bastante seguro", pl: "Dość pewne", it: "Abbastanza sicuro" },
  high: { en: "Quite sure", "pt-BR": "Bem seguro", de: "Recht sicher", es: "Muy probable", pl: "Raczej pewne", it: "Piuttosto sicuro" },
};

export const HEALTH_WORDS: Record<Health, Words> = {
  thriving: { en: "Doing well", "pt-BR": "Vai bem", de: "Geht es gut", es: "Va bien", pl: "Ma się dobrze", it: "Sta bene" },
  okay: { en: "Okay", "pt-BR": "Razoável", de: "Ganz gut", es: "Regular", pl: "W porządku", it: "Così così" },
  struggling: { en: "Struggling", "pt-BR": "Com dificuldade", de: "Kränkelt", es: "Con problemas", pl: "Słabnie", it: "In difficoltà" },
  serious: { en: "Needs help", "pt-BR": "Precisa de ajuda", de: "Braucht Hilfe", es: "Necesita ayuda", pl: "Potrzebuje pomocy", it: "Ha bisogno d'aiuto" },
};

export const TREND_WORDS: Record<Trend, Words> = {
  first: { en: "First look", "pt-BR": "Primeira olhada", de: "Erster Blick", es: "Primera mirada", pl: "Pierwsze oględziny", it: "Primo sguardo" },
  better: { en: "Better", "pt-BR": "Melhor", de: "Besser", es: "Mejor", pl: "Lepiej", it: "Meglio" },
  same: { en: "About the same", "pt-BR": "Igual", de: "Etwa gleich", es: "Igual", pl: "Bez zmian", it: "Più o meno uguale" },
  worse: { en: "Worse", "pt-BR": "Pior", de: "Schlechter", es: "Peor", pl: "Gorzej", it: "Peggio" },
  unsure: { en: "Hard to compare", "pt-BR": "Difícil comparar", de: "Schwer zu vergleichen", es: "Difícil de comparar", pl: "Trudno porównać", it: "Difficile da confrontare" },
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const sureOf = (v: unknown): Sure => (v === "high" || v === "medium" ? v : "low");

/** What the check-up says is wrong, as sure as it is and no surer. */
export function headline(record: object, say: Say): string {
  const r = record as Row;
  const sure = sureOf(r.sure);
  const kind = (r.kind ?? "unsure") as Kind;
  if (kind === "unsure") return say.t({ en: "Hard to tell from this photo", "pt-BR": "Difícil dizer por esta foto", de: "Auf diesem Foto schwer zu sagen", es: "Difícil de decir con esta foto", pl: "Trudno ocenić po tym zdjęciu", it: "Difficile dirlo da questa foto" });
  if (kind === "none") {
    if (sure === "low") return say.t({ en: "Probably fine — hard to tell from a photo", "pt-BR": "Provavelmente bem — difícil dizer por uma foto", de: "Wahrscheinlich gesund — auf einem Foto schwer zu sagen", es: "Probablemente bien: difícil de decir con una foto", pl: "Chyba w porządku — trudno ocenić po zdjęciu", it: "Probabilmente sta bene: difficile dirlo da una foto" });
    return say.t({ en: "Looks healthy", "pt-BR": "Parece saudável", de: "Sieht gesund aus", es: "Parece sana", pl: "Wygląda zdrowo", it: "Sembra sana" });
  }
  const problem = str(r.problem) || say.t(KIND_WORDS[kind] ?? KIND_WORDS.unsure);
  if (sure === "high") return say.t({ en: "Most likely: {problem}", "pt-BR": "O mais provável: {problem}", de: "Höchstwahrscheinlich: {problem}", es: "Lo más probable: {problem}", pl: "Najpewniej: {problem}", it: "Molto probabilmente: {problem}" }, { problem });
  if (sure === "medium") return say.t({ en: "Probably: {problem}", "pt-BR": "Provavelmente: {problem}", de: "Wahrscheinlich: {problem}", es: "Probablemente: {problem}", pl: "Prawdopodobnie: {problem}", it: "Probabilmente: {problem}" }, { problem });
  return say.t(
    { en: "Possibly: {problem} — hard to tell from a photo", "pt-BR": "Talvez: {problem} — difícil dizer por uma foto", de: "Vielleicht: {problem} — auf einem Foto schwer zu sagen", es: "Quizá: {problem}; difícil de decir con una foto", pl: "Możliwe: {problem} — trudno ocenić po zdjęciu", it: "Forse: {problem}; difficile dirlo da una foto" },
    { problem },
  );
}

/** Which plant it seems to be, as sure as it is: "Probably a Pothos (Epipremnum aureum)". */
export function plantLine(record: object, say: Say): string {
  const r = record as Row;
  const name = str(r.plantName);
  const latin = str(r.latin);
  if (!name && !latin) return say.t({ en: "Not sure which plant this is", "pt-BR": "Não dá para saber que planta é", de: "Unklar, welche Pflanze das ist", es: "No se sabe qué planta es", pl: "Nie wiadomo, co to za roślina", it: "Non si sa che pianta sia" });
  const plant = name && latin && name.toLowerCase() !== latin.toLowerCase() ? `${name} (${latin})` : name || latin;
  const sure = sureOf(r.plantSure);
  if (sure === "high") return say.t({ en: "Looks like: {plant}", "pt-BR": "Parece ser: {plant}", de: "Sieht aus wie: {plant}", es: "Parece: {plant}", pl: "Wygląda na: {plant}", it: "Sembra: {plant}" }, { plant });
  if (sure === "medium") return say.t({ en: "Probably: {plant}", "pt-BR": "Provavelmente: {plant}", de: "Wahrscheinlich: {plant}", es: "Probablemente: {plant}", pl: "Prawdopodobnie: {plant}", it: "Probabilmente: {plant}" }, { plant });
  return say.t({ en: "Maybe: {plant} — not sure", "pt-BR": "Talvez: {plant} — sem certeza", de: "Vielleicht: {plant} — unsicher", es: "Quizá: {plant}; sin seguridad", pl: "Może: {plant} — niepewne", it: "Forse: {plant}; incerto" }, { plant });
}

/** Better or worse since the earlier photo, with what changed; the first look says what comes next. */
export function trendText(record: object, say: Say): string {
  const r = record as Row;
  const trend = (r.trend ?? "first") as Trend;
  if (trend === "first")
    return say.t({
      en: "First look. The next photo will be compared with this one.",
      "pt-BR": "Primeira olhada. A próxima foto será comparada com esta.",
      de: "Erster Blick. Das nächste Foto wird mit diesem verglichen.",
      es: "Primera mirada. La próxima foto se comparará con esta.",
      pl: "Pierwsze oględziny. Następne zdjęcie zostanie porównane z tym.",
      it: "Primo sguardo. La prossima foto sarà confrontata con questa.",
    });
  const head =
    trend === "better"
      ? say.t({ en: "Better since last time", "pt-BR": "Melhor que da última vez", de: "Besser als beim letzten Mal", es: "Mejor que la última vez", pl: "Lepiej niż ostatnio", it: "Meglio dell'ultima volta" })
      : trend === "worse"
        ? say.t({ en: "Worse since last time", "pt-BR": "Pior que da última vez", de: "Schlechter als beim letzten Mal", es: "Peor que la última vez", pl: "Gorzej niż ostatnio", it: "Peggio dell'ultima volta" })
        : trend === "same"
          ? say.t({ en: "About the same as last time", "pt-BR": "Mais ou menos igual à última vez", de: "Etwa wie beim letzten Mal", es: "Más o menos igual que la última vez", pl: "Mniej więcej jak ostatnio", it: "Più o meno come l'ultima volta" })
          : say.t({ en: "Hard to compare with last time", "pt-BR": "Difícil comparar com a última vez", de: "Schwer mit dem letzten Mal zu vergleichen", es: "Difícil de comparar con la última vez", pl: "Trudno porównać z poprzednim razem", it: "Difficile da confrontare con l'ultima volta" });
  const note = str(r.trendNote);
  return note ? `${head}. ${note}` : `${head}.`;
}

/** When to ask a person who can see the plant — always said, louder when it could be serious. */
export function expertText(record: object, say: Say): string {
  const r = record as Row;
  if (r.serious)
    return say.t({
      en: "This could be serious. Keep it away from your other plants, and if it gets worse take this photo — or a leaf in a bag — to a garden centre or a plant expert.",
      "pt-BR": "Isto pode ser sério. Afaste-a das outras plantas e, se piorar, leve esta foto — ou uma folha num saquinho — a um viveiro ou a um especialista em plantas.",
      de: "Das könnte ernst sein. Stell sie weg von deinen anderen Pflanzen, und wenn es schlimmer wird, zeig dieses Foto — oder ein Blatt in einer Tüte — in einer Gärtnerei oder einer Fachperson für Pflanzen.",
      es: "Esto podría ser serio. Apártala de tus otras plantas y, si empeora, lleva esta foto —o una hoja en una bolsa— a un vivero o a un experto en plantas.",
      pl: "To może być poważne. Odstaw ją od innych roślin, a jeśli będzie gorzej, pokaż to zdjęcie — albo liść w woreczku — w centrum ogrodniczym lub komuś, kto zna się na roślinach.",
      it: "Potrebbe essere serio. Tienila lontana dalle altre piante e, se peggiora, porta questa foto, o una foglia in un sacchetto, a un vivaio o a un esperto di piante.",
    });
  return say.t({
    en: "A photo can't be sure. If it isn't better by the next check-up, a garden centre or a plant expert can look at it.",
    "pt-BR": "Uma foto não dá certeza. Se não melhorar até a próxima revisão, um viveiro ou um especialista em plantas pode olhar.",
    de: "Ein Foto gibt keine Gewissheit. Wenn es bis zum nächsten Check nicht besser ist, kann eine Gärtnerei oder eine Fachperson draufschauen.",
    es: "Una foto no da certeza. Si no mejora para la próxima revisión, un vivero o un experto en plantas puede mirarla.",
    pl: "Zdjęcie nie daje pewności. Jeśli do następnego sprawdzenia nie będzie lepiej, niech obejrzy ją ktoś w centrum ogrodniczym.",
    it: "Una foto non dà certezze. Se non migliora entro il prossimo controllo, un vivaio o un esperto di piante può guardarla.",
  });
}

/** "Water today", "Water in 3 days", "Water is 2 days late". */
export function waterText(plant: { [k: string]: unknown }, say: Say, today: Date): string {
  const n = waterIn(plant, today);
  if (n < 0)
    return say.t(
      { en: "{n, plural, one {Water is # day late} other {Water is # days late}}", "pt-BR": "{n, plural, one {Rega atrasada # dia} other {Rega atrasada # dias}}", de: "{n, plural, one {Gießen seit # Tag fällig} other {Gießen seit # Tagen fällig}}", es: "{n, plural, one {Riego con # día de retraso} other {Riego con # días de retraso}}", pl: "{n, plural, one {Podlewanie spóźnione o # dzień} few {Podlewanie spóźnione o # dni} many {Podlewanie spóźnione o # dni} other {Podlewanie spóźnione o # dnia}}", it: "{n, plural, one {Annaffiatura in ritardo di # giorno} other {Annaffiatura in ritardo di # giorni}}" },
      { n: -n },
    );
  if (n === 0) return say.t({ en: "Water today", "pt-BR": "Regar hoje", de: "Heute gießen", es: "Regar hoy", pl: "Podlej dziś", it: "Da annaffiare oggi" });
  if (n === 1) return say.t({ en: "Water tomorrow", "pt-BR": "Regar amanhã", de: "Morgen gießen", es: "Regar mañana", pl: "Podlej jutro", it: "Da annaffiare domani" });
  return say.t(
    { en: "Water in {n} days", "pt-BR": "Regar em {n} dias", de: "In {n} Tagen gießen", es: "Regar en {n} días", pl: "{n, plural, few {Podlej za # dni} many {Podlej za # dni} other {Podlej za # dnia}}", it: "Da annaffiare tra {n} giorni" },
    { n },
  );
}

/** "Next check-up photo in 7 days", "Check-up photo due today". Empty when none is planned. */
export function checkText(plant: { [k: string]: unknown }, say: Say, today: Date): string {
  const day = toDate(plant.nextCheck);
  if (!day) return "";
  if (checkupDue(plant, today)) return say.t({ en: "Check-up photo due", "pt-BR": "Hora da foto de revisão", de: "Zeit für ein Check-Foto", es: "Toca la foto de revisión", pl: "Czas na zdjęcie kontrolne", it: "È ora della foto di controllo" });
  const n = daysBetween(today, day);
  return say.t(
    {
      en: "{n, plural, one {Next check-up photo tomorrow} other {Next check-up photo in # days}}",
      "pt-BR": "{n, plural, one {Próxima foto de revisão amanhã} other {Próxima foto de revisão em # dias}}",
      de: "{n, plural, one {Nächstes Check-Foto morgen} other {Nächstes Check-Foto in # Tagen}}",
      es: "{n, plural, one {Próxima foto de revisión mañana} other {Próxima foto de revisión en # días}}",
      pl: "{n, plural, one {Następne zdjęcie kontrolne jutro} few {Następne zdjęcie kontrolne za # dni} many {Następne zdjęcie kontrolne za # dni} other {Następne zdjęcie kontrolne za # dnia}}",
      it: "{n, plural, one {Prossima foto di controllo domani} other {Prossima foto di controllo tra # giorni}}",
    },
    { n },
  );
}

/** The reminders as they will come: "Water: Fri 23 Oct, 9:00 · Check-up photo: Thu 22 Oct, 9:00". */
export function remindersText(plant: { [k: string]: unknown }, say: Say, now: Date): string {
  const at = (d: Date) => say.format.date(d, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const water = waterRemindAt(plant, now);
  const check = checkRemindAt(plant, now);
  const parts = [
    water ? say.t({ en: "Water: {when}", "pt-BR": "Rega: {when}", de: "Gießen: {when}", es: "Riego: {when}", pl: "Podlewanie: {when}", it: "Acqua: {when}" }, { when: at(water) }) : "",
    check ? say.t({ en: "Check-up photo: {when}", "pt-BR": "Foto de revisão: {when}", de: "Check-Foto: {when}", es: "Foto de revisión: {when}", pl: "Zdjęcie kontrolne: {when}", it: "Foto di controllo: {when}" }, { when: at(check) }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : say.t({ en: "None coming", "pt-BR": "Nenhum por vir", de: "Keine geplant", es: "Ninguno pendiente", pl: "Brak zaplanowanych", it: "Nessuno in arrivo" });
}

/** "Every 7 days · Bright, indirect light" — the plan in one line. */
export function planText(plant: { [k: string]: unknown }, say: Say): string {
  const light: Light = isLight(plant.light) ? plant.light : "medium";
  const every = waterEvery(plant.waterEvery, light);
  return `${say.t({ en: "{n, plural, one {Water every day} other {Water every # days}}", "pt-BR": "{n, plural, one {Regar todo dia} other {Regar a cada # dias}}", de: "{n, plural, one {Jeden Tag gießen} other {Alle # Tage gießen}}", es: "{n, plural, one {Regar cada día} other {Regar cada # días}}", pl: "{n, plural, one {Podlewać codziennie} few {Podlewać co # dni} many {Podlewać co # dni} other {Podlewać co # dnia}}", it: "{n, plural, one {Annaffiare ogni giorno} other {Annaffiare ogni # giorni}}" }, { n: every })} · ${say.t(LIGHT_WORDS[light])}`;
}

/** The share sheet's text for a plant's care plan. */
export function carePlanShare(plant: { [k: string]: unknown }, latest: { [k: string]: unknown } | null, say: Say): string {
  const name = str(plant.name);
  const species = str(plant.species);
  const lines = [species && species !== name ? `${name} — ${species}` : name, planText(plant, say)];
  const watch = str(plant.watch);
  if (watch) lines.push(`${say.t({ en: "Keep an eye on:", "pt-BR": "Fique de olho em:", de: "Im Blick behalten:", es: "Vigila:", pl: "Obserwuj:", it: "Tieni d'occhio:" })}\n${watch}`);
  if (latest) lines.push(`${say.t({ en: "Last check-up:", "pt-BR": "Última revisão:", de: "Letzter Check:", es: "Última revisión:", pl: "Ostatnie sprawdzenie:", it: "Ultimo controllo:" })} ${headline(latest, say)}`);
  return lines.join("\n\n");
}

/** The share sheet's text for one check-up — said to be a guess, because it is one. */
export function checkShare(check: { [k: string]: unknown }, plantName: string, say: Say): string {
  const lines = [`${plantName}: ${headline(check, say)}`];
  const toCheck = str(check.toCheck);
  if (toCheck) lines.push(`${say.t({ en: "What to check:", "pt-BR": "O que verificar:", de: "Was du prüfen kannst:", es: "Qué revisar:", pl: "Co sprawdzić:", it: "Cosa controllare:" })}\n${toCheck}`);
  const toDo = str(check.toDo);
  if (toDo) lines.push(`${say.t({ en: "What to do:", "pt-BR": "O que fazer:", de: "Was du tun kannst:", es: "Qué hacer:", pl: "Co zrobić:", it: "Cosa fare:" })}\n${toDo}`);
  lines.push(
    say.t({
      en: "(A guess from a photo by Plant Doctor's AI, not a diagnosis.)",
      "pt-BR": "(Um palpite a partir de uma foto, feito pela IA do Doutor de Plantas — não um diagnóstico.)",
      de: "(Eine Einschätzung der KI von Pflanzendoktor anhand eines Fotos, keine Diagnose.)",
      es: "(Una suposición de la IA de Doctor de Plantas a partir de una foto, no un diagnóstico.)",
      pl: "(Domysł AI Lekarza Roślin na podstawie zdjęcia, nie diagnoza.)",
      it: "(Un'ipotesi dell'IA di Dottore delle Piante da una foto, non una diagnosi.)",
    }),
  );
  return lines.join("\n\n");
}
