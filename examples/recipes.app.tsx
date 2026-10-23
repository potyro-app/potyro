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
// Written in English; its translations are catalogs, examples/files/recipes/locales/<lang>.po
// (docs/30), every language but English a model's draft (#297). Recipes,
// ingredients and steps are records and stay as written. A function sees an enum's stored value,
// never its label (docs/20 Q5), so the few lines that put a category, a season or a difficulty into
// words say it through the small `…Name` helpers below, with the same words as the fields' labels.
// The search chip matches what is stored: a recipe's name as typed, and its tags' stored keys.
import { defineApp } from "potyro";
import { useEffect, useState } from "react";
import type { AiImage, Ctx, Resolved, UiTimer, ViewProps } from "potyro";

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
  if (d === "easy") return ctx.t("easy");
  if (d === "medium") return ctx.t("medium");
  return ctx.t("hard");
};

/** A recipe's diet (the `diet` computed) in words: it agrees with "recipe", not with "ingredient". */
const dietName = (d: unknown, ctx: Ctx): string => {
  if (d === "vegan") return ctx.t("vegan");
  if (d === "vegetarian") return ctx.t("vegetarian");
  if (d === "animal-based") return ctx.t("animal-based");
  return ctx.t("unknown");
};

/** An ingredient's category in words: the same as `category`'s labels. */
const categoryName = (c: unknown, ctx: Ctx): string => {
  switch (c) {
    case "vegetable":
      return ctx.t("vegetable");
    case "fruit":
      return ctx.t("fruit");
    case "grain":
      return ctx.t("grain");
    case "dairy":
      return ctx.t("dairy");
    case "protein":
      return ctx.t("protein");
    case "spice":
      return ctx.t("spice");
    case "fat":
      return ctx.t("fat");
    case "other":
      return ctx.t("other");
    default:
      return "—";
  }
};

/** A season in words: the same as `seasons`' labels. */
const seasonName = (s: string, ctx: Ctx): string => {
  if (s === "spring") return ctx.t("spring");
  if (s === "summer") return ctx.t("summer");
  if (s === "autumn") return ctx.t("autumn");
  if (s === "winter") return ctx.t("winter");
  return s;
};


/** A meal slot in words: the same as `slot`'s labels. */
const slotName = (s: unknown, ctx: Ctx): string => {
  if (s === "breakfast") return ctx.t("Breakfast");
  if (s === "lunch") return ctx.t("Lunch");
  return ctx.t("Dinner");
};

