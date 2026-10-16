// recipes.app.tsx
// A home cook's cookbook: a photo gallery of what you cook, a real cook mode (one step at a time, big
// type, timers, servings that rescale), what you can cook with what is in the pantry, the week's plan
// and the shopping list it makes. Recipes come in from a photo of a cookbook page or pasted text —
// AI reads it, you check it.
//
// Stresses: relations (recipe->ingredient), nested list rows, computed macros as real functions, a JS
// "ingredients I have" filter, a CUSTOM cook view (full React), `ctx.caps.ai` with a confirm form, and
// actions with input (plan a meal on a day).
//
// In six languages (#303); every language but English is a model's draft (#297). Recipes,
// ingredients and steps are records and stay as written. A function sees an enum's stored value,
// never its label (docs/20 Q5), so the few lines that put a category, a season or a difficulty into
// words say it through the small `…Name` helpers below, with the same words as the fields' labels.
// The search chip matches what is stored: a recipe's name as typed, and its tags' stored keys.
import { defineApp } from "potyro";
import { useEffect, useState } from "react";
import type { AiImage, Ctx, Resolved, ViewProps } from "potyro";

// ---- Your own code, in the same file. An app is one file: the Studio edits it, a share link carries
// it, and it runs anywhere the shell does. ----

/**
 * A recipe's ingredient rows, for the sums below. A recipe nobody has added ingredients to yet has
 * none (not a list that is missing), and a row whose ingredient was deleted has nothing to add up.
 */
function ingredientRows(r: Resolved): any[] {
  return (Array.isArray(r.ingredients) ? r.ingredients : []).filter((i: { ingredient?: unknown } | null) => i?.ingredient);
}

/** Rough difficulty from the amount of prep + steps. */
function scoreDifficulty(r: Resolved): "easy" | "medium" | "hard" {
  const steps = Array.isArray(r.steps) ? r.steps.length : 0;
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
  const score = steps + ingredients;
  if (score <= 6) return "easy";
  if (score <= 12) return "medium";
  return "hard";
}

/** Minutes, from the steps' times. A recipe whose steps have no times has none. */
function totalMinutes(r: Resolved): number {
  const steps: Array<{ durationSec?: number }> = Array.isArray(r.steps) ? r.steps : [];
  return Math.round(steps.reduce((s, x) => s + (Number(x?.durationSec) || 0), 0) / 60);
}

/** "35 min" / "1 h 20 min", in the person's language. */
const minutesText = (m: number, ctx: Ctx): string =>
  m >= 60
    ? `${ctx.format.number(Math.floor(m / 60), { style: "unit", unit: "hour" })}${m % 60 ? ` ${ctx.format.number(m % 60, { style: "unit", unit: "minute" })}` : ""}`
    : ctx.format.number(m, { style: "unit", unit: "minute" });

/** A recipe's line under its name: time, calories per serving, difficulty — what is known. */
function recipeLine(r: Resolved, ctx: Ctx): string {
  const parts: string[] = [];
  if (r.totalMinutes) parts.push(minutesText(r.totalMinutes, ctx));
  if (r.caloriesPerServing) parts.push(`${Math.round(r.caloriesPerServing)} kcal`);
  parts.push(difficultyName(r.difficulty, ctx));
  return parts.join(" · ");
}

/** A recipe's difficulty in words. */
const difficultyName = (d: unknown, ctx: Ctx): string => {
  if (d === "easy") return ctx.t({ en: "easy", "pt-BR": "fácil", de: "leicht", es: "fácil", pl: "łatwy", it: "facile" });
  if (d === "medium") return ctx.t({ en: "medium", "pt-BR": "média", de: "mittel", es: "media", pl: "średni", it: "media" });
  return ctx.t({ en: "hard", "pt-BR": "difícil", de: "schwer", es: "difícil", pl: "trudny", it: "difficile" });
};

/** A recipe's diet (the `diet` computed) in words: it agrees with "recipe", not with "ingredient". */
const dietName = (d: unknown, ctx: Ctx): string => {
  if (d === "vegan") return ctx.t({ en: "vegan", "pt-BR": "vegana", de: "vegan", es: "vegana", pl: "wegański", it: "vegana" });
  if (d === "vegetarian") return ctx.t({ en: "vegetarian", "pt-BR": "vegetariana", de: "vegetarisch", es: "vegetariana", pl: "wegetariański", it: "vegetariana" });
  if (d === "animal-based") return ctx.t({ en: "animal-based", "pt-BR": "de origem animal", de: "tierisch", es: "de origen animal", pl: "odzwierzęcy", it: "di origine animale" });
  return ctx.t({ en: "unknown", "pt-BR": "desconhecida", de: "unbekannt", es: "desconocida", pl: "nieznany", it: "sconosciuta" });
};

