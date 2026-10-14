// recipes.app.ts
// Stresses: relations (recipe->ingredient), nested list rows, computed macros as real
// functions, a JS "ingredients I have" filter, and a CUSTOM cook-along view (full React).
//
// In six languages (#303); every language but English is a model's draft (#297). Recipes,
// ingredients and steps are records and stay as written. A function sees an enum's stored value,
// never its label (docs/20 Q5), so the few lines that put a category, a season or a difficulty into
// words say it through the small `…Name` helpers below, with the same words as the fields' labels.
// The search chip matches what is stored: a recipe's name as typed, and its tags' stored keys.
import { defineApp } from "potyro";
import { useState } from "react";
import type { Ctx, Resolved, ViewProps } from "potyro";

// ---- Your own code, in the same file. An app is one file: the Studio edits it, a share link carries
// it, and it runs anywhere the shell does. ----

/** Rough difficulty from the amount of prep + steps. */
function scoreDifficulty(r: Resolved): "easy" | "medium" | "hard" {
  const steps = Array.isArray(r.steps) ? r.steps.length : 0;
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
  const score = steps + ingredients;
  if (score <= 6) return "easy";
  if (score <= 12) return "medium";
  return "hard";
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

// The custom cook-along view (docs M1 DoD): a full React component — the "no ceiling" escape
// hatch. It reads the recipe via the runtime, keeps local tick state, and fires the finish
// action when every step is checked.
interface Step {
  text: string;
  durationSec?: number;
}

function CookAlong(props: ViewProps) {
  const { runtime, param } = props;
  const ctx = runtime.ctx;
  const recipeId = param?.recipeId ?? "";
  const { record, loading } = runtime.useRecord("recipe", recipeId);
  const [done, setDone] = useState<Set<number>>(() => new Set());

  if (loading) return <p>{ctx.t({ en: "Loading…", "pt-BR": "Carregando…", de: "Wird geladen…", es: "Cargando…", pl: "Wczytywanie…", it: "Caricamento…" })}</p>;
  if (!record) {
    return (
      <p>
        {ctx.t({
          en: "Recipe not found.",
          "pt-BR": "Receita não encontrada.",
          de: "Rezept nicht gefunden.",
          es: "No se encontró la receta.",
          pl: "Nie znaleziono przepisu.",
          it: "Ricetta non trovata.",
        })}
      </p>
    );
  }

  const steps: Step[] = Array.isArray(record.steps) ? (record.steps as Step[]) : [];
  const allDone = steps.length > 0 && done.size === steps.length;

  const toggle = (i: number): void =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section aria-labelledby="cook-heading">
      <h1 id="cook-heading">
        {ctx.t(
          { en: "Cooking: {name}", "pt-BR": "Cozinhando: {name}", de: "Jetzt kochen: {name}", es: "Cocinando: {name}", pl: "Gotujemy: {name}", it: "In cucina: {name}" },
          { name: String(record.name) },
        )}
      </h1>
      <ol>
        {steps.map((step, i) => (
          <li key={i} data-done={done.has(i)}>
            <label>
              <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
              <span>{step.text}</span>
              {step.durationSec ? <em> · {ctx.format.number(Math.round(step.durationSec / 60), { style: "unit", unit: "minute" })}</em> : null}
            </label>
          </li>
        ))}
      </ol>
      <button type="button" disabled={!allDone} onClick={() => void runtime.runAction("recipe", "markCooked", record.id)}>
        {ctx.t({ en: "Finish", "pt-BR": "Concluir", de: "Fertig", es: "Terminar", pl: "Zakończ", it: "Termina" })}
      </button>
    </section>
  );
}