// ---- Cook mode (docs M1 DoD): a full React component — the "no ceiling" escape hatch. One step at a
// time in type you can read from the stove, the step's timer one tap away, the ingredients scaled to
// the servings you are cooking, and "Cooked it" at the end. Every step also has its tick in the list
// underneath, so you can see where you are and jump back.
//
// A step's timer is the SHELL's (`ctx.ui.timer`), one per step: its chip stays in sight while you
// read the next step, look up a substitute in another app or lock the phone, and it rings at the end
// whatever the screen shows. While cook mode is open the screen stays on (`ctx.ui.keepAwake`): flour
// on your hands is not the moment to unlock a phone. ----
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
  // The shell's timers for this app, as last read. The shell keeps and rings them; this only draws.
  const [timers, setTimers] = useState<UiTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Read back every second: a timer paused, stopped or rung on its chip shows here too.
  useEffect(() => {
    let reading = false;
    const read = (): void => {
      setNow(Date.now());
      if (reading) return;
      reading = true;
      void ctx.ui
        .timers()
        .then(setTimers)
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The step on screen draws its own timer (its button counts down): the shell's chip for that one
  // stays out of the way while it is here, and shows for the other steps' timers, on other pages and
  // once it rings. Drawn again the moment its second changes, so it never trails the chip's count.
  const shownStep = record && Array.isArray(record.steps) ? (record.steps as Step[])[at] : undefined;
  const shownId = record && shownStep?.durationSec ? `step:${record.id}:${at}` : null;
  const shown = timers.find((t) => t.id === shownId);
  // Said while the step's timer button is on screen, before it is tapped: the chip never flashes up.
  useEffect(() => {
    if (!shownId) return;
    const drawn = ctx.ui.drawsTimer(shownId);
    return () => drawn.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);
  const nextSecond = shown?.endsAt ? shown.endsAt.getTime() - now : 0;
  const tick = nextSecond > 0 ? nextSecond % 1000 || 1000 : null;
  useEffect(() => {
    if (tick === null) return;
    const id = setTimeout(() => setNow(Date.now()), tick + 4);
    return () => clearTimeout(id);
  }, [tick, now]);

  // The screen stays on for as long as cook mode is open, and may sleep again when it closes.
  useEffect(() => {
    const awake = ctx.ui.keepAwake();
    return () => awake.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p>{ctx.t("Loading…")}</p>;
  if (!record) {
    return <p>{ctx.t("Recipe not found.")}</p>;
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
  // One timer per step of this recipe: two pans can count down at once, and starting a step's timer
  // again restarts it rather than stacking a second.
  const timerId = (i: number): string => `step:${record.id}:${i}`;
  const timer = shown;
  // The chip's own count (`secondsLeft`): the button and the chip on another page say the same second.
  const left = timer ? timer.secondsLeft(now) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const toggleTimer = (seconds: number): void => {
    if (timer) {
      setTimers((all) => all.filter((t) => t !== timer));
      void timer.cancel().catch(() => undefined);
      return;
    }
    void ctx.ui
      .timer({
        label: ctx.t("{name}, step {n}", { name: String(record.name), n: at + 1 }),
        seconds,
        id: timerId(at),
      })
      .then((t) => setTimers((all) => [...all.filter((x) => x.id !== t.id), t]))
      .catch((e: unknown) => ctx.ui.toast(e instanceof Error ? e.message : String(e)));
  };
  const stepWord = ctx.t("Step {n} of {total}", { n: at + 1, total: steps.length });

  return (
    <section className="ck" aria-labelledby="cook-heading">
      <style>{COOK_CSS}</style>
      <header className="ck-head">
        <h1 id="cook-heading" className="ck-title">
          {ctx.t("Cooking: {name}", { name: String(record.name) })}
        </h1>
        {steps.length > 0 ? (
          <div className="ck-progress">
            {steps.map((_, i) => (
              <button key={i} type="button" className="ck-dot" data-on={i === at} data-done={done.has(i)} aria-label={ctx.t("Go to step {n}", { n: i + 1 })} onClick={() => setAt(i)} />
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
                data-running={timer != null}
                data-paused={timer?.paused || undefined}
                onClick={() => toggleTimer(Number(step.durationSec))}
              >
                {timer
                  ? `⏱ ${clock} · ${ctx.t("stop")}`
                  : `⏱ ${ctx.t("Start a {time} timer", { time: minutesText(Math.max(1, Math.round(Number(step.durationSec) / 60)), ctx) })}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="ck-step">{ctx.t("This recipe has no steps yet.")}</p>
        )}
        <div className="ck-nav">
          <button type="button" className="ck-btn" disabled={at === 0} onClick={() => go(at - 1)}>
            {ctx.t("Back")}
          </button>
          {last ? (
            <button type="button" className="ck-btn primary" onClick={() => void finish()}>
              {ctx.t("Cooked it ✓")}
            </button>
          ) : (
            <button type="button" className="ck-btn primary" onClick={() => { toggle(at); go(at + 1); }}>
              {ctx.t("Next step")}
            </button>
          )}
        </div>
      </div>

      <aside className="ck-side">
        <div className="ck-box">
          <h2>
            {ctx.t("Ingredients")}
            <span className="ck-serv">
              <button type="button" aria-label={ctx.t("Fewer servings")} onClick={() => setServings(Math.max(1, serving - 1))}>−</button>
              <span>{ctx.t("{n, plural, one {# serving} other {# servings}}", { n: serving })}</span>
              <button type="button" aria-label={ctx.t("More servings")} onClick={() => setServings(serving + 1)}>+</button>
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
          <h2>{ctx.t("All steps")}</h2>
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
    ctx.ui.toast(ctx.t("AI isn't available here. Type the recipe in instead."));
    return;
  }
  let source: { image?: AiImage; text?: string } = {};
  if (how === "photo") {
    const [photo] = await ctx.files.import({ folder: "captured", accept: "image/*" });
    if (!photo) return;
    source = { image: photo };
  } else {
    const text = await ctx.ui.prompt(ctx.t("Paste the recipe: from a website, a message, a caption"));
    if (!text?.trim()) return;
    source = { text };
  }
  const bar = ctx.ui.progress(ctx.t("Reading the recipe…"));
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
    title: ctx.t("AI's reading — check it"),
    fields: {
      name: { type: "text", required: true, label: ctx.t("Name") },
      servings: { type: "number", min: 1, integer: true, label: ctx.t("Servings") },
    },
    initial: { name: read.title, servings: read.servings ?? 2 },
    submit: ctx.t("Save recipe"),
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
    title: ctx.t("Add a recipe"),
    items: [
      { id: "photo", icon: "camera", label: ctx.t("From a photo"), detail: ctx.t("A cookbook page or a screenshot") },
      { id: "paste", icon: "clipboard-list", label: ctx.t("Paste the text"), detail: ctx.t("From a website, a message, a caption") },
      { id: "type", icon: "pencil", label: ctx.t("Type it in") },
    ],
  });
  if (how === "photo" || how === "paste") return captureRecipe(ctx, how);
  if (how !== "type") return;
  const typed = await ctx.ui.form<{ name: string; servings: number }>({
    title: ctx.t("New recipe"),
    fields: {
      name: { type: "text", required: true, placeholder: "Shakshuka", label: ctx.t("Name") },
      servings: { type: "number", min: 1, integer: true, default: 2, label: ctx.t("Servings") },
    },
    initial: { servings: 2 },
    submit: ctx.t("Add recipe"),
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
      ? ctx.t("{n, plural, one {# thing} other {# things}} put away in the pantry", { n: bought.length })
      : ctx.t("Tick what you bought first."),
  );
}

export default defineApp({
  id: "recipes",
  name: "Recipes",
  icon: "cooking-pot",
  version: "2.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#E4A93C" },
  // A step timer rings through the shell (`ctx.ui.timer`), which needs no permission.
  permissions: { camera: true, filesystem: true, ai: true },
  nav: "tabs",
  // Adding a recipe is rare next to choosing and cooking it: a quiet button beside the cookbook's
  // search, never a floating one. An ingredient is added where the pantry is — its page's own button.
  quickActions: [
    { id: "add-ingredient", label: "Add: Ingredient", icon: "carrot", entity: "ingredient", mode: "form" },
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
        ? ctx.t("Tonight: {name}", { name: String(next.name) })
        : String(next.name),
      lines: [
        next.lastCookedAt
          ? ctx.t("Last cooked {when}", { when: ctx.format.relative(new Date(String(next.lastCookedAt)), { unit: "day" }) })
          : ctx.t("Not cooked yet"),
        ctx.t("{n, plural, one {# recipe} other {# recipes}}", { n: recipes.length }),
      ],
      ...(next.photo ? { image: next.photo as never } : {}),
    };
  },

  entities: {
    ingredient: {
      label: "Ingredient",
      icon: "carrot",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        // ingredients are a real data model — not just a picker option
        // Three options, so all three show as a row of buttons; the colours mean something here.
        diet: {
          type: "enum",
          options: ["vegan", "vegetarian", "animal-based"],
          label: "Diet",
          colors: { vegan: "green", vegetarian: "teal", "animal-based": "red" },
          labels: {
            vegan: { text: "vegan", context: "diet vegan" },
            vegetarian: { text: "vegetarian", context: "diet vegetarian" },
            "animal-based": "animal-based",
          },
        },
        category: {
          type: "enum",
          label: "Category",
          options: ["vegetable", "fruit", "grain", "dairy", "protein", "spice", "fat", "other"],
          labels: {
            vegetable: "vegetable",
            fruit: "fruit",
            grain: "grain",
            dairy: "dairy",
            protein: "protein",
            spice: "spice",
            fat: "fat",
            other: "other",
          },
        },
        seasons: {
          type: "tags",
          label: "Seasons",
          options: ["spring", "summer", "autumn", "winter"],
          labels: {
            spring: "spring",
            summer: "summer",
            autumn: "autumn",
            winter: "winter",
          },
        },
        pricePerKg: {
          type: "number",
          unit: "$/kg",
          min: 0,
          label: "Price per kg",
        },
        caloriesPer100: {
          type: "number",
          unit: "kcal",
          min: 0,
          label: "Calories per 100 g",
        },
        proteinPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: "Protein per 100 g",
        },
        fatPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: "Fat per 100 g",
        },
        carbsPer100: {
          type: "number",
          unit: "g",
          min: 0,
          label: "Carbs per 100 g",
        },
        inStock: {
          type: "boolean",
          default: false,
          label: "In stock",
        },
        notes: { type: "text", multiline: true, label: "Notes" },
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
          label: "Have it / used up",
          run: async (i, ctx) => {
            await ctx.patch("ingredient", i.id, { inStock: !i.inStock });
            // The ingredient's name is a record: the app's words go around it.
            ctx.ui.toast(
              i.inStock
                ? ctx.t(
                    "Used up {name}",
                    { name: String(i.name) },
                  )
                : ctx.t(
                    "{name} in stock",
                    { name: String(i.name) },
                  ),
            );
          },
        },
      },
    },

    recipe: {
      label: "Recipe",
      icon: "cooking-pot",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Shakshuka", label: "Name" },
        // Where the recipe stands with you; the Cookbook board's columns (#107).
        status: {
          type: "enum",
          label: "Status",
          options: ["want to try", "tried", "keeper"],
          default: "want to try",
          colors: { "want to try": "yellow", tried: "teal", keeper: "green" },
          labels: {
            "want to try": "want to try",
            tried: "tried",
            keeper: "keeper",
          },
        },
        photo: { type: "media", accept: "image", label: "Photo" },
        tags: {
          type: "tags",
          label: "Tags",
          options: ["breakfast", "lunch", "dinner", "snack", "vegetarian", "vegan"],
          labels: {
            breakfast: "breakfast",
            lunch: "lunch",
            dinner: "dinner",
            snack: "snack",
            vegetarian: { text: "vegetarian", context: "tags vegetarian" },
            vegan: { text: "vegan", context: "tags vegan" },
          },
        },
        servings: {
          type: "number",
          default: 2,
          min: 1,
          integer: true,
          label: "Servings",
          help: "The per-serving figures divide by this",
        },
        ingredients: {
          type: "list",
          label: "Ingredients",
          // Read as a recipe card reads: "350 g banana", one per line.
          lines: ["quantity", "unit", "ingredient"],
          of: {
            ingredient: {
              type: "relation",
              to: "ingredient",
              required: true,
              label: "Ingredient",
            },
            quantity: {
              type: "number",
              min: 0,
              required: true,
              label: "Quantity",
            },
            unit: {
              type: "enum",
              label: "Unit",
              options: ["g", "ml", "tbsp", "tsp", "cup", "piece"],
              labels: {
                g: "g", // the same in every language
                ml: "ml",
                tbsp: "tbsp",
                tsp: "tsp",
                cup: "cup",
                piece: "piece",
              },
            },
          },
        },
        steps: {
          type: "list",
          ordered: true,
          label: "Steps",
          of: {
            text: { type: "text", multiline: true, required: true, label: "Text" },
            // A duration, not a bare number: the form asks in minutes and the card reads "8 min"
            // rather than "Duration Sec: 480" (#99, #104). The stored value is still seconds.
            durationSec: { type: "duration", unit: "s", label: "Time" },
          },
        },
        lastCookedAt: { type: "datetime", hidden: true, label: "Last cooked" },
        timesCooked: { type: "number", default: 0, integer: true, hidden: true, label: "Times cooked" },
        notes: {
          type: "text",
          multiline: true,
          label: "Your notes",
          placeholder: "Less salt next time. Ana loved it.",
        },
        source: { type: "url", label: "Where it's from" },
      },
      // One arrangement for the form and the detail page (#100). The form shows the fields of each
      // group it can edit; the detail page shows the computed values too.
      groups: [
        { title: "Overview", fields: ["name", "status", "photo", "tags"] },
        // Folds on the record page, remembered on this device, with the count in its heading (#108).
        {
          title: "Ingredients",
          fields: ["ingredients"],
          collapsible: true,
        },
        { title: "Steps", fields: ["steps"], collapsed: true },
        {
          title: "Nutrition & cost",
          fields: ["servings", "caloriesPerServing", "proteinPerServing", "diet", "estimatedCost", "missingIngredients"],
        },
        { title: "Your notes", fields: ["notes", "source"] },
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
          label: "Calories per serving",
          value: (r) => r.calories / Math.max(r.servings, 1),
        },
        proteinPerServing: {
          label: "Protein per serving",
          value: (r) => r.protein / Math.max(r.servings, 1),
        },
        totalMinutes: {
          label: "Time (min)",
          value: (r) => totalMinutes(r),
        },
        // The cover's chips (DetailView.facts): a glyph for a label, the value in words.
        time: { label: "⏱", value: (r, ctx) => (totalMinutes(r) ? minutesText(totalMinutes(r), ctx) : "") },
        kcal: { label: "🔥", value: (r) => (r.calories ? `${Math.round(r.calories / Math.max(r.servings, 1))} kcal` : "") },
        serves: {
          label: "🍽",
          value: (r, ctx) =>
            ctx.t("{n, plural, one {# serving} other {# servings}}", { n: Math.max(Number(r.servings) || 1, 1) }),
        },
        difficulty: (r) => scoreDifficulty(r), // "easy" | "medium" | "hard"
        // derived from the ingredient models — the whole point of relations being resolved
        diet: {
          label: "Diet",
          // What each value reads as on a badge or the detail page; the value stays the key a filter compares.
          labels: {
            vegan: "vegan",
            vegetarian: "vegetarian",
            "animal-based": "animal-based",
            unknown: "unknown",
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
          label: "Estimated cost",
          value: (r) => ingredientRows(r).reduce((s: number, i: any) => s + (i.ingredient.pricePerKg ?? 0) * (i.quantity / 1000), 0),
        },
        // which ingredients this recipe needs that aren't currently in stock
        missingIngredients: {
          label: "Missing ingredients",
          value: (r) => ingredientRows(r).filter((i: any) => !i.ingredient.inStock).map((i: any) => i.ingredient.name),
        },
        canCook: (r) => ingredientRows(r).length > 0 && ingredientRows(r).every((i: any) => i.ingredient.inStock),
      },

      actions: {
        markCooked: {
          label: "Cooked it",
          icon: "check",
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
                "Nice — cooked {n}×",
                { n: r.timesCooked ? r.timesCooked + 1 : 1 },
              ),
            );
          },
        },
        plan: {
          label: "Plan it",
          icon: "calendar",
          description: "Put this recipe on a day of the week's plan.",
          input: {
            date: { type: "datetime", required: true, label: "Day" },
            slot: {
              type: "enum",
              options: ["breakfast", "lunch", "dinner"],
              default: "dinner",
              label: "Meal",
              labels: {
                breakfast: "breakfast",
                lunch: "lunch",
                dinner: "dinner",
              },
            },
          },
          run: async (r, ctx, input) => {
            const { date, slot } = (input ?? {}) as { date?: Date | string; slot?: string };
            await ctx.create("meal", { recipe: r.id, date: date ? new Date(date) : ctx.today(), slot: slot ?? "dinner" });
            ctx.ui.toast(ctx.t("On the plan: {name}", { name: String(r.name) }));
          },
        },
        shop: {
          label: "Add to shopping",
          icon: "shopping-cart",
          description: "Put this recipe's missing ingredients on the shopping list.",
          run: async (r, ctx) => {
            // What the pantry lacks, offered to pick from: untick what you have after all.
            const missing = ingredientRows(r).filter((i: any) => !i.ingredient.inStock);
            if (!missing.length) {
              ctx.ui.toast(ctx.t("You have everything for this one."));
              return;
            }
            const picked = (await ctx.ui.pick(missing, { multi: true, label: (i: any) => `${i.ingredient.name} · ${i.quantity} ${i.unit ?? ""}`.trim() })) as any[] | null;
            if (!picked?.length) return;
            const already = new Set((await ctx.query("buy")).filter((b) => !b.done).map((b) => b.ingredient?.id));
            for (const i of picked) {
              if (already.has(i.ingredient.id)) continue;
              await ctx.create("buy", { name: i.ingredient.name, quantity: `${i.quantity} ${i.unit ?? ""}`.trim(), ingredient: i.ingredient.id, forRecipe: r.name, done: false });
            }
            ctx.ui.toast(ctx.t("{n, plural, one {# thing} other {# things}} on the shopping list", { n: picked.length }));
          },
        },
      },
    },

    // A meal on the week's plan: a recipe on a day.
    meal: {
      label: "Meal",
      icon: "calendar",
      displayField: "title",
      fields: {
        recipe: { type: "relation", to: "recipe", required: true, label: "Recipe" },
        date: { type: "datetime", required: true, label: "Day" },
        slot: {
          type: "enum",
          options: ["breakfast", "lunch", "dinner"],
          default: "dinner",
          colors: { breakfast: "yellow", lunch: "teal", dinner: "orange" },
          label: "Meal",
          labels: {
            breakfast: "breakfast",
            lunch: "lunch",
            dinner: "dinner",
          },
        },
        note: { type: "text", label: "Note" },
      },
      computed: {
        title: (m) => String(m.recipe?.name ?? "—"),
        // The recipe's photo on the meal's row (a list row shows a field of the row it draws).
        picture: (m) => m.recipe?.photo ?? null,
      },
      actions: {
        cook: {
          label: "Cook",
          icon: "cooking-pot",
          run: async (m, ctx) => {
            if (m.recipe?.id) ctx.navigate("cook", { recipeId: m.recipe.id });
          },
        },
      },
    },

    // One thing on the shopping list. From a recipe it remembers the ingredient, so putting it away
    // marks that ingredient in stock — and "What can I cook?" grows.
    buy: {
      label: "Shopping item",
      icon: "shopping-cart",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        quantity: { type: "text", label: "Quantity" },
        done: { type: "boolean", default: false, label: "Bought" },
        ingredient: { type: "relation", to: "ingredient", label: "Ingredient" },
        forRecipe: { type: "text", label: "For" },
      },
    },
  },

  pages: [
    {
      // The cookbook: what you open the app for most days — choosing what to cook. Search and a few
      // chips first ("Can cook now", "Under 30 min", the meal), then every recipe as a photo, keepers
      // first. Adding one is rare next to that: a quiet button beside the search, whose three ways in
      // are a photo or pasted text that AI reads for you, or typing it.
      id: "all",
      icon: "cooking-pot",
      title: "Recipes",
      description: "Your cookbook, keepers first.",
      actions: [{ label: "Add a recipe", icon: "plus", run: addRecipe }],
      // It is the phone's "+" in the top bar: there when wanted, never in the way.
      add: 0,
      view: {
        type: "gallery",
        entity: "recipe",
        // Search, and what searching MEANS is the app's own rule: the chip only collects what was typed
        // (#216) — here the name or any tag.
        filters: [
          {
            label: "Search",
            param: "q",
            type: "text",
            placeholder: "Search recipes",
          },
          { label: "Can cook now", param: "ready", type: "boolean" },
          { label: "Under 30 min", param: "quick", type: "boolean" },
          { label: "Meal", param: "tag", from: "tags", multi: true },
        ],
        filter: (r, ctx) => {
          const { q, ready, quick, tag } = ctx.params as { q?: string; ready?: boolean; quick?: boolean; tag?: string[] };
          const query = String(q ?? "").trim().toLowerCase();
          const tags = (r.tags as string[] | undefined) ?? [];
          if (query && !r.name.toLowerCase().includes(query) && !tags.some((t) => t.toLowerCase().includes(query))) return false;
          if (ready && !r.canCook) return false;
          if (quick && !(r.totalMinutes > 0 && r.totalMinutes <= 30)) return false;
          if (tag?.length && !tag.some((t) => tags.includes(t))) return false;
          return true;
        },
        // Keepers, then what you have tried, then what you want to try; by name inside each.
        sort: (a, b) => ["keeper", "tried", "want to try"].indexOf(String(a.status)) - ["keeper", "tried", "want to try"].indexOf(String(b.status)) || a.name.localeCompare(b.name),
        // Under a heading per status, in the order the rows are sorted (a function's groups keep it).
        group: (r, ctx) =>
          r.status === "keeper"
            ? ctx.t("Keepers")
            : r.status === "tried"
              ? ctx.t("Tried")
              : ctx.t("Want to try"),
        display: {
          primary: "name",
          secondary: (r, ctx) => recipeLine(r, ctx),
          media: "photo",
          badges: ["diet"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
        emptyText: "No recipes yet. Add one from a photo of a cookbook page, or paste one in.",
      },
    },
    {
      // The week's plan: a recipe on a day. Plan one from its page; tap a meal to cook it.
      id: "week",
      icon: "calendar",
      title: "This week",
      description: "What's cooking, day by day. Plan a recipe from its page.",
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
        emptyText: "Nothing planned. Open a recipe and tap “Plan it”.",
      },
    },
    {
      // The shopping list the recipes make. Put away what you bought and the pantry knows.
      id: "shopping",
      icon: "shopping-cart",
      title: "Shopping",
      description: "What your recipes need. Tick it in the shop, then put it away.",
      actions: [{ label: "Put away", icon: "shopping-basket", run: putAway }],
      view: {
        type: "checklist",
        entity: "buy",
        done: "done",
        text: "name",
        detail: (b) => [b.quantity, b.forRecipe].filter(Boolean).join(" · "),
        hideDone: "collapse",
        // Typing a thing you bought before offers it again with its quantity; typing one of your
        // ingredients links it, so "Put away" marks it in stock.
        quickAdd: {
          remember: ["quantity", "ingredient"],
          defaults: async (text, ctx) => {
            const found = (await ctx.query("ingredient")).find((i) => String(i.name).toLowerCase() === text.trim().toLowerCase());
            return found ? { ingredient: found.id } : {};
          },
        },
        emptyText: "The list is empty. On a recipe, “Add to shopping” puts what's missing here.",
      },
    },

    // ---- ingredients are first-class: their own list + detail pages ----
    {
      id: "pantry",
      icon: "carrot",
      title: "Pantry",
      description: "Your pantry. What's in stock decides what you can cook.",
      // What you have, as a list you tick: ticked is in stock. That is what decides "Can cook now".
      view: {
        type: "checklist",
        entity: "ingredient",
        done: "inStock",
        // Ticked is "have it", not "done": nothing is struck through.
        strike: false,
        text: "name",
        group: "category",
        sort: (a, b) => a.name.localeCompare(b.name),
        onOpen: { page: "ingredient", param: { ingredientId: "id" } },
      },
    },
    {
      // A recipe as it is used at the stove: the ingredients first, then the steps, over its photo —
      // the picture is behind the page, not a screen to scroll past. "Start cooking" waits at the
      // bottom, where the thumb is.
      id: "detail",
      title: "Recipe",
      hidden: true,
      view: {
        type: "detail",
        entity: "recipe",
        param: "recipeId",
        cover: "background",
        facts: ["time", "serves", "kcal", "status"],
        sections: [
          { title: "Ingredients", fields: ["ingredients"] },
          { title: "Steps", fields: ["steps"] },
          { title: "Your notes", fields: ["notes", "source"] },
          {
            title: "Nutrition & cost",
            fields: ["caloriesPerServing", "proteinPerServing", "diet", "estimatedCost", "missingIngredients"],
            collapsed: true,
          },
        ],
        primaryAction: {
          label: "Start cooking",
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
      title: "Ingredient",
      hidden: true,
      view: {
        type: "detail",
        entity: "ingredient",
        param: "ingredientId",
        // `sections` on the page override the entity's groups for this page only.
        sections: [
          { title: "About", fields: ["inStock", "diet", "category", "seasons", "pricePerKg"] },
          {
            title: "Nutrition (per 100g)",
            fields: ["caloriesPer100", "proteinPer100", "fatPer100", "carbsPer100"],
            collapsible: true,
          },
          { title: "Notes", fields: ["notes"] },
        ],
        actions: ["toggleStock"],
      },
    },
    {
      id: "meal",
      title: "Meal",
      hidden: true,
      view: { type: "detail", entity: "meal", param: "mealId", media: "picture", primaryAction: "cook" },
    },
    {
      id: "cook",
      title: "Cook",
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
