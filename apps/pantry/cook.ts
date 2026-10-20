// What can I cook? Two or three simple ideas that use first what expires first.
//
// What is sent is the names of the things in the kitchen that go off soonest and how many days each
// has left — the one thing an idea needs — and nothing else: no amounts, no photos, no other record.
// The person is told so before anything goes. An idea that names something not in the kitchen keeps
// only the things that are: the app does not let the model invent a pantry.

import type { AiValue, Ctx, Resolved } from "potyro";
import { sampleIdeas, sampleName, type SampleKey } from "./sample.js";
import { byExpiry, daysBetween, toDate } from "./shelf-life.js";

export const IDEAS = {
  ideas: [{ title: "text", uses: ["text"], minutes: "number?", steps: ["text"] }],
} as const;

export type IdeasAnswer = AiValue<typeof IDEAS>;

/** How many of the soonest-to-go things are offered to the model. */
export const MAX_SENT = 10;

const W = {
  empty: {
    en: "Add what's in your kitchen first — then there's something to cook with.",
    "pt-BR": "Adicione primeiro o que tem na cozinha — aí sim há com o que cozinhar.",
    de: "Füge zuerst hinzu, was in deiner Küche ist — dann gibt es etwas zum Kochen.",
    es: "Añade primero lo que hay en tu cocina: así habrá con qué cocinar.",
    pl: "Najpierw dodaj, co masz w kuchni — wtedy będzie z czego gotować.",
    it: "Aggiungi prima cosa c'è in cucina: così ci sarà qualcosa con cui cucinare.",
  },
  asking: {
    en: "Asking for ideas with {list}…",
    "pt-BR": "Pedindo ideias com {list}…",
    de: "Ideen mit {list} werden gesucht…",
    es: "Pidiendo ideas con {list}…",
    pl: "Szukam pomysłów z: {list}…",
    it: "Cerco idee con {list}…",
  },
  title: {
    en: "What can I cook?",
    "pt-BR": "O que posso cozinhar?",
    de: "Was kann ich kochen?",
    es: "¿Qué puedo cocinar?",
    pl: "Co mogę ugotować?",
    it: "Cosa posso cucinare?",
  },
  ask: { en: "Ask for 2–3 ideas", "pt-BR": "Pedir 2–3 ideias", de: "2–3 Ideen holen", es: "Pedir 2–3 ideas", pl: "Poproś o 2–3 pomysły", it: "Chiedi 2–3 idee" },
  askDetail: {
    en: "Sends only these names and how long each has left: {list}",
    "pt-BR": "Envia só estes nomes e quanto tempo falta para cada um: {list}",
    de: "Sendet nur diese Namen und wie lange jedes noch hält: {list}",
    es: "Envía solo estos nombres y cuánto le queda a cada uno: {list}",
    pl: "Wysyła tylko te nazwy i ile każdemu zostało: {list}",
    it: "Invia solo questi nomi e quanto manca a ciascuno: {list}",
  },
  sample: {
    en: "Show ideas for the sample shelf",
    "pt-BR": "Mostrar ideias para a prateleira de exemplo",
    de: "Ideen für das Beispielfach zeigen",
    es: "Ver ideas para el estante de ejemplo",
    pl: "Pokaż pomysły dla przykładowej półki",
    it: "Mostra idee per il ripiano di esempio",
  },
  sampleDetail: {
    en: "Made up in advance, without AI — nothing is sent",
    "pt-BR": "Feitas de antemão, sem IA — nada é enviado",
    de: "Vorab ausgedacht, ohne KI — nichts wird gesendet",
    es: "Preparadas de antemano, sin IA: no se envía nada",
    pl: "Przygotowane wcześniej, bez AI — nic nie jest wysyłane",
    it: "Preparate in anticipo, senza IA: non si invia niente",
  },
  noAi: {
    en: "AI isn't available here, so ideas can't be asked for",
    "pt-BR": "A IA não está disponível aqui, então não dá para pedir ideias",
    de: "Hier gibt es keine KI, also können keine Ideen geholt werden",
    es: "Aquí no hay IA, así que no se pueden pedir ideas",
    pl: "AI nie jest tu dostępne, więc nie można poprosić o pomysły",
    it: "Qui l'IA non è disponibile, quindi non si possono chiedere idee",
  },
  none: {
    en: "No ideas came back. Try again in a moment.",
    "pt-BR": "Nenhuma ideia voltou. Tente de novo daqui a pouco.",
    de: "Es kamen keine Ideen zurück. Versuch es gleich noch einmal.",
    es: "No llegó ninguna idea. Vuelve a intentarlo en un momento.",
    pl: "Nie przyszedł żaden pomysł. Spróbuj za chwilę.",
    it: "Non è arrivata nessuna idea. Riprova tra un momento.",
  },
  got: {
    en: "{n, plural, one {# idea} other {# ideas}}, using what goes first.",
    "pt-BR": "{n, plural, one {# ideia} other {# ideias}}, usando o que vence primeiro.",
    de: "{n, plural, one {# Idee} other {# Ideen}}, mit dem, was zuerst weg muss.",
    es: "{n, plural, one {# idea} other {# ideas}}, con lo que caduca antes.",
    pl: "{n, plural, one {# pomysł} few {# pomysły} many {# pomysłów} other {# pomysłu}} z tego, co najpierw się psuje.",
    it: "{n, plural, one {# idea} other {# idee}}, con ciò che scade prima.",
  },
  sampleOnly: {
    en: "The sample ideas use the sample shelf. Try the sample photo first.",
    "pt-BR": "As ideias de exemplo usam a prateleira de exemplo. Teste antes a foto de exemplo.",
    de: "Die Beispielideen passen zum Beispielfach. Probier zuerst das Beispielfoto.",
    es: "Las ideas de ejemplo usan el estante de ejemplo. Prueba antes la foto de ejemplo.",
    pl: "Przykładowe pomysły są do przykładowej półki. Najpierw wypróbuj przykładowe zdjęcie.",
    it: "Le idee di esempio usano il ripiano di esempio. Prova prima la foto di esempio.",
  },
} as const;