export default defineApp({
  id: "recipes",
  name: { en: "Recipes", "pt-BR": "Receitas", de: "Rezepte", es: "Recetas", pl: "Przepisy", it: "Ricette" },
  icon: "🍳",
  version: "1.1.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#E4A93C" },
  permissions: { camera: true, filesystem: true },

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
      ],

      // ---- logic: ordinary functions; relations on `r` are pre-resolved ----
      computed: {
        calories: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.caloriesPer100 ?? 0) * i.quantity / 100, 0),
        protein: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.proteinPer100 ?? 0) * i.quantity / 100, 0),
        fat: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.fatPer100 ?? 0) * i.quantity / 100, 0),
        carbs: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.carbsPer100 ?? 0) * i.quantity / 100, 0),
        caloriesPerServing: (r) => r.calories / Math.max(r.servings, 1),
        proteinPerServing: (r) => r.protein / Math.max(r.servings, 1),
        difficulty: (r) => scoreDifficulty(r), // "easy" | "medium" | "hard"
        // derived from the ingredient models — the whole point of relations being resolved
        diet: (r) => {
          const diets = r.ingredients.map((i: any) => i.ingredient.diet).filter(Boolean);
          if (diets.length === 0) return "unknown";
          if (diets.every((d: string) => d === "vegan")) return "vegan";
          if (diets.every((d: string) => d === "vegan" || d === "vegetarian")) return "vegetarian";
          return "animal-based";
        },
        estimatedCost: (r) =>
          r.ingredients.reduce((s: number, i: any) => s + (i.ingredient.pricePerKg ?? 0) * (i.quantity / 1000), 0),
        // which ingredients this recipe needs that aren't currently in stock
        missingIngredients: (r) =>
          r.ingredients.filter((i: any) => !i.ingredient.inStock).map((i: any) => i.ingredient.name),
        canCook: (r) => r.ingredients.length > 0 && r.ingredients.every((i: any) => i.ingredient.inStock),
      },

      actions: {
        markCooked: {
          label: {
            en: "Mark Cooked",
            "pt-BR": "Marcar como feita",
            de: "Als gekocht markieren",
            es: "Marcar como cocinada",
            pl: "Oznacz jako ugotowane",
            it: "Segna come cucinata",
          },
          run: async (r, ctx) => {
            await ctx.patch("recipe", r.id, {
              lastCookedAt: ctx.now(),
              timesCooked: (r.timesCooked ?? 0) + 1,
            });
            ctx.ui.toast(
              ctx.t(
                {
                  en: "Nice — cooked {n}×",
                  "pt-BR": "Boa — feita {n}×",
                  de: "Super — {n}× gekocht",
                  es: "Genial — cocinada {n}×",
                  pl: "Super — ugotowane {n}×",
                  it: "Ottimo — cucinata {n}×",
                },
                { n: r.timesCooked ? r.timesCooked + 1 : 1 },
              ),
            );
          },
        },
      },
    },
  },

  pages: [
    {
      id: "all",
      icon: "🍳",
      title: { en: "Recipes", "pt-BR": "Receitas", de: "Rezepte", es: "Recetas", pl: "Przepisy", it: "Ricette" },
      // A split (#105): on a wide screen a row fills the recipe on the right; on a phone it opens
      // the detail page below, as any list does.
      layout: {
        type: "split",
        items: [
          {
            view: {
              type: "list",
              entity: "recipe",
              // Search, and what searching MEANS is the app's own rule: the chip only collects what
              // was typed (#216). Here it is the name or any tag — for a different app it might be
              // the notes, or a spelling normalised for accents. A host that decided this for
              // everyone would be wrong somewhere.
              filters: [
                {
                  label: { en: "Search", "pt-BR": "Buscar", de: "Suche", es: "Buscar", pl: "Szukaj", it: "Cerca" },
                  param: "q",
                  type: "text",
                  placeholder: { en: "Name or tag", "pt-BR": "Nome ou etiqueta", de: "Name oder Schlagwort", es: "Nombre o etiqueta", pl: "Nazwa lub tag", it: "Nome o tag" },
                },
              ],
              filter: (r, ctx) => {
                const q = String(ctx.params.q ?? "").trim().toLowerCase();
                if (!q) return true;
                const tags = (r.tags as string[] | undefined) ?? [];
                return r.name.toLowerCase().includes(q) || tags.some((t) => t.toLowerCase().includes(q));
              },
              sort: (a, b) => a.name.localeCompare(b.name),
              display: {
                primary: (r) => r.name,
                secondary: (r, ctx) => `${Math.round(r.caloriesPerServing)} kcal · ${difficultyName(r.difficulty, ctx)}`,
                media: "photo",
                badges: ["tags"],
              },
              rowActions: ["markCooked"],
              onOpen: { page: "detail", param: { recipeId: "id" } },
            },
          },
          {
            view: {
              type: "detail",
              entity: "recipe",
              param: "recipeId",
              actions: [
                {
                  label: { en: "Cook", "pt-BR": "Cozinhar", de: "Kochen", es: "Cocinar", pl: "Gotuj", it: "Cucina" },
                  navigate: { page: "cook", param: { recipeId: "id" } },
                },
                "markCooked",
              ],
            },
          },
        ],
      },
    },
    {
      id: "cook-with",
      icon: "🔍",
      title: { en: "What can I cook?", "pt-BR": "O que posso cozinhar?", de: "Was kann ich kochen?", es: "¿Qué puedo cocinar?", pl: "Co mogę ugotować?", it: "Cosa posso cucinare?" },
      view: {
        type: "list",
        entity: "recipe",
        // the "In my pantry" chip picks ingredient records into ctx.params.pantry (record-source
        // filter chrome); the JS predicate below then keeps only fully-satisfiable recipes.
        filters: [
          {
            label: { en: "In my pantry", "pt-BR": "Na minha despensa", de: "In meinem Vorrat", es: "En mi despensa", pl: "W mojej spiżarni", it: "Nella mia dispensa" },
            param: "pantry",
            from: "ingredient",
            multi: true,
          },
        ],
        filter: (r, ctx) => {
          const have = new Set((ctx.params.pantry as string[]) ?? []);
          return r.ingredients.length > 0 && r.ingredients.every((i) => have.has(i.ingredient.id));
        },
        display: {
          primary: "name",
          secondary: (r, ctx) =>
            ctx.t(
              {
                en: "{n, plural, one {# ingredient} other {# ingredients}}",
                "pt-BR": "{n, plural, one {# ingrediente} other {# ingredientes}}",
                de: "{n, plural, one {# Zutat} other {# Zutaten}}",
                es: "{n, plural, one {# ingrediente} other {# ingredientes}}",
                pl: "{n, plural, one {# składnik} few {# składniki} many {# składników} other {# składnika}}",
                it: "{n, plural, one {# ingrediente} other {# ingredienti}}",
              },
              { n: r.ingredients.length },
            ),
          media: "photo",
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "high-protein",
      icon: "💪",
      title: { en: "High protein", "pt-BR": "Rico em proteína", de: "Proteinreich", es: "Alto en proteína", pl: "Dużo białka", it: "Ricco di proteine" },
      view: {
        type: "table",
        entity: "recipe",
        filter: (r) => r.proteinPerServing >= 20,
        sort: (a, b) => b.protein - a.protein,
        display: { columns: ["name", "proteinPerServing", "caloriesPerServing", "servings"] },
      },
    },
    {
      id: "plant-based",
      icon: "🌿",
      title: { en: "Plant-based", "pt-BR": "À base de plantas", de: "Pflanzlich", es: "Vegetal", pl: "Roślinne", it: "Vegetale" },
      view: {
        type: "list",
        entity: "recipe",
        // uses the recipe-level `diet` computed, which is derived from the ingredient models
        filter: (r) => r.diet === "vegan" || r.diet === "vegetarian",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r, ctx) =>
            ctx.t(
              {
                en: "{diet} · {kcal} kcal/serving",
                "pt-BR": "{diet} · {kcal} kcal/porção",
                de: "{diet} · {kcal} kcal/Portion",
                es: "{diet} · {kcal} kcal/ración",
                pl: "{diet} · {kcal} kcal/porcję",
                it: "{diet} · {kcal} kcal/porzione",
              },
              { diet: dietName(r.diet, ctx), kcal: String(Math.round(r.caloriesPerServing)) },
            ),
          media: "photo",
          badges: ["diet"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "ready",
      icon: "✅",
      title: { en: "Ready to cook", "pt-BR": "Prontas para fazer", de: "Kochbereit", es: "Listas para cocinar", pl: "Można gotować", it: "Pronte da cucinare" },
      view: {
        type: "list",
        entity: "recipe",
        // canCook is true when every ingredient is marked in stock
        filter: (r) => r.canCook,
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          // Prices are per kg in dollars ("$/kg" above), so the estimate is dollars: "3,50 US$" in Portuguese.
          secondary: (r, ctx) => `${ctx.format.money(Math.round(r.estimatedCost * 100), "USD")} · ${difficultyName(r.difficulty, ctx)}`,
          media: "photo",
        },
        rowActions: ["markCooked"],
        onOpen: { page: "detail", param: { recipeId: "id" } },
        emptyText: {
          en: "Nothing fully in stock yet — mark ingredients “in stock” on the Ingredients tab.",
          "pt-BR": "Ainda não há nada com tudo em estoque — marque os ingredientes como “em estoque” na aba Ingredientes.",
          de: "Noch ist nichts komplett vorrätig — markiere Zutaten im Tab Zutaten als „vorrätig“.",
          es: "Todavía no tienes todo para ninguna — marca los ingredientes como «en casa» en la pestaña Ingredientes.",
          pl: "Na razie nic nie jest w pełni na stanie — zaznacz składniki jako „na stanie” w zakładce Składniki.",
          it: "Ancora niente con tutto in dispensa — segna gli ingredienti come “in dispensa” nella scheda Ingredienti.",
        },
      },
    },
    {
      // Every recipe by where it stands with you: drag one to "keeper" once it earns it (#107).
      id: "cookbook",
      icon: "📒",
      title: { en: "Cookbook", "pt-BR": "Livro de receitas", de: "Kochbuch", es: "Recetario", pl: "Książka kucharska", it: "Ricettario" },
      view: {
        type: "board",
        entity: "recipe",
        column: "status",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r, ctx) => `${Math.round(r.caloriesPerServing)} kcal · ${difficultyName(r.difficulty, ctx)}`,
          badges: ["tags"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "detail",
      title: { en: "Recipe", "pt-BR": "Receita", de: "Rezept", es: "Receta", pl: "Przepis", it: "Ricetta" },
      hidden: true,
      view: {
        type: "detail",
        entity: "recipe",
        param: "recipeId",
        // No `sections`: the page shows the entity's `groups`, as the form does.
        // The first action is the page's one filled button (#111): cooking is why you opened it.
        actions: [
          {
            label: { en: "Cook", "pt-BR": "Cozinhar", de: "Kochen", es: "Cocinar", pl: "Gotuj", it: "Cucina" },
            navigate: { page: "cook", param: { recipeId: "id" } },
          },
          "markCooked",
        ],
      },
    },

    // ---- ingredients are first-class: their own list + detail pages ----
    {
      id: "pantry",
      icon: "🥕",
      title: { en: "Ingredients", "pt-BR": "Ingredientes", de: "Zutaten", es: "Ingredientes", pl: "Składniki", it: "Ingredienti" },
      view: {
        type: "list",
        entity: "ingredient",
        sort: (a, b) => a.name.localeCompare(b.name),
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
      id: "in-season",
      icon: "🌱",
      title: { en: "In season", "pt-BR": "Da estação", de: "Saisonal", es: "De temporada", pl: "Sezonowe", it: "Di stagione" },
      view: {
        type: "list",
        entity: "ingredient",
        filter: (i) => i.inSeason,
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (i, ctx) => {
            const seasons = ((i.seasons as string[]) ?? []).map((s) => seasonName(s, ctx)).join(", ");
            const when = seasons || ctx.t({ en: "year-round", "pt-BR": "o ano todo", de: "ganzjährig", es: "todo el año", pl: "cały rok", it: "tutto l'anno" });
            return `${categoryName(i.category, ctx)} · ${when}`;
          },
        },
        rowActions: ["toggleStock"],
        onOpen: { page: "ingredient", param: { ingredientId: "id" } },
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
          { title: { en: "About", "pt-BR": "Sobre", de: "Info", es: "Información", pl: "Informacje", it: "Info" }, fields: ["diet", "category", "seasons", "pricePerKg"] },
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
          },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["notes"] },
        ],
      },
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