/** An ingredient's category in words: the same as `category`'s labels. */
const categoryName = (c: unknown, ctx: Ctx): string => {
  switch (c) {
    case "vegetable":
      return ctx.t({ en: "vegetable", "pt-BR": "verdura", de: "Gemüse", es: "verdura", pl: "warzywo", it: "verdura" });
    case "fruit":
      return ctx.t({ en: "fruit", "pt-BR": "fruta", de: "Obst", es: "fruta", pl: "owoc", it: "frutta" });
    case "grain":
      return ctx.t({ en: "grain", "pt-BR": "cereal", de: "Getreide", es: "cereal", pl: "zboże", it: "cereale" });
    case "dairy":
      return ctx.t({ en: "dairy", "pt-BR": "laticínio", de: "Milchprodukt", es: "lácteo", pl: "nabiał", it: "latticino" });
    case "protein":
      return ctx.t({ en: "protein", "pt-BR": "proteína", de: "Eiweiß", es: "proteína", pl: "białko", it: "proteina" });
    case "spice":
      return ctx.t({ en: "spice", "pt-BR": "tempero", de: "Gewürz", es: "especia", pl: "przyprawa", it: "spezia" });
    case "fat":
      return ctx.t({ en: "fat", "pt-BR": "gordura", de: "Fett", es: "grasa", pl: "tłuszcz", it: "grasso" });
    case "other":
      return ctx.t({ en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" });
    default:
      return "—";
  }
};

/** A season in words: the same as `seasons`' labels. */
const seasonName = (s: string, ctx: Ctx): string => {
  if (s === "spring") return ctx.t({ en: "spring", "pt-BR": "primavera", de: "Frühling", es: "primavera", pl: "wiosna", it: "primavera" });
  if (s === "summer") return ctx.t({ en: "summer", "pt-BR": "verão", de: "Sommer", es: "verano", pl: "lato", it: "estate" });
  if (s === "autumn") return ctx.t({ en: "autumn", "pt-BR": "outono", de: "Herbst", es: "otoño", pl: "jesień", it: "autunno" });
  if (s === "winter") return ctx.t({ en: "winter", "pt-BR": "inverno", de: "Winter", es: "invierno", pl: "zima", it: "inverno" });
  return s;
};


/** A meal slot in words: the same as `slot`'s labels. */
const slotName = (s: unknown, ctx: Ctx): string => {
  if (s === "breakfast") return ctx.t({ en: "Breakfast", "pt-BR": "Café da manhã", de: "Frühstück", es: "Desayuno", pl: "Śniadanie", it: "Colazione" });
  if (s === "lunch") return ctx.t({ en: "Lunch", "pt-BR": "Almoço", de: "Mittagessen", es: "Comida", pl: "Obiad", it: "Pranzo" });
  return ctx.t({ en: "Dinner", "pt-BR": "Jantar", de: "Abendessen", es: "Cena", pl: "Kolacja", it: "Cena" });
};

// ---- Cook mode (docs M1 DoD): a full React component — the "no ceiling" escape hatch. One step at a
// time in type you can read from the stove, the step's timer one tap away, the ingredients scaled to
// the servings you are cooking, and "Cooked it" at the end. Every step also has its tick in the list
// underneath, so you can see where you are and jump back. ----
interface Step {
  text: string;
  durationSec?: number;
}

const COOK_CSS = `
.ck { max-width: 46rem; margin: 0 auto; padding: 0 0 2rem; display: grid; gap: 1.25rem; }
.ck-head { display: grid; gap: .35rem; }
.ck-title { font-family: var(--font-display, serif); font-size: var(--text-hero, 2rem); line-height: 1.1; margin: 0; }
.ck-progress { display: flex; gap: 6px; align-items: center; color: var(--ink-soft); font-size: .9rem; }
.ck-dot { width: 22px; height: 6px; border-radius: 3px; background: var(--line); border: 0; padding: 0; cursor: pointer; }
.ck-dot[data-on="true"] { background: var(--accent); }
.ck-dot[data-done="true"] { background: color-mix(in oklab, var(--accent) 45%, var(--line)); }
.ck-card { background: var(--surface-raised); border: 1px solid var(--line); border-radius: var(--radius-lg, 18px); padding: clamp(1.25rem, 4vw, 2.25rem); box-shadow: var(--shadow); display: grid; gap: 1rem; }
.ck-step-n { color: var(--ink-soft); font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; }
.ck-step { font-size: clamp(1.5rem, 1.1rem + 2vw, 2.1rem); line-height: 1.3; margin: 0; color: var(--ink); }
.ck-timer { justify-self: start; display: inline-flex; gap: .5rem; align-items: center; font: inherit; font-size: 1.05rem; font-weight: 600; padding: .6rem 1rem; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-sunken); color: var(--ink); cursor: pointer; }
.ck-timer[data-running="true"] { background: var(--accent); color: var(--on-accent); border-color: transparent; font-variant-numeric: tabular-nums; }
.ck-nav { display: grid; grid-template-columns: 1fr 2fr; gap: .75rem; }
.ck-btn { font: inherit; font-size: 1.1rem; font-weight: 600; padding: .95rem 1rem; border-radius: var(--radius, 14px); border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; min-height: 52px; }
.ck-btn:disabled { opacity: .45; cursor: default; }
.ck-btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.ck-btn:focus-visible, .ck-timer:focus-visible, .ck-dot:focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 70%, transparent); outline-offset: 2px; }
.ck-side { display: grid; gap: 1rem; }
.ck-box { border: 1px solid var(--line); border-radius: var(--radius, 14px); padding: 1rem 1.1rem; background: var(--surface); }
.ck-box h2 { font-size: 1rem; margin: 0 0 .6rem; display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.ck-serv { display: inline-flex; align-items: center; gap: .4rem; font-weight: 600; }
.ck-serv button { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface-sunken); color: var(--ink); font-size: 1.1rem; cursor: pointer; }
.ck-ings { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.ck-ings li { display: flex; justify-content: space-between; gap: 1rem; }
.ck-ings b { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.ck-ings li[data-here="true"] { color: var(--accent); font-weight: 600; }
.ck-steps { margin: 0; padding-left: 1.4rem; display: grid; gap: .45rem; }
.ck-steps li[data-done="true"] span { text-decoration: line-through; color: var(--ink-faint); }
.ck-steps li[data-on="true"] span { font-weight: 600; }
.ck-steps label { display: flex; gap: .55rem; align-items: baseline; cursor: pointer; }
@media (min-width: 900px) { .ck { grid-template-columns: 3fr 2fr; align-items: start; max-width: 70rem; } .ck-head { grid-column: 1 / -1; } }
`;

/** A quantity scaled to the servings being cooked, rounded the way a cook reads it. */
function scaled(q: number, factor: number): string {
  const v = q * factor;
  if (v >= 100) return String(Math.round(v / 5) * 5);
  if (v >= 10) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

function CookAlong(props: ViewProps) {
  const { runtime, param } = props;
  const ctx = runtime.ctx;
  const recipeId = param?.recipeId ?? "";
  const { record, loading } = runtime.useRecord("recipe", recipeId);
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const [servings, setServings] = useState<number | null>(null);
  const [timer, setTimer] = useState<{ step: number; endsAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A running timer ticks every second; when it ends the phone buzzes and says which step it was.
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= timer.endsAt) {
        setTimer(null);
        void ctx.caps.haptics?.vibrate([200, 100, 200]);
        ctx.ui.toast(ctx.t({ en: "Time's up: step {n}", "pt-BR": "Acabou o tempo: passo {n}", de: "Zeit ist um: Schritt {n}", es: "Se acabó el tiempo: paso {n}", pl: "Czas minął: krok {n}", it: "Tempo scaduto: passaggio {n}" }, { n: timer.step + 1 }));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timer, ctx]);

  if (loading) return <p>{ctx.t({ en: "Loading…", "pt-BR": "Carregando…", de: "Wird geladen…", es: "Cargando…", pl: "Wczytywanie…", it: "Caricamento…" })}</p>;
  if (!record) {
    return <p>{ctx.t({ en: "Recipe not found.", "pt-BR": "Receita não encontrada.", de: "Rezept nicht gefunden.", es: "No se encontró la receta.", pl: "Nie znaleziono przepisu.", it: "Ricetta non trovata." })}</p>;
  }

  const steps: Step[] = Array.isArray(record.steps) ? (record.steps as Step[]) : [];
  const base = Math.max(Number(record.servings) || 1, 1);
  const serving = servings ?? base;
  const factor = serving / base;
  const step = steps[at];
  const last = at >= steps.length - 1;
  const ings = ingredientRows(record);
  // The ingredients this step mentions light up in the list: a name match, nothing cleverer.
  const mentioned = (name: string): boolean => Boolean(step?.text.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));

  const toggle = (i: number): void =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const go = (i: number): void => setAt(Math.min(Math.max(i, 0), Math.max(steps.length - 1, 0)));
  const finish = async (): Promise<void> => {
    await runtime.runAction("recipe", "markCooked", record.id);
    ctx.navigate("detail", { recipeId: record.id });
  };
  const left = timer ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const stepWord = ctx.t({ en: "Step {n} of {total}", "pt-BR": "Passo {n} de {total}", de: "Schritt {n} von {total}", es: "Paso {n} de {total}", pl: "Krok {n} z {total}", it: "Passaggio {n} di {total}" }, { n: at + 1, total: steps.length });

  return (
    <section className="ck" aria-labelledby="cook-heading">
      <style>{COOK_CSS}</style>
      <header className="ck-head">
        <h1 id="cook-heading" className="ck-title">
          {ctx.t({ en: "Cooking: {name}", "pt-BR": "Cozinhando: {name}", de: "Jetzt kochen: {name}", es: "Cocinando: {name}", pl: "Gotujemy: {name}", it: "In cucina: {name}" }, { name: String(record.name) })}
        </h1>
        {steps.length > 0 ? (
          <div className="ck-progress">
            {steps.map((_, i) => (
              <button key={i} type="button" className="ck-dot" data-on={i === at} data-done={done.has(i)} aria-label={ctx.t({ en: "Go to step {n}", "pt-BR": "Ir para o passo {n}", de: "Zu Schritt {n}", es: "Ir al paso {n}", pl: "Przejdź do kroku {n}", it: "Vai al passaggio {n}" }, { n: i + 1 })} onClick={() => setAt(i)} />
            ))}
            <span>{stepWord}</span>
          </div>
        ) : null}
      </header>

      <div className="ck-card" aria-live="polite">
        {step ? (
          <>
            <span className="ck-step-n">{stepWord}</span>
            <p className="ck-step">{step.text}</p>
            {step.durationSec ? (
              <button
                type="button"
                className="ck-timer"
                data-running={timer?.step === at}
                onClick={() => setTimer(timer?.step === at ? null : { step: at, endsAt: Date.now() + Number(step.durationSec) * 1000 })}
              >
                {timer?.step === at
                  ? `⏱ ${clock} · ${ctx.t({ en: "stop", "pt-BR": "parar", de: "stopp", es: "parar", pl: "stop", it: "ferma" })}`
                  : `⏱ ${ctx.t({ en: "Start a {time} timer", "pt-BR": "Iniciar timer de {time}", de: "{time}-Timer starten", es: "Poner temporizador de {time}", pl: "Włącz minutnik: {time}", it: "Avvia timer di {time}" }, { time: minutesText(Math.max(1, Math.round(Number(step.durationSec) / 60)), ctx) })}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="ck-step">{ctx.t({ en: "This recipe has no steps yet.", "pt-BR": "Esta receita ainda não tem passos.", de: "Dieses Rezept hat noch keine Schritte.", es: "Esta receta aún no tiene pasos.", pl: "Ten przepis nie ma jeszcze kroków.", it: "Questa ricetta non ha ancora passaggi." })}</p>
        )}
        <div className="ck-nav">
          <button type="button" className="ck-btn" disabled={at === 0} onClick={() => go(at - 1)}>
            {ctx.t({ en: "Back", "pt-BR": "Voltar", de: "Zurück", es: "Atrás", pl: "Wstecz", it: "Indietro" })}
          </button>
          {last ? (
            <button type="button" className="ck-btn primary" onClick={() => void finish()}>
              {ctx.t({ en: "Cooked it ✓", "pt-BR": "Pronto, fiz ✓", de: "Gekocht ✓", es: "¡Hecho! ✓", pl: "Ugotowane ✓", it: "Fatto ✓" })}
            </button>
          ) : (
            <button type="button" className="ck-btn primary" onClick={() => { toggle(at); go(at + 1); }}>
              {ctx.t({ en: "Next step", "pt-BR": "Próximo passo", de: "Nächster Schritt", es: "Siguiente paso", pl: "Następny krok", it: "Passaggio successivo" })}
            </button>
          )}
        </div>
      </div>

      <aside className="ck-side">
        <div className="ck-box">
          <h2>
            {ctx.t({ en: "Ingredients", "pt-BR": "Ingredientes", de: "Zutaten", es: "Ingredientes", pl: "Składniki", it: "Ingredienti" })}
            <span className="ck-serv">
              <button type="button" aria-label={ctx.t({ en: "Fewer servings", "pt-BR": "Menos porções", de: "Weniger Portionen", es: "Menos raciones", pl: "Mniej porcji", it: "Meno porzioni" })} onClick={() => setServings(Math.max(1, serving - 1))}>−</button>
              <span>{ctx.t({ en: "{n, plural, one {# serving} other {# servings}}", "pt-BR": "{n, plural, one {# porção} other {# porções}}", de: "{n, plural, one {# Portion} other {# Portionen}}", es: "{n, plural, one {# ración} other {# raciones}}", pl: "{n, plural, one {# porcja} few {# porcje} many {# porcji} other {# porcji}}", it: "{n, plural, one {# porzione} other {# porzioni}}" }, { n: serving })}</span>
              <button type="button" aria-label={ctx.t({ en: "More servings", "pt-BR": "Mais porções", de: "Mehr Portionen", es: "Más raciones", pl: "Więcej porcji", it: "Più porzioni" })} onClick={() => setServings(serving + 1)}>+</button>
            </span>
          </h2>
          <ul className="ck-ings">
            {ings.map((i, k) => (
              <li key={k} data-here={mentioned(String(i.ingredient.name))}>
                <span>{String(i.ingredient.name)}</span>
                <b>{scaled(Number(i.quantity) || 0, factor)} {i.unit ?? ""}</b>
              </li>
            ))}
          </ul>
        </div>
        <div className="ck-box">
          <h2>{ctx.t({ en: "All steps", "pt-BR": "Todos os passos", de: "Alle Schritte", es: "Todos los pasos", pl: "Wszystkie kroki", it: "Tutti i passaggi" })}</h2>
          <ol className="ck-steps">
            {steps.map((s, i) => (
              <li key={i} data-done={done.has(i)} data-on={i === at}>
                <label>
                  <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
                  <span onClick={(e) => { e.preventDefault(); setAt(i); }}>{s.text}</span>
                </label>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </section>
  );
}

// ---- Capture: a cookbook page, a screenshot or pasted text becomes a recipe. AI reads it; the person
// checks the result in a form before anything is saved, and every value stays editable. ----

const CAPTURED = {
  title: "text",
  servings: "number?",
  ingredients: [{ item: "text", quantity: "number?", unit: "text?" }],
  steps: [{ text: "text", minutes: "number?" }],
} as const;

const UNITS = ["g", "ml", "tbsp", "tsp", "cup", "piece"];

/** A unit as the recipe's field keeps it: the AI's "grams" or "Tbsp" read as `g` or `tbsp`. */
function unitOf(u: string | null | undefined): string {
  const s = String(u ?? "").trim().toLowerCase();
  if (UNITS.includes(s)) return s;
  if (/^(gram|grams|gr)$/.test(s) || s === "kg") return "g";
  if (/^(millilit|ml|l$|litre|liter)/.test(s)) return "ml";
  if (/^(tablespoon|tbs|el)/.test(s)) return "tbsp";
  if (/^(teaspoon|tl)/.test(s)) return "tsp";
  if (/^cup/.test(s)) return "cup";
  return s ? "piece" : "g";
}

async function captureRecipe(ctx: Ctx, how: "photo" | "paste"): Promise<void> {
  const ai = ctx.caps.ai;
  if (!ai) {
    ctx.ui.toast(ctx.t({ en: "AI isn't available here. Type the recipe in instead.", "pt-BR": "A IA não está disponível aqui. Digite a receita.", de: "KI ist hier nicht verfügbar. Tipp das Rezept ein.", es: "La IA no está disponible aquí. Escribe la receta.", pl: "AI nie jest tu dostępne. Wpisz przepis ręcznie.", it: "L'IA non è disponibile qui. Scrivi la ricetta a mano." }));
    return;
  }
  let source: { image?: AiImage; text?: string } = {};
  if (how === "photo") {
    const [photo] = await ctx.files.import({ folder: "captured", accept: "image/*" });
    if (!photo) return;
    source = { image: photo };
  } else {
    const text = await ctx.ui.prompt(ctx.t({ en: "Paste the recipe: from a website, a message, a caption", "pt-BR": "Cole a receita: de um site, uma mensagem, uma legenda", de: "Füge das Rezept ein: von einer Website, einer Nachricht, einer Bildunterschrift", es: "Pega la receta: de una web, un mensaje, un pie de foto", pl: "Wklej przepis: ze strony, wiadomości, podpisu", it: "Incolla la ricetta: da un sito, un messaggio, una didascalia" }));
    if (!text?.trim()) return;
    source = { text };
  }
  const bar = ctx.ui.progress(ctx.t({ en: "Reading the recipe…", "pt-BR": "Lendo a receita…", de: "Rezept wird gelesen…", es: "Leyendo la receta…", pl: "Czytam przepis…", it: "Leggo la ricetta…" }));
  let read;
  try {
    read = await ai.extract({
      ...source,
      instructions: "A cooking recipe. The dish's name, how many it serves, each ingredient line (amount, unit, the ingredient itself), and each step in order with its time in minutes when the step says one.",
      schema: CAPTURED,
    });
  } finally {
    bar.done();
  }
  // Nothing is saved until the person has looked at it.
  const checked = await ctx.ui.form<{ name: string; servings: number }>({
    title: ctx.t({ en: "AI's reading — check it", "pt-BR": "O que a IA leu — confira", de: "Was die KI gelesen hat — prüf es", es: "Lo que leyó la IA — revísalo", pl: "Co odczytało AI — sprawdź", it: "Cosa ha letto l'IA — controlla" }),
    fields: {
      name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
      servings: { type: "number", min: 1, integer: true, label: { en: "Servings", "pt-BR": "Porções", de: "Portionen", es: "Raciones", pl: "Porcje", it: "Porzioni" } },
    },
    initial: { name: read.title, servings: read.servings ?? 2 },
    submit: ctx.t({ en: "Save recipe", "pt-BR": "Salvar receita", de: "Rezept speichern", es: "Guardar receta", pl: "Zapisz przepis", it: "Salva ricetta" }),
  });
  if (!checked) return;
  // Each ingredient line becomes one of your ingredients: an existing one by name, else a new one.
  const known = await ctx.query("ingredient");
  const lines: Array<{ ingredient: string; quantity: number; unit: string }> = [];
  for (const line of read.ingredients) {
    const name = line.item.trim();
    if (!name) continue;
    const found = known.find((k) => String(k.name).toLowerCase() === name.toLowerCase());
    const ing = found ?? (await ctx.create("ingredient", { name, inStock: false }));
    if (!found) known.push(ing);
    lines.push({ ingredient: ing.id, quantity: line.quantity ?? 1, unit: unitOf(line.unit) });
  }
  const recipe = await ctx.create("recipe", {
    name: checked.name,
    servings: checked.servings ?? 2,
    status: "want to try",
    ingredients: lines,
    steps: read.steps.map((s) => ({ text: s.text, ...(s.minutes ? { durationSec: Math.round(s.minutes * 60) } : {}) })),
  });
  ctx.navigate("detail", { recipeId: recipe.id });
}

/** The page's one big button: three ways in, the AI two first. */
async function addRecipe(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet({
    title: { en: "Add a recipe", "pt-BR": "Adicionar receita", de: "Rezept hinzufügen", es: "Añadir receta", pl: "Dodaj przepis", it: "Aggiungi ricetta" },
    items: [
      { id: "photo", icon: "📷", label: { en: "From a photo", "pt-BR": "De uma foto", de: "Aus einem Foto", es: "Desde una foto", pl: "Ze zdjęcia", it: "Da una foto" }, detail: { en: "A cookbook page or a screenshot", "pt-BR": "Uma página de livro ou uma captura de tela", de: "Eine Kochbuchseite oder ein Screenshot", es: "Una página de un libro o una captura", pl: "Strona z książki lub zrzut ekranu", it: "Una pagina di ricettario o uno screenshot" } },
      { id: "paste", icon: "📋", label: { en: "Paste the text", "pt-BR": "Colar o texto", de: "Text einfügen", es: "Pegar el texto", pl: "Wklej tekst", it: "Incolla il testo" }, detail: { en: "From a website, a message, a caption", "pt-BR": "De um site, uma mensagem, uma legenda", de: "Von einer Website, einer Nachricht, einer Bildunterschrift", es: "De una web, un mensaje, un pie de foto", pl: "Ze strony, wiadomości, podpisu", it: "Da un sito, un messaggio, una didascalia" } },
      { id: "type", icon: "✏️", label: { en: "Type it in", "pt-BR": "Digitar", de: "Selbst eintippen", es: "Escribirla", pl: "Wpisz ręcznie", it: "Scrivila tu" } },
    ],
  });
  if (how === "photo" || how === "paste") return captureRecipe(ctx, how);
  if (how !== "type") return;
  const typed = await ctx.ui.form<{ name: string; servings: number }>({
    title: { en: "New recipe", "pt-BR": "Nova receita", de: "Neues Rezept", es: "Receta nueva", pl: "Nowy przepis", it: "Nuova ricetta" },
    fields: {
      name: { type: "text", required: true, placeholder: "Shakshuka", label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
      servings: { type: "number", min: 1, integer: true, default: 2, label: { en: "Servings", "pt-BR": "Porções", de: "Portionen", es: "Raciones", pl: "Porcje", it: "Porzioni" } },
    },
    initial: { servings: 2 },
  });
  if (!typed) return;
  const recipe = await ctx.create("recipe", { name: typed.name, servings: typed.servings ?? 2, status: "want to try" });
  ctx.navigate("detail", { recipeId: recipe.id });
}

/** "Put away": what was bought is in the pantry now, and off the list. */
async function putAway(ctx: Ctx): Promise<void> {
  const bought = (await ctx.query("buy")).filter((b) => b.done);
  for (const b of bought) {
    if (b.ingredient?.id) await ctx.patch("ingredient", b.ingredient.id, { inStock: true });
    await ctx.delete("buy", b.id);
  }
  ctx.ui.toast(
    bought.length
      ? ctx.t({ en: "{n, plural, one {# thing} other {# things}} put away in the pantry", "pt-BR": "{n, plural, one {# item guardado} other {# itens guardados}} na despensa", de: "{n, plural, one {# Sache} other {# Sachen}} im Vorrat verstaut", es: "{n, plural, one {# cosa guardada} other {# cosas guardadas}} en la despensa", pl: "{n, plural, one {# rzecz odłożona} few {# rzeczy odłożone} many {# rzeczy odłożonych} other {# rzeczy odłożonej}} do spiżarni", it: "{n, plural, one {# cosa messa} other {# cose messe}} in dispensa" }, { n: bought.length })
      : ctx.t({ en: "Tick what you bought first.", "pt-BR": "Marque primeiro o que você comprou.", de: "Hak erst ab, was du gekauft hast.", es: "Marca primero lo que compraste.", pl: "Najpierw zaznacz, co kupiłeś.", it: "Prima spunta quello che hai comprato." }),
  );
}

export default defineApp({
  id: "recipes",
  name: { en: "Recipes", "pt-BR": "Receitas", de: "Rezepte", es: "Recetas", pl: "Przepisy", it: "Ricette" },
  icon: "🍳",
  version: "2.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#E4A93C" },
  permissions: { camera: true, filesystem: true, ai: true, haptics: true },
  nav: "tabs",
  // What can be added by hand: a recipe (typed in; the Recipes page's own button also reads one from a
  // photo or pasted text) and an ingredient. Meals come from a recipe's "Plan it", shopping items from
  // "Add to shopping" or the list's own box.
  quickActions: [
    { id: "add-recipe", label: { en: "Add: Recipe", "pt-BR": "Adicionar: Receita", de: "Hinzufügen: Rezept", es: "Añadir: Receta", pl: "Dodaj: Przepis", it: "Aggiungi: Ricetta" }, icon: "🍳", entity: "recipe", mode: "form" },
    { id: "add-ingredient", label: { en: "Add: Ingredient", "pt-BR": "Adicionar: Ingrediente", de: "Hinzufügen: Zutat", es: "Añadir: Ingrediente", pl: "Dodaj: Składnik", it: "Aggiungi: Ingrediente" }, icon: "🥕", entity: "ingredient", mode: "form" },
  ],
  category: "everyday",
  // The launcher tile (docs/04 §Tile): tonight's dinner when the week has one, else what to cook next
  // — the recipe left longest — with its photo.
  tile: async (ctx) => {
    const today = ctx.today().getTime();
    const tonight = (await ctx.query("meal")).find((m) => m.recipe && new Date(String(m.date)).setHours(0, 0, 0, 0) === today);
    const recipes = (await ctx.query("recipe")).sort(
      (a, b) => new Date(String(a.lastCookedAt ?? 0)).getTime() - new Date(String(b.lastCookedAt ?? 0)).getTime(),
    );
    const next = tonight?.recipe ?? recipes[0];
    if (!next) return {};
    return {
      title: tonight
        ? ctx.t({ en: "Tonight: {name}", "pt-BR": "Hoje: {name}", de: "Heute: {name}", es: "Esta noche: {name}", pl: "Dziś: {name}", it: "Stasera: {name}" }, { name: String(next.name) })
        : String(next.name),
      lines: [
        next.lastCookedAt
          ? ctx.t({ en: "Last cooked {when}", "pt-BR": "Feita pela última vez {when}", de: "Zuletzt gekocht {when}", es: "Cocinada por última vez {when}", pl: "Ostatnio {when}", it: "Cucinata l'ultima volta {when}" }, { when: ctx.format.relative(new Date(String(next.lastCookedAt)), { unit: "day" }) })
          : ctx.t({ en: "Not cooked yet", "pt-BR": "Ainda não foi feita", de: "Noch nie gekocht", es: "Aún sin cocinar", pl: "Jeszcze nie gotowane", it: "Mai cucinata" }),
        ctx.t({ en: "{n, plural, one {# recipe} other {# recipes}}", "pt-BR": "{n, plural, one {# receita} other {# receitas}}", de: "{n, plural, one {# Rezept} other {# Rezepte}}", es: "{n, plural, one {# receta} other {# recetas}}", pl: "{n, plural, one {# przepis} few {# przepisy} many {# przepisów} other {# przepisu}}", it: "{n, plural, one {# ricetta} other {# ricette}}" }, { n: recipes.length }),
      ],
      ...(next.photo ? { image: next.photo as never } : {}),
    };
  },

  entities: {
    ingredient: {
      label: { en: "Ingredient", "pt-BR": "Ingrediente", de: "Zutat", es: "Ingrediente", pl: "Składnik", it: "Ingrediente" },
      icon: "🥕",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        // ingredients are a real data model — not just a picker option
        // Three options, so all three show as a row of buttons; the colours mean something here.
        diet: {
          type: "enum",
          options: ["vegan", "vegetarian", "animal-based"],
          label: { en: "Diet", "pt-BR": "Dieta", de: "Ernährung", es: "Dieta", pl: "Dieta", it: "Dieta" },
          colors: { vegan: "green", vegetarian: "teal", "animal-based": "red" },
          labels: {
            vegan: { en: "vegan", "pt-BR": "vegano", de: "vegan", es: "vegano", pl: "wegański", it: "vegano" },
            vegetarian: { en: "vegetarian", "pt-BR": "vegetariano", de: "vegetarisch", es: "vegetariano", pl: "wegetariański", it: "vegetariano" },
            "animal-based": { en: "animal-based", "pt-BR": "de origem animal", de: "tierisch", es: "de origen animal", pl: "odzwierzęcy", it: "di origine animale" },
          },
        },
        category: {
          type: "enum",
          label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" },
          options: ["vegetable", "fruit", "grain", "dairy", "protein", "spice", "fat", "other"],
          labels: {
            vegetable: { en: "vegetable", "pt-BR": "verdura", de: "Gemüse", es: "verdura", pl: "warzywo", it: "verdura" },
            fruit: { en: "fruit", "pt-BR": "fruta", de: "Obst", es: "fruta", pl: "owoc", it: "frutta" },
            grain: { en: "grain", "pt-BR": "cereal", de: "Getreide", es: "cereal", pl: "zboże", it: "cereale" },
            dairy: { en: "dairy", "pt-BR": "laticínio", de: "Milchprodukt", es: "lácteo", pl: "nabiał", it: "latticino" },
            protein: { en: "protein", "pt-BR": "proteína", de: "Eiweiß", es: "proteína", pl: "białko", it: "proteina" },
            spice: { en: "spice", "pt-BR": "tempero", de: "Gewürz", es: "especia", pl: "przyprawa", it: "spezia" },
            fat: { en: "fat", "pt-BR": "gordura", de: "Fett", es: "grasa", pl: "tłuszcz", it: "grasso" },
            other: { en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" },
          },
        },
        seasons: {
          type: "tags",
          label: { en: "Seasons", "pt-BR": "Estações", de: "Jahreszeiten", es: "Estaciones", pl: "Pory roku", it: "Stagioni" },
          options: ["spring", "summer", "autumn", "winter"],
          labels: {
            spring: { en: "spring", "pt-BR": "primavera", de: "Frühling", es: "primavera", pl: "wiosna", it: "primavera" },
            summer: { en: "summer", "pt-BR": "verão", de: "Sommer", es: "verano", pl: "lato", it: "estate" },
            autumn: { en: "autumn", "pt-BR": "outono", de: "Herbst", es: "otoño", pl: "jesień", it: "autunno" },
            winter: { en: "winter", "pt-BR": "inverno", de: "Winter", es: "invierno", pl: "zima", it: "inverno" },
          },
        },
        pricePerKg: {
          type: "number",
          unit: "$/kg",
          min: 0,
          label: { en: "Price per kg", "pt-BR": "Preço por kg", de: "Preis pro kg", es: "Precio por kg", pl: "Cena za kg", it: "Prezzo al kg" },
        },
        caloriesPer100: {
          type: "number",
          unit: "kcal",
          min: 0,
          label: {
            en: "Calories per 100 g",
            "pt-BR": "Calorias por 100 g",
            de: "Kalorien pro 100 g",
            es: "Calorías por 100 g",
            pl: "Kalorie na 100 g",
            it: "Calorie per 100 g",
          },
        },
        proteinPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: {
            en: "Protein per 100 g",
            "pt-BR": "Proteína por 100 g",
            de: "Eiweiß pro 100 g",
            es: "Proteína por 100 g",
            pl: "Białko na 100 g",
            it: "Proteine per 100 g",
          },
        },
        fatPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: { en: "Fat per 100 g", "pt-BR": "Gordura por 100 g", de: "Fett pro 100 g", es: "Grasa por 100 g", pl: "Tłuszcz na 100 g", it: "Grassi per 100 g" },
        },
        carbsPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: {
            en: "Carbs per 100 g",
            "pt-BR": "Carboidratos por 100 g",
            de: "Kohlenhydrate pro 100 g",
            es: "Carbohidratos por 100 g",
            pl: "Węglowodany na 100 g",
            it: "Carboidrati per 100 g",
          },
        },
        inStock: {
          type: "boolean",
          default: false,
          label: { en: "In stock", "pt-BR": "Em estoque", de: "Vorrätig", es: "En casa", pl: "Na stanie", it: "In dispensa" },
        },
        notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },
      },
      computed: {
        // in-season if no seasons listed (year-round) or the current season is included
        inSeason: (i, ctx) => {
          const seasons = (i.seasons as string[]) ?? [];
          if (seasons.length === 0) return true;
          const m = ctx.now().getMonth();
          const now = m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
          return seasons.includes(now);
        },
      },
      actions: {
        toggleStock: {
          label: {
            en: "Toggle Stock",
            "pt-BR": "Tenho / acabou",
            de: "Vorrat umschalten",
            es: "Tengo / se acabó",
            pl: "Mam / skończyło się",
            it: "Ce l'ho / finito",
          },
          run: async (i, ctx) => {
            await ctx.patch("ingredient", i.id, { inStock: !i.inStock });
            // The ingredient's name is a record: the app's words go around it.
            ctx.ui.toast(
              i.inStock
                ? ctx.t(
                    { en: "Used up {name}", "pt-BR": "Acabou: {name}", de: "{name} aufgebraucht", es: "Se acabó: {name}", pl: "Skończyło się: {name}", it: "Finito: {name}" },
                    { name: String(i.name) },
                  )
                : ctx.t(
                    { en: "{name} in stock", "pt-BR": "{name} em estoque", de: "{name} vorrätig", es: "{name} en casa", pl: "{name}: na stanie", it: "{name} in dispensa" },
                    { name: String(i.name) },
                  ),
            );
          },
        },
      },
    },

    recipe: {
      label: { en: "Recipe", "pt-BR": "Receita", de: "Rezept", es: "Receta", pl: "Przepis", it: "Ricetta" },
      icon: "🍳",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Shakshuka", label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        // Where the recipe stands with you; the Cookbook board's columns (#107).
        status: {
          type: "enum",
          label: { en: "Status", "pt-BR": "Status", de: "Status", es: "Estado", pl: "Status", it: "Stato" },
          options: ["want to try", "tried", "keeper"],
          default: "want to try",
          colors: { "want to try": "yellow", tried: "teal", keeper: "green" },
          labels: {
            "want to try": { en: "want to try", "pt-BR": "quero provar", de: "will ich probieren", es: "quiero probarla", pl: "do wypróbowania", it: "da provare" },
            tried: { en: "tried", "pt-BR": "já provei", de: "probiert", es: "probada", pl: "wypróbowany", it: "provata" },
            keeper: { en: "keeper", "pt-BR": "favorita", de: "Lieblingsrezept", es: "favorita", pl: "ulubiony", it: "preferita" },
          },
        },
        photo: { type: "media", accept: "image", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
        tags: {
          type: "tags",
          label: { en: "Tags", "pt-BR": "Etiquetas", de: "Schlagwörter", es: "Etiquetas", pl: "Tagi", it: "Tag" },
          options: ["breakfast", "lunch", "dinner", "snack", "vegetarian", "vegan"],
          labels: {
            breakfast: { en: "breakfast", "pt-BR": "café da manhã", de: "Frühstück", es: "desayuno", pl: "śniadanie", it: "colazione" },
            lunch: { en: "lunch", "pt-BR": "almoço", de: "Mittagessen", es: "comida", pl: "obiad", it: "pranzo" },
            dinner: { en: "dinner", "pt-BR": "jantar", de: "Abendessen", es: "cena", pl: "kolacja", it: "cena" },
            snack: { en: "snack", "pt-BR": "lanche", de: "Snack", es: "tentempié", pl: "przekąska", it: "spuntino" },
            vegetarian: { en: "vegetarian", "pt-BR": "vegetariana", de: "vegetarisch", es: "vegetariana", pl: "wegetariańskie", it: "vegetariana" },
            vegan: { en: "vegan", "pt-BR": "vegana", de: "vegan", es: "vegana", pl: "wegańskie", it: "vegana" },
          },
        },
        servings: {
          type: "number",
          default: 2,
          min: 1,
          integer: true,
          label: { en: "Servings", "pt-BR": "Porções", de: "Portionen", es: "Raciones", pl: "Porcje", it: "Porzioni" },
          help: {
            en: "The per-serving figures divide by this",
            "pt-BR": "Os valores por porção são divididos por este número",
            de: "Die Werte pro Portion werden dadurch geteilt",
            es: "Las cifras por ración se dividen entre este número",
            pl: "Wartości na porcję dzieli się przez tę liczbę",
            it: "I valori per porzione si dividono per questo numero",
          },
        },
        ingredients: {
          type: "list",
          label: { en: "Ingredients", "pt-BR": "Ingredientes", de: "Zutaten", es: "Ingredientes", pl: "Składniki", it: "Ingredienti" },
          of: {
            ingredient: {
              type: "relation",
              to: "ingredient",
              required: true,
              label: { en: "Ingredient", "pt-BR": "Ingrediente", de: "Zutat", es: "Ingrediente", pl: "Składnik", it: "Ingrediente" },
            },
            quantity: {
              type: "number",
              min: 0,
              required: true,
              label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" },
            },
            unit: {
              type: "enum",
              label: { en: "Unit", "pt-BR": "Unidade", de: "Einheit", es: "Unidad", pl: "Jednostka", it: "Unità" },
              options: ["g", "ml", "tbsp", "tsp", "cup", "piece"],
              labels: {
                g: "g", // the same in every language
                ml: "ml",
                tbsp: { en: "tbsp", "pt-BR": "colher de sopa", de: "EL", es: "cucharada", pl: "łyżka", it: "cucchiaio" },
                tsp: { en: "tsp", "pt-BR": "colher de chá", de: "TL", es: "cucharadita", pl: "łyżeczka", it: "cucchiaino" },
                cup: { en: "cup", "pt-BR": "xícara", de: "Tasse", es: "taza", pl: "szklanka", it: "tazza" },
                piece: { en: "piece", "pt-BR": "unidade", de: "Stück", es: "unidad", pl: "sztuka", it: "pezzo" },
              },
            },
          },
        },
        steps: {
          type: "list",
          ordered: true,
          label: { en: "Steps", "pt-BR": "Passos", de: "Schritte", es: "Pasos", pl: "Kroki", it: "Passaggi" },
          of: {
            text: { type: "text", multiline: true, required: true, label: { en: "Text", "pt-BR": "Texto", de: "Text", es: "Texto", pl: "Opis", it: "Testo" } },
            // A duration, not a bare number: the form asks in minutes and the card reads "8 min"
            // rather than "Duration Sec: 480" (#99, #104). The stored value is still seconds.
            durationSec: { type: "duration", unit: "s", label: { en: "Time", "pt-BR": "Tempo", de: "Zeit", es: "Tiempo", pl: "Czas", it: "Tempo" } },
          },
        },
        lastCookedAt: { type: "datetime", hidden: true },
        timesCooked: { type: "number", default: 0, integer: true, hidden: true },
        notes: {
          type: "text",
          multiline: true,
          label: { en: "Your notes", "pt-BR": "Suas anotações", de: "Deine Notizen", es: "Tus notas", pl: "Twoje notatki", it: "Le tue note" },
          placeholder: { en: "Less salt next time. Ana loved it.", "pt-BR": "Menos sal da próxima vez. A Ana adorou.", de: "Nächstes Mal weniger Salz. Ana fand es super.", es: "Menos sal la próxima vez. A Ana le encantó.", pl: "Następnym razem mniej soli. Ani bardzo smakowało.", it: "La prossima volta meno sale. Ad Ana è piaciuta tanto." },
        },
        source: { type: "url", label: { en: "Where it's from", "pt-BR": "De onde veio", de: "Woher es stammt", es: "De dónde viene", pl: "Skąd pochodzi", it: "Da dove viene" } },
      },
      // One arrangement for the form and the detail page (#100). The form shows the fields of each
      // group it can edit; the detail page shows the computed values too.
      groups: [
        { title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" }, fields: ["name", "status", "photo", "tags"] },
        // Folds on the record page, remembered on this device, with the count in its heading (#108).
        {
          title: { en: "Ingredients", "pt-BR": "Ingredientes", de: "Zutaten", es: "Ingredientes", pl: "Składniki", it: "Ingredienti" },
          fields: ["ingredients"],
          collapsible: true,
        },
        { title: { en: "Steps", "pt-BR": "Passos", de: "Schritte", es: "Pasos", pl: "Kroki", it: "Passaggi" }, fields: ["steps"], collapsed: true },
        {
          title: {
            en: "Nutrition & cost",
            "pt-BR": "Nutrição e custo",
            de: "Nährwerte & Kosten",
            es: "Nutrición y coste",
            pl: "Wartości odżywcze i koszt",
            it: "Nutrizione e costo",
          },
          fields: ["servings", "caloriesPerServing", "proteinPerServing", "diet", "estimatedCost", "missingIngredients"],
        },
        { title: { en: "Your notes", "pt-BR": "Suas anotações", de: "Deine Notizen", es: "Tus notas", pl: "Twoje notatki", it: "Le tue note" }, fields: ["notes", "source"] },
      ],

      // ---- logic: ordinary functions; relations on `r` are pre-resolved ----
      computed: {
        calories: (r) =>
          ingredientRows(r).reduce((s, i) => s + (i.ingredient.caloriesPer100 ?? 0) * i.quantity / 100, 0),
        protein: (r) =>
          ingredientRows(r).reduce((s, i) => s + (i.ingredient.proteinPer100 ?? 0) * i.quantity / 100, 0),
        fat: (r) =>
          ingredientRows(r).reduce((s, i) => s + (i.ingredient.fatPer100 ?? 0) * i.quantity / 100, 0),
        carbs: (r) =>
          ingredientRows(r).reduce((s, i) => s + (i.ingredient.carbsPer100 ?? 0) * i.quantity / 100, 0),
        // A computed a page shows under a heading says what it is called, in every language (#310).
        caloriesPerServing: {
          label: { en: "Calories per serving", "pt-BR": "Calorias por porção", de: "Kalorien pro Portion", es: "Calorías por ración", pl: "Kalorie na porcję", it: "Calorie per porzione" },
          value: (r) => r.calories / Math.max(r.servings, 1),
        },
        proteinPerServing: {
          label: { en: "Protein per serving", "pt-BR": "Proteína por porção", de: "Eiweiß pro Portion", es: "Proteína por ración", pl: "Białko na porcję", it: "Proteine per porzione" },
          value: (r) => r.protein / Math.max(r.servings, 1),
        },
        totalMinutes: {
          label: { en: "Time (min)", "pt-BR": "Tempo (min)", de: "Zeit (Min.)", es: "Tiempo (min)", pl: "Czas (min)", it: "Tempo (min)" },
          value: (r) => totalMinutes(r),
        },
        // The cover's chips (DetailView.facts): a glyph for a label, the value in words.
        time: { label: "⏱", value: (r, ctx) => (totalMinutes(r) ? minutesText(totalMinutes(r), ctx) : "") },
        kcal: { label: "🔥", value: (r) => (r.calories ? `${Math.round(r.calories / Math.max(r.servings, 1))} kcal` : "") },
        serves: {
          label: "🍽",
          value: (r, ctx) =>
            ctx.t({ en: "{n, plural, one {# serving} other {# servings}}", "pt-BR": "{n, plural, one {# porção} other {# porções}}", de: "{n, plural, one {# Portion} other {# Portionen}}", es: "{n, plural, one {# ración} other {# raciones}}", pl: "{n, plural, one {# porcja} few {# porcje} many {# porcji} other {# porcji}}", it: "{n, plural, one {# porzione} other {# porzioni}}" }, { n: Math.max(Number(r.servings) || 1, 1) }),
        },
        difficulty: (r) => scoreDifficulty(r), // "easy" | "medium" | "hard"
        // derived from the ingredient models — the whole point of relations being resolved
        diet: {
          label: { en: "Diet", "pt-BR": "Dieta", de: "Ernährung", es: "Dieta", pl: "Dieta", it: "Dieta" },
          // What each value reads as on a badge or the detail page; the value stays the key a filter compares.
          labels: {
            vegan: { en: "vegan", "pt-BR": "vegana", de: "vegan", es: "vegana", pl: "wegański", it: "vegana" },
            vegetarian: { en: "vegetarian", "pt-BR": "vegetariana", de: "vegetarisch", es: "vegetariana", pl: "wegetariański", it: "vegetariana" },
            "animal-based": { en: "animal-based", "pt-BR": "de origem animal", de: "tierisch", es: "de origen animal", pl: "odzwierzęcy", it: "di origine animale" },
            unknown: { en: "unknown", "pt-BR": "desconhecida", de: "unbekannt", es: "desconocida", pl: "nieznany", it: "sconosciuta" },
          },
          value: (r) => {
            const diets = ingredientRows(r).map((i: any) => i.ingredient.diet).filter(Boolean);
            if (diets.length === 0) return "unknown";
            if (diets.every((d: string) => d === "vegan")) return "vegan";
            if (diets.every((d: string) => d === "vegan" || d === "vegetarian")) return "vegetarian";
            return "animal-based";
          },
        },
        estimatedCost: {
          label: { en: "Estimated cost", "pt-BR": "Custo estimado", de: "Geschätzte Kosten", es: "Coste estimado", pl: "Szacowany koszt", it: "Costo stimato" },
          value: (r) => ingredientRows(r).reduce((s: number, i: any) => s + (i.ingredient.pricePerKg ?? 0) * (i.quantity / 1000), 0),
        },
        // which ingredients this recipe needs that aren't currently in stock
        missingIngredients: {
          label: { en: "Missing ingredients", "pt-BR": "Ingredientes em falta", de: "Fehlende Zutaten", es: "Ingredientes que faltan", pl: "Brakujące składniki", it: "Ingredienti mancanti" },
          value: (r) => ingredientRows(r).filter((i: any) => !i.ingredient.inStock).map((i: any) => i.ingredient.name),
        },
        canCook: (r) => ingredientRows(r).length > 0 && ingredientRows(r).every((i: any) => i.ingredient.inStock),
      },

      actions: {
        markCooked: {
          label: { en: "Cooked it", "pt-BR": "Fiz esta", de: "Gekocht", es: "La cociné", pl: "Ugotowane", it: "Cucinata" },
          icon: "✓",
          description: "Record that this recipe was cooked today.",
          run: async (r, ctx) => {
            await ctx.patch("recipe", r.id, {
              lastCookedAt: ctx.now(),
              timesCooked: (r.timesCooked ?? 0) + 1,
              // Cooking it is how a recipe earns its place: tried at least, once you have.
              ...(r.status === "want to try" ? { status: "tried" } : {}),
            });
            ctx.ui.toast(
              ctx.t(
                { en: "Nice — cooked {n}×", "pt-BR": "Boa — feita {n}×", de: "Super — {n}× gekocht", es: "Genial — cocinada {n}×", pl: "Super — ugotowane {n}×", it: "Ottimo — cucinata {n}×" },
                { n: r.timesCooked ? r.timesCooked + 1 : 1 },
              ),
            );
          },
        },
        plan: {
          label: { en: "Plan it", "pt-BR": "Planejar", de: "Einplanen", es: "Planificar", pl: "Zaplanuj", it: "Pianifica" },
          icon: "📅",
          description: "Put this recipe on a day of the week's plan.",
          input: {
            date: { type: "datetime", required: true, label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" } },
            slot: {
              type: "enum",
              options: ["breakfast", "lunch", "dinner"],
              default: "dinner",
              label: { en: "Meal", "pt-BR": "Refeição", de: "Mahlzeit", es: "Comida", pl: "Posiłek", it: "Pasto" },
              labels: {
                breakfast: { en: "breakfast", "pt-BR": "café da manhã", de: "Frühstück", es: "desayuno", pl: "śniadanie", it: "colazione" },
                lunch: { en: "lunch", "pt-BR": "almoço", de: "Mittagessen", es: "comida", pl: "obiad", it: "pranzo" },
                dinner: { en: "dinner", "pt-BR": "jantar", de: "Abendessen", es: "cena", pl: "kolacja", it: "cena" },
              },
            },
          },
          run: async (r, ctx, input) => {
            const { date, slot } = (input ?? {}) as { date?: Date | string; slot?: string };
            await ctx.create("meal", { recipe: r.id, date: date ? new Date(date) : ctx.today(), slot: slot ?? "dinner" });
            ctx.ui.toast(ctx.t({ en: "On the plan: {name}", "pt-BR": "No plano: {name}", de: "Eingeplant: {name}", es: "En el plan: {name}", pl: "W planie: {name}", it: "Nel piano: {name}" }, { name: String(r.name) }));
          },
        },
        shop: {
          label: { en: "Add to shopping", "pt-BR": "Pôr na lista de compras", de: "Auf die Einkaufsliste", es: "A la lista de la compra", pl: "Do listy zakupów", it: "Alla lista della spesa" },
          icon: "🛒",
          description: "Put this recipe's missing ingredients on the shopping list.",
          run: async (r, ctx) => {
            // What the pantry lacks, offered to pick from: untick what you have after all.
            const missing = ingredientRows(r).filter((i: any) => !i.ingredient.inStock);
            if (!missing.length) {
              ctx.ui.toast(ctx.t({ en: "You have everything for this one.", "pt-BR": "Você já tem tudo para esta.", de: "Du hast schon alles dafür.", es: "Ya tienes todo para esta.", pl: "Masz już wszystko do tego przepisu.", it: "Hai già tutto per questa." }));
              return;
            }
            const picked = (await ctx.ui.pick(missing, { multi: true, label: (i: any) => `${i.ingredient.name} · ${i.quantity} ${i.unit ?? ""}`.trim() })) as any[] | null;
            if (!picked?.length) return;
            const already = new Set((await ctx.query("buy")).filter((b) => !b.done).map((b) => b.ingredient?.id));
            for (const i of picked) {
              if (already.has(i.ingredient.id)) continue;
              await ctx.create("buy", { name: i.ingredient.name, quantity: `${i.quantity} ${i.unit ?? ""}`.trim(), ingredient: i.ingredient.id, forRecipe: r.name, done: false });
            }
            ctx.ui.toast(ctx.t({ en: "{n, plural, one {# thing} other {# things}} on the shopping list", "pt-BR": "{n, plural, one {# item} other {# itens}} na lista de compras", de: "{n, plural, one {# Sache} other {# Sachen}} auf der Einkaufsliste", es: "{n, plural, one {# cosa} other {# cosas}} en la lista de la compra", pl: "{n, plural, one {# rzecz} few {# rzeczy} many {# rzeczy} other {# rzeczy}} na liście zakupów", it: "{n, plural, one {# cosa} other {# cose}} nella lista della spesa" }, { n: picked.length }));
          },
        },
      },
    },

    // A meal on the week's plan: a recipe on a day.
    meal: {
      label: { en: "Meal", "pt-BR": "Refeição", de: "Mahlzeit", es: "Comida", pl: "Posiłek", it: "Pasto" },
      icon: "📅",
      displayField: "title",
      fields: {
        recipe: { type: "relation", to: "recipe", required: true, label: { en: "Recipe", "pt-BR": "Receita", de: "Rezept", es: "Receta", pl: "Przepis", it: "Ricetta" } },
        date: { type: "datetime", required: true, label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" } },
        slot: {
          type: "enum",
          options: ["breakfast", "lunch", "dinner"],
          default: "dinner",
          colors: { breakfast: "yellow", lunch: "teal", dinner: "orange" },
          label: { en: "Meal", "pt-BR": "Refeição", de: "Mahlzeit", es: "Comida", pl: "Posiłek", it: "Pasto" },
          labels: {
            breakfast: { en: "breakfast", "pt-BR": "café da manhã", de: "Frühstück", es: "desayuno", pl: "śniadanie", it: "colazione" },
            lunch: { en: "lunch", "pt-BR": "almoço", de: "Mittagessen", es: "comida", pl: "obiad", it: "pranzo" },
            dinner: { en: "dinner", "pt-BR": "jantar", de: "Abendessen", es: "cena", pl: "kolacja", it: "cena" },
          },
        },
        note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
      computed: {
        title: (m) => String(m.recipe?.name ?? "—"),
        // The recipe's photo on the meal's row (a list row shows a field of the row it draws).
        picture: (m) => m.recipe?.photo ?? null,
      },
      actions: {
        cook: {
          label: { en: "Cook", "pt-BR": "Cozinhar", de: "Kochen", es: "Cocinar", pl: "Gotuj", it: "Cucina" },
          icon: "🍳",
          run: async (m, ctx) => {
            if (m.recipe?.id) ctx.navigate("cook", { recipeId: m.recipe.id });
          },
        },
      },
    },

    // One thing on the shopping list. From a recipe it remembers the ingredient, so putting it away
    // marks that ingredient in stock — and "What can I cook?" grows.
    buy: {
      label: { en: "Shopping item", "pt-BR": "Item de compra", de: "Einkauf", es: "Artículo", pl: "Produkt", it: "Articolo" },
      icon: "🛒",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        quantity: { type: "text", label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" } },
        done: { type: "boolean", default: false, label: { en: "Bought", "pt-BR": "Comprado", de: "Gekauft", es: "Comprado", pl: "Kupione", it: "Comprato" } },
        ingredient: { type: "relation", to: "ingredient", label: { en: "Ingredient", "pt-BR": "Ingrediente", de: "Zutat", es: "Ingrediente", pl: "Składnik", it: "Ingrediente" } },
        forRecipe: { type: "text", label: { en: "For", "pt-BR": "Para", de: "Für", es: "Para", pl: "Do", it: "Per" } },
      },
    },
  },

  pages: [
    {
      // The cookbook: every recipe as a photo, keepers first. Adding one is the page's one big button,
      // and two of its three ways in are a photo or pasted text that AI reads for you.
      id: "all",
      icon: "🍳",
      title: { en: "Recipes", "pt-BR": "Receitas", de: "Rezepte", es: "Recetas", pl: "Przepisy", it: "Ricette" },
      description: { en: "Your cookbook, keepers first.", "pt-BR": "Seu livro de receitas, as favoritas primeiro.", de: "Dein Kochbuch, Lieblingsrezepte zuerst.", es: "Tu recetario, las favoritas primero.", pl: "Twoja książka kucharska, ulubione na początku.", it: "Il tuo ricettario, le preferite prima." },
      background: { image: "art/market.webp" },
      summary: [
        { label: { en: "Recipes", "pt-BR": "Receitas", de: "Rezepte", es: "Recetas", pl: "Przepisy", it: "Ricette" }, op: "count" },
        { label: { en: "Ready to cook", "pt-BR": "Prontas para fazer", de: "Kochbereit", es: "Listas para cocinar", pl: "Można gotować", it: "Pronte da cucinare" }, value: (rows) => rows.filter((r) => r.canCook).length },
        { label: { en: "Times cooked", "pt-BR": "Vezes feitas", de: "Mal gekocht", es: "Veces cocinadas", pl: "Razy ugotowane", it: "Volte cucinate" }, field: "timesCooked", op: "sum" },
      ],
      actions: [{ label: { en: "Add a recipe", "pt-BR": "Adicionar receita", de: "Rezept hinzufügen", es: "Añadir receta", pl: "Dodaj przepis", it: "Aggiungi ricetta" }, icon: "＋", run: addRecipe }],
      primaryAction: 0,
      view: {
        type: "gallery",
        entity: "recipe",
        // Keepers, then what you have tried, then what you want to try; by name inside each.
        sort: (a, b) => ["keeper", "tried", "want to try"].indexOf(String(a.status)) - ["keeper", "tried", "want to try"].indexOf(String(b.status)) || a.name.localeCompare(b.name),
        // Under a heading per status, in the order the rows are sorted (a function's groups keep it).
        group: (r, ctx) =>
          r.status === "keeper"
            ? ctx.t({ en: "Keepers", "pt-BR": "Favoritas", de: "Lieblingsrezepte", es: "Favoritas", pl: "Ulubione", it: "Preferite" })
            : r.status === "tried"
              ? ctx.t({ en: "Tried", "pt-BR": "Já provei", de: "Probiert", es: "Probadas", pl: "Wypróbowane", it: "Provate" })
              : ctx.t({ en: "Want to try", "pt-BR": "Quero provar", de: "Will ich probieren", es: "Quiero probarlas", pl: "Do wypróbowania", it: "Da provare" }),
        display: {
          primary: "name",
          secondary: (r, ctx) => recipeLine(r, ctx),
          media: "photo",
          badges: ["diet"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
        emptyText: {
          en: "No recipes yet. Add one from a photo of a cookbook page, or paste one in.",
          "pt-BR": "Nenhuma receita ainda. Adicione uma a partir da foto de uma página, ou cole o texto.",
          de: "Noch keine Rezepte. Füge eins aus dem Foto einer Kochbuchseite hinzu oder füge Text ein.",
          es: "Aún no hay recetas. Añade una desde la foto de una página o pega el texto.",
          pl: "Nie ma jeszcze przepisów. Dodaj przepis ze zdjęcia strony z książki albo wklej tekst.",
          it: "Ancora nessuna ricetta. Aggiungine una dalla foto di una pagina o incolla il testo.",
        },
      },
    },
    {
      // Find something to cook: everything you can make right now first, then what each is missing.
      id: "cook-with",
      icon: "🔍",
      title: { en: "What can I cook?", "pt-BR": "O que posso cozinhar?", de: "Was kann ich kochen?", es: "¿Qué puedo cocinar?", pl: "Co mogę ugotować?", it: "Cosa posso cucinare?" },
      description: { en: "What you can make with what you have, and what each one is missing.", "pt-BR": "O que dá para fazer com o que você tem, e o que falta em cada uma.", de: "Was du mit deinem Vorrat kochen kannst, und was jeweils fehlt.", es: "Lo que puedes hacer con lo que tienes, y lo que le falta a cada una.", pl: "Co ugotujesz z tego, co masz, i czego brakuje do każdego przepisu.", it: "Cosa puoi fare con quello che hai, e cosa manca a ciascuna." },
      view: {
        type: "list",
        entity: "recipe",
        // Search, and what searching MEANS is the app's own rule: the chip only collects what was typed
        // (#216). Here it is the name or any tag. The pantry chip picks ingredient records into
        // ctx.params.pantry; the JS predicate below keeps the recipes those ingredients can make.
        filters: [
          {
            label: { en: "Search", "pt-BR": "Buscar", de: "Suche", es: "Buscar", pl: "Szukaj", it: "Cerca" },
            param: "q",
            type: "text",
            placeholder: { en: "Name or tag", "pt-BR": "Nome ou etiqueta", de: "Name oder Schlagwort", es: "Nombre o etiqueta", pl: "Nazwa lub tag", it: "Nome o tag" },
          },
          { label: { en: "Can cook now", "pt-BR": "Dá para fazer agora", de: "Jetzt kochbar", es: "Puedo hacerla ya", pl: "Mogę ugotować teraz", it: "Si può fare ora" }, param: "ready", type: "boolean" },
          {
            label: { en: "Ready in (min)", "pt-BR": "Pronta em (min)", de: "Fertig in (Min.)", es: "Lista en (min)", pl: "Gotowe w (min)", it: "Pronta in (min)" },
            param: "max",
            type: "number",
            placeholder: "30",
          },
          { label: { en: "Meal", "pt-BR": "Refeição", de: "Mahlzeit", es: "Comida", pl: "Posiłek", it: "Pasto" }, param: "tag", from: "tags", multi: true },
          { label: { en: "In my pantry", "pt-BR": "Na minha despensa", de: "In meinem Vorrat", es: "En mi despensa", pl: "W mojej spiżarni", it: "Nella mia dispensa" }, param: "pantry", from: "ingredient", multi: true },
        ],
        filter: (r, ctx) => {
          const { q, ready, max, tag, pantry } = ctx.params as { q?: string; ready?: boolean; max?: number; tag?: string[]; pantry?: string[] };
          const query = String(q ?? "").trim().toLowerCase();
          const tags = (r.tags as string[] | undefined) ?? [];
          if (query && !r.name.toLowerCase().includes(query) && !tags.some((t) => t.toLowerCase().includes(query))) return false;
          if (ready && !r.canCook) return false;
          if (typeof max === "number" && max > 0 && !(r.totalMinutes > 0 && r.totalMinutes <= max)) return false;
          if (tag?.length && !tag.some((t) => tags.includes(t))) return false;
          if (pantry?.length) {
            const have = new Set(pantry);
            return ingredientRows(r).length > 0 && ingredientRows(r).every((i) => have.has(i.ingredient.id));
          }
          return true;
        },
        // What you can cook comes first; then the fewest missing.
        sort: (a, b) => a.missingIngredients.length - b.missingIngredients.length || a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r, ctx) =>
            r.canCook
              ? ctx.t({ en: "✓ You have everything · {line}", "pt-BR": "✓ Você tem tudo · {line}", de: "✓ Alles da · {line}", es: "✓ Tienes todo · {line}", pl: "✓ Masz wszystko · {line}", it: "✓ Hai tutto · {line}" }, { line: recipeLine(r, ctx) })
              : ctx.t({ en: "Missing: {list}", "pt-BR": "Falta: {list}", de: "Es fehlt: {list}", es: "Falta: {list}", pl: "Brakuje: {list}", it: "Manca: {list}" }, { list: (r.missingIngredients as string[]).join(", ") }),
          media: "photo",
          badges: ["tags"],
        },
        rowActions: ["shop"],
        onOpen: { page: "detail", param: { recipeId: "id" } },
        emptyText: {
          en: "Nothing matches. Loosen a filter, or mark ingredients “in stock”.",
          "pt-BR": "Nada combina. Afrouxe um filtro ou marque ingredientes como “em estoque”.",
          de: "Nichts passt. Lockere einen Filter oder markiere Zutaten als „vorrätig“.",
          es: "Nada coincide. Quita algún filtro o marca ingredientes como «en casa».",
          pl: "Nic nie pasuje. Poluzuj filtr albo zaznacz składniki jako „na stanie”.",
          it: "Nessuna corrispondenza. Allenta un filtro o segna ingredienti “in dispensa”.",
        },
      },
    },
    {
      // The week's plan: a recipe on a day. Plan one from its page; tap a meal to cook it.
      id: "week",
      icon: "📅",
      title: { en: "This week", "pt-BR": "Esta semana", de: "Diese Woche", es: "Esta semana", pl: "Ten tydzień", it: "Questa settimana" },
      description: { en: "What's cooking, day by day. Plan a recipe from its page.", "pt-BR": "O que vai para a mesa, dia a dia. Planeje uma receita na página dela.", de: "Was es gibt, Tag für Tag. Plane ein Rezept auf seiner Seite ein.", es: "Qué se cocina, día a día. Planifica una receta desde su página.", pl: "Co gotujesz, dzień po dniu. Zaplanuj przepis z jego strony.", it: "Cosa si cucina, giorno per giorno. Pianifica una ricetta dalla sua pagina." },
      view: {
        type: "timeline",
        entity: "meal",
        date: "date",
        groupBy: "day",
        newest: "last",
        color: "slot",
        // From today on: last week's dinners are history, not a plan.
        filter: (m, ctx) => new Date(String(m.date)).getTime() >= ctx.today().getTime(),
        display: {
          primary: "title",
          // A related record arrives without its computed values: its time is worked out from its steps here.
          secondary: (m, ctx) => [slotName(m.slot, ctx), m.recipe && totalMinutes(m.recipe as Resolved) ? minutesText(totalMinutes(m.recipe as Resolved), ctx) : "", m.note ?? ""].filter(Boolean).join(" · "),
          media: "picture",
        },
        onOpen: { page: "meal", param: { mealId: "id" } },
        emptyText: {
          en: "Nothing planned. Open a recipe and tap “Plan it”.",
          "pt-BR": "Nada planejado. Abra uma receita e toque em “Planejar”.",
          de: "Nichts geplant. Öffne ein Rezept und tippe auf „Einplanen“.",
          es: "Nada planificado. Abre una receta y toca «Planificar».",
          pl: "Nic nie zaplanowano. Otwórz przepis i stuknij „Zaplanuj”.",
          it: "Niente in programma. Apri una ricetta e tocca “Pianifica”.",
        },
      },
    },
    {
      // The shopping list the recipes make. Put away what you bought and the pantry knows.
      id: "shopping",
      icon: "🛒",
      title: { en: "Shopping", "pt-BR": "Compras", de: "Einkaufen", es: "Compras", pl: "Zakupy", it: "Spesa" },
      description: { en: "What your recipes need. Tick it in the shop, then put it away.", "pt-BR": "O que suas receitas pedem. Marque no mercado e depois guarde.", de: "Was deine Rezepte brauchen. Im Laden abhaken, dann verstauen.", es: "Lo que piden tus recetas. Márcalo en la tienda y luego guárdalo.", pl: "Czego potrzebują twoje przepisy. Odhacz w sklepie, potem odłóż.", it: "Quello che serve alle tue ricette. Spunta al negozio, poi metti via." },
      actions: [{ label: { en: "Put away", "pt-BR": "Guardar", de: "Verstauen", es: "Guardar", pl: "Odłóż", it: "Metti via" }, icon: "🧺", run: putAway }],
      view: {
        type: "checklist",
        entity: "buy",
        done: "done",
        text: "name",
        detail: (b) => [b.quantity, b.forRecipe].filter(Boolean).join(" · "),
        hideDone: "collapse",
        quickAdd: true,
        emptyText: {
          en: "The list is empty. On a recipe, “Add to shopping” puts what's missing here.",
          "pt-BR": "A lista está vazia. Numa receita, “Pôr na lista de compras” traz o que falta para cá.",
          de: "Die Liste ist leer. Bei einem Rezept setzt „Auf die Einkaufsliste“ hierher, was fehlt.",
          es: "La lista está vacía. En una receta, «A la lista de la compra» trae aquí lo que falta.",
          pl: "Lista jest pusta. W przepisie „Do listy zakupów” dodaje tu to, czego brakuje.",
          it: "La lista è vuota. In una ricetta, “Alla lista della spesa” porta qui quello che manca.",
        },
      },
    },

    // ---- ingredients are first-class: their own list + detail pages ----
    {
      id: "pantry",
      icon: "🥕",
      title: { en: "Ingredients", "pt-BR": "Ingredientes", de: "Zutaten", es: "Ingredientes", pl: "Składniki", it: "Ingredienti" },
      description: { en: "Your pantry. What's in stock decides what you can cook.", "pt-BR": "Sua despensa. O que há em estoque decide o que dá para fazer.", de: "Dein Vorrat. Was da ist, entscheidet, was du kochen kannst.", es: "Tu despensa. Lo que hay en casa decide qué puedes cocinar.", pl: "Twoja spiżarnia. To, co masz, decyduje, co ugotujesz.", it: "La tua dispensa. Quello che c'è decide cosa puoi cucinare." },
      view: {
        type: "list",
        entity: "ingredient",
        sort: (a, b) => Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name),
        display: {
          primary: (i) => i.name,
          secondary: (i, ctx) => {
            const stock = i.inStock
              ? ctx.t({ en: "✓ in stock", "pt-BR": "✓ em estoque", de: "✓ vorrätig", es: "✓ en casa", pl: "✓ na stanie", it: "✓ in dispensa" })
              : ctx.t({ en: "out of stock", "pt-BR": "em falta", de: "nicht vorrätig", es: "falta", pl: "brak", it: "finito" });
            return `${stock} · ${categoryName(i.category, ctx)}`;
          },
          badges: ["diet"],
        },
        rowActions: ["toggleStock"],
        onOpen: { page: "ingredient", param: { ingredientId: "id" } },
      },
    },
    {
      // Every recipe by where it stands with you: drag one to "keeper" once it earns it (#107).
      id: "cookbook",
      icon: "📒",
      title: { en: "Cookbook", "pt-BR": "Livro de receitas", de: "Kochbuch", es: "Recetario", pl: "Książka kucharska", it: "Ricettario" },
      description: { en: "Drag a recipe to “keeper” once it earns it.", "pt-BR": "Arraste uma receita para “favorita” quando ela merecer.", de: "Zieh ein Rezept zu „Lieblingsrezept“, wenn es das verdient.", es: "Arrastra una receta a «favorita» cuando se lo gane.", pl: "Przeciągnij przepis do „ulubionych”, gdy na to zasłuży.", it: "Trascina una ricetta tra le “preferite” quando se lo merita." },
      view: {
        type: "board",
        entity: "recipe",
        column: "status",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r, ctx) => recipeLine(r, ctx),
          media: "photo",
          badges: ["tags"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "high-protein",
      icon: "💪",
      title: { en: "High protein", "pt-BR": "Rico em proteína", de: "Proteinreich", es: "Alto en proteína", pl: "Dużo białka", it: "Ricco di proteine" },
      description: { en: "20 g of protein a serving or more.", "pt-BR": "20 g de proteína por porção ou mais.", de: "Ab 20 g Eiweiß pro Portion.", es: "20 g de proteína por ración o más.", pl: "Co najmniej 20 g białka na porcję.", it: "Almeno 20 g di proteine a porzione." },
      view: {
        type: "table",
        entity: "recipe",
        filter: (r) => r.proteinPerServing >= 20,
        sort: (a, b) => b.protein - a.protein,
        display: { columns: ["name", "proteinPerServing", "caloriesPerServing", "servings"] },
      },
    },
    {
      // A recipe as a full screen: its photo, the facts on it, and "Start cooking".
      id: "detail",
      title: { en: "Recipe", "pt-BR": "Receita", de: "Rezept", es: "Receta", pl: "Przepis", it: "Ricetta" },
      hidden: true,
      view: {
        type: "detail",
        entity: "recipe",
        param: "recipeId",
        cover: "full",
        facts: ["status", "time", "kcal", "serves"],
        // No `sections`: the page shows the entity's `groups`, as the form does.
        primaryAction: {
          label: { en: "Start cooking", "pt-BR": "Começar a cozinhar", de: "Loskochen", es: "Empezar a cocinar", pl: "Zacznij gotować", it: "Inizia a cucinare" },
          navigate: { page: "cook", param: { recipeId: "id" } },
        },
        actions: [
          "plan",
          "shop",
          "markCooked",
        ],
      },
    },
    {
      id: "ingredient",
      title: { en: "Ingredient", "pt-BR": "Ingrediente", de: "Zutat", es: "Ingrediente", pl: "Składnik", it: "Ingrediente" },
      hidden: true,
      view: {
        type: "detail",
        entity: "ingredient",
        param: "ingredientId",
        // `sections` on the page override the entity's groups for this page only.
        sections: [
          { title: { en: "About", "pt-BR": "Sobre", de: "Info", es: "Información", pl: "Informacje", it: "Info" }, fields: ["inStock", "diet", "category", "seasons", "pricePerKg"] },
          {
            title: {
              en: "Nutrition (per 100g)",
              "pt-BR": "Nutrição (por 100 g)",
              de: "Nährwerte (pro 100 g)",
              es: "Nutrición (por 100 g)",
              pl: "Wartości odżywcze (na 100 g)",
              it: "Valori nutrizionali (per 100 g)",
            },
            fields: ["caloriesPer100", "proteinPer100", "fatPer100", "carbsPer100"],
            collapsible: true,
          },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["notes"] },
        ],
        actions: ["toggleStock"],
      },
    },
    {
      id: "meal",
      title: { en: "Meal", "pt-BR": "Refeição", de: "Mahlzeit", es: "Comida", pl: "Posiłek", it: "Pasto" },
      hidden: true,
      view: { type: "detail", entity: "meal", param: "mealId", media: "picture", primaryAction: "cook" },
    },
    {
      id: "cook",
      title: { en: "Cook", "pt-BR": "Cozinhar", de: "Kochen", es: "Cocinar", pl: "Gotuj", it: "Cucina" },
      hidden: true,
      view: {
        type: "custom",
        entity: "recipe",
        param: "recipeId",
        render: (props) => CookAlong(props), // full React component — the no-ceiling escape hatch
        onFinish: "markCooked",
      },
    },
  ],

  reminders: [],
});