/** The things to cook with: still in the kitchen, soonest to go first, at most MAX_SENT. */
export function toCookWith(rows: readonly Resolved[]): Resolved[] {
  return rows.filter((r) => (r.status ?? "in") === "in" && String(r.name ?? "").trim()).sort(byExpiry).slice(0, MAX_SENT);
}

/** What the model reads: the names and days left — English around them, the names as written. */
export function cookText(rows: readonly Resolved[], today: Date): string {
  return rows
    .map((r) => {
      const d = toDate(r.expires);
      const left = d ? daysBetween(today, d) : null;
      return `- ${String(r.name).trim()}: ${left === null ? "no date" : left < 0 ? "past its date" : left === 0 ? "use today" : `${left} day${left === 1 ? "" : "s"} left`}`;
    })
    .join("\n");
}

export const COOK_INSTRUCTIONS = [
  "These are things in a home kitchen, with how long each has left. Suggest 2 or 3 simple dishes a home cook can make today.",
  "Use first the things with the fewest days left. Each idea may assume salt, pepper, oil, butter, flour and water, and nothing else that is not on the list.",
  "title: the dish's name. uses: the things from the list it uses, written exactly as in the list. minutes: about how long it takes. steps: 3 to 6 short steps.",
  "Nothing past its date unless it is something that keeps (hard cheese, a jar). Never suggest eating anything that might be unsafe.",
].join("\n");

/** An idea's `uses`, narrowed to the things that are really in the kitchen, as they are named there. */
export function keepReal(uses: readonly string[], rows: readonly Resolved[]): string[] {
  const names = rows.map((r) => String(r.name).trim());
  const out: string[] = [];
  for (const u of uses) {
    const want = u.trim().toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === want) ?? names.find((n) => want && (n.toLowerCase().includes(want) || want.includes(n.toLowerCase())));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** "1. Brown the chicken…\n2. …" */
const numbered = (steps: readonly string[]) =>
  steps
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

/** The page action. */
export async function whatCanICook(ctx: Ctx): Promise<void> {
  const rows = toCookWith(await ctx.query("item"));
  if (!rows.length) return void ctx.ui.toast(W.empty);
  const list = ctx.format.list(rows.map((r) => String(r.name).trim()));
  const ai = ctx.caps.ai;
  const how = await ctx.ui.sheet<"ask" | "sample">({
    title: ai ? W.title : W.noAi,
    items: [
      ...(ai ? [{ id: "ask" as const, label: W.ask, detail: ctx.t(W.askDetail, { list }), icon: "🍳" }] : []),
      { id: "sample", label: W.sample, detail: W.sampleDetail, icon: "✨" },
    ],
  });
  if (how === "sample") return showSampleIdeas(ctx, rows);
  if (how !== "ask" || !ai) return;
  const bar = ctx.ui.progress(ctx.t(W.asking, { list }));
  let answer: IdeasAnswer;
  try {
    answer = await ai.extract({ text: cookText(rows, ctx.now()), instructions: COOK_INSTRUCTIONS, schema: IDEAS });
  } catch (e) {
    return void ctx.ui.toast(e instanceof Error && e.message ? e.message : W.noAi);
  } finally {
    bar.done();
  }
  const ideas = answer.ideas.filter((i) => i.title.trim()).slice(0, 3);
  if (!ideas.length) return void ctx.ui.toast(W.none);
  await saveIdeas(
    ctx,
    ideas.map((i) => ({ title: i.title.trim(), uses: keepReal(i.uses, rows), minutes: i.minutes, steps: i.steps })),
    false,
  );
}

async function showSampleIdeas(ctx: Ctx, rows: readonly Resolved[]): Promise<void> {
  const ideas = sampleIdeas(ctx).map((i) => ({ ...i, uses: keepReal(i.uses.map((k: SampleKey) => sampleName(k, ctx)), rows) }));
  if (ideas.every((i) => i.uses.length === 0)) return void ctx.ui.toast(W.sampleOnly);
  await saveIdeas(ctx, ideas, true);
}

async function saveIdeas(ctx: Ctx, ideas: Array<{ title: string; uses: string[]; minutes: number | null; steps: readonly string[] }>, sample: boolean): Promise<void> {
  const now = ctx.now();
  for (const i of ideas) {
    await ctx.create("idea", {
      title: i.title,
      uses: i.uses.length ? ctx.format.list(i.uses) : "",
      ...(i.minutes && i.minutes > 0 ? { minutes: Math.round(i.minutes) } : {}),
      steps: numbered(i.steps),
      made: now,
      sample,
    });
  }
  ctx.ui.toast(ctx.t(W.got, { n: ideas.length }));
  ctx.navigate("cook");
}

/** What the share sheet carries for an idea: its name, what it uses, its steps. */
export function ideaShareText(r: Resolved, ctx: Pick<Ctx, "t">): string {
  const title = String(r.title ?? "").trim();
  const minutes = Number(r.minutes);
  const head = Number.isFinite(minutes) && minutes > 0 ? `${title} (${ctx.t({ en: "{n} min", "pt-BR": "{n} min", de: "{n} Min.", es: "{n} min", pl: "{n} min", it: "{n} min" }, { n: minutes })})` : title;
  const uses = String(r.uses ?? "").trim();
  return [head, uses ? ctx.t({ en: "Uses: {uses}", "pt-BR": "Usa: {uses}", de: "Mit: {uses}", es: "Lleva: {uses}", pl: "Składniki: {uses}", it: "Usa: {uses}" }, { uses }) : "", String(r.steps ?? "").trim()]
    .filter(Boolean)
    .join("\n\n");
}
