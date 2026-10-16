// Recipes' first-run records: a home cook's dozen — breakfasts, weeknight dinners, something to bake —
// each with its photo, real ingredients (with their nutrition and price, so the calories, cost and
// diet are worked out), steps with times, and a history of what was cooked when.
//
// The pantry is stocked so that a few recipes can be cooked right now (Fluffy Pancakes, Banana bread,
// Shakshuka) and the rest each miss something — which is what "What can I cook?" and "Ready to cook"
// are for. Fluffy Pancakes and Chicken Caesar are fixtures for the browser specs: keep their names.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

interface Ing {
  diet: "vegan" | "vegetarian" | "animal-based";
  category: string;
  price: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  stock?: boolean;
  seasons?: string[];
}

// Per 100 g; price in $/kg. Plain, typical values.
const INGREDIENTS: Record<string, Ing> = {
  Flour: { diet: "vegan", category: "grain", price: 1.2, kcal: 364, protein: 10, fat: 1, carbs: 76, stock: true },
  Egg: { diet: "vegetarian", category: "protein", price: 4, kcal: 155, protein: 13, fat: 11, carbs: 1, stock: true },
  Milk: { diet: "vegetarian", category: "dairy", price: 1.1, kcal: 42, protein: 3, fat: 1, carbs: 5, stock: true },
  Lettuce: { diet: "vegan", category: "vegetable", price: 3, kcal: 15, protein: 1, fat: 0, carbs: 3, seasons: ["spring", "summer"] },
  "Chicken breast": { diet: "animal-based", category: "protein", price: 9, kcal: 165, protein: 31, fat: 4, carbs: 0 },
  Butter: { diet: "vegetarian", category: "fat", price: 9, kcal: 717, protein: 1, fat: 81, carbs: 0, stock: true },
  Tomato: { diet: "vegan", category: "vegetable", price: 3, kcal: 18, protein: 1, fat: 0, carbs: 4, stock: true, seasons: ["summer", "autumn"] },
  Onion: { diet: "vegan", category: "vegetable", price: 1.5, kcal: 40, protein: 1, fat: 0, carbs: 9, stock: true },
  Garlic: { diet: "vegan", category: "spice", price: 8, kcal: 149, protein: 6, fat: 0, carbs: 33, stock: true },
  "Olive oil": { diet: "vegan", category: "fat", price: 10, kcal: 884, protein: 0, fat: 100, carbs: 0, stock: true },
  Cumin: { diet: "vegan", category: "spice", price: 25, kcal: 375, protein: 18, fat: 22, carbs: 44, stock: true },
  "Bell pepper": { diet: "vegan", category: "vegetable", price: 4, kcal: 31, protein: 1, fat: 0, carbs: 6, seasons: ["summer"] },
  Feta: { diet: "vegetarian", category: "dairy", price: 12, kcal: 264, protein: 14, fat: 21, carbs: 4 },
  Cucumber: { diet: "vegan", category: "vegetable", price: 2, kcal: 15, protein: 1, fat: 0, carbs: 4, seasons: ["summer"] },
  Olives: { diet: "vegan", category: "other", price: 10, kcal: 115, protein: 1, fat: 11, carbs: 6 },
  Mushrooms: { diet: "vegan", category: "vegetable", price: 7, kcal: 22, protein: 3, fat: 0, carbs: 3, seasons: ["autumn"] },
  "Arborio rice": { diet: "vegan", category: "grain", price: 4, kcal: 360, protein: 7, fat: 1, carbs: 79, stock: true },
  Parmesan: { diet: "vegetarian", category: "dairy", price: 20, kcal: 431, protein: 38, fat: 29, carbs: 4 },
  Chickpeas: { diet: "vegan", category: "protein", price: 3, kcal: 164, protein: 9, fat: 3, carbs: 27, stock: true },
  "Coconut milk": { diet: "vegan", category: "fat", price: 5, kcal: 230, protein: 2, fat: 24, carbs: 6 },
  Spaghetti: { diet: "vegan", category: "grain", price: 2, kcal: 371, protein: 13, fat: 2, carbs: 75, stock: true },
  "Minced beef": { diet: "animal-based", category: "protein", price: 10, kcal: 250, protein: 26, fat: 17, carbs: 0 },
  Avocado: { diet: "vegan", category: "fruit", price: 6, kcal: 160, protein: 2, fat: 15, carbs: 9 },
  Sourdough: { diet: "vegan", category: "grain", price: 5, kcal: 260, protein: 9, fat: 2, carbs: 50, stock: true },
  Banana: { diet: "vegan", category: "fruit", price: 1.8, kcal: 89, protein: 1, fat: 0, carbs: 23, stock: true },
  Pumpkin: { diet: "vegan", category: "vegetable", price: 2, kcal: 26, protein: 1, fat: 0, carbs: 7, seasons: ["autumn", "winter"] },
  Lime: { diet: "vegan", category: "fruit", price: 4, kcal: 30, protein: 1, fat: 0, carbs: 11, stock: true },
  "Greek yogurt": { diet: "vegetarian", category: "dairy", price: 5, kcal: 97, protein: 9, fat: 5, carbs: 4, stock: true },
  Berries: { diet: "vegan", category: "fruit", price: 12, kcal: 50, protein: 1, fat: 0, carbs: 12, seasons: ["summer"] },
  Oats: { diet: "vegan", category: "grain", price: 2.5, kcal: 389, protein: 17, fat: 7, carbs: 66, stock: true },
  "Corn tortillas": { diet: "vegan", category: "grain", price: 6, kcal: 218, protein: 6, fat: 3, carbs: 45 },
  Coriander: { diet: "vegan", category: "spice", price: 15, kcal: 23, protein: 2, fat: 1, carbs: 4 },
};

type Unit = "g" | "ml" | "tbsp" | "tsp" | "cup" | "piece";
type Line = [name: string, quantity: number, unit?: Unit];
type Step = [text: string, minutes?: number];

interface RecipeSeed {
  name: string;
  file: string;
  status: "want to try" | "tried" | "keeper";
  tags: string[];
  servings: number;
  ingredients: Line[];
  steps: Step[];
  /** Days ago, most recent first. */
  cooked?: number[];
}

const RECIPES: RecipeSeed[] = [
  {
    name: "Fluffy Pancakes",
    file: "pancakes",
    status: "keeper",
    tags: ["breakfast", "vegetarian"],
    servings: 2,
    ingredients: [["Flour", 200], ["Egg", 100], ["Milk", 300, "ml"]],
    steps: [["Whisk flour with a pinch of salt.", 1], ["Beat in eggs, then whisk in the milk until smooth.", 2], ["Ladle onto a hot griddle; flip when bubbles form.", 5]],
    cooked: [2, 9, 16, 30],
  },
  {
    name: "Chicken Caesar",
    file: "chicken-caesar",
    status: "tried",
    tags: ["lunch", "dinner"],
    servings: 1,
    ingredients: [["Chicken breast", 180], ["Lettuce", 120], ["Egg", 50]],
    steps: [["Grill the chicken and slice.", 8], ["Toss lettuce with dressing; top with chicken.", 2]],
    cooked: [12],
  },
  {
    name: "Shakshuka",
    file: "shakshuka",
    status: "keeper",
    tags: ["breakfast", "dinner", "vegetarian"],
    servings: 2,
    ingredients: [["Olive oil", 20, "ml"], ["Onion", 100], ["Garlic", 10], ["Cumin", 3], ["Tomato", 500], ["Egg", 200]],
    steps: [["Soften the onion in the oil.", 6], ["Add garlic and cumin; cook until fragrant.", 1], ["Add the tomatoes and simmer into a thick sauce.", 12], ["Make four wells, crack in the eggs, cover and cook until just set.", 6]],
    cooked: [5, 19],
  },
  {
    name: "Greek Salad",
    file: "greek-salad",
    status: "keeper",
    tags: ["lunch", "vegetarian"],
    servings: 2,
    ingredients: [["Tomato", 300], ["Cucumber", 200], ["Onion", 50], ["Olives", 60], ["Feta", 150], ["Olive oil", 30, "ml"]],
    steps: [["Cut tomatoes and cucumber into chunks, the onion into thin rings.", 5], ["Add the olives, lay the feta on top whole.", 1], ["Dress with oil, oregano and salt.", 1]],
    cooked: [7],
  },
  {
    name: "Mushroom Risotto",
    file: "mushroom-risotto",
    status: "tried",
    tags: ["dinner", "vegetarian"],
    servings: 2,
    ingredients: [["Arborio rice", 160], ["Mushrooms", 250], ["Onion", 80], ["Butter", 30], ["Parmesan", 40]],
    steps: [["Brown the mushrooms in half the butter; set aside.", 6], ["Soften the onion, add the rice and toast it.", 3], ["Add hot stock a ladle at a time, stirring.", 18], ["Stir in the mushrooms, the rest of the butter and the parmesan.", 2]],
    cooked: [24],
  },
  {
    name: "Chickpea Curry",
    file: "chickpea-curry",
    status: "keeper",
    tags: ["dinner", "vegan"],
    servings: 4,
    ingredients: [["Onion", 150], ["Garlic", 15], ["Cumin", 5], ["Tomato", 400], ["Chickpeas", 480], ["Coconut milk", 400, "ml"], ["Coriander", 10]],
    steps: [["Fry the onion until golden.", 8], ["Add garlic and spices for a minute.", 1], ["Add tomatoes and chickpeas; simmer.", 10], ["Stir in the coconut milk and warm through; finish with coriander.", 5]],
    cooked: [10, 38],
  },
  {
    name: "Spaghetti Bolognese",
    file: "spaghetti-bolognese",
    status: "keeper",
    tags: ["dinner"],
    servings: 4,
    ingredients: [["Spaghetti", 400], ["Minced beef", 500], ["Onion", 100], ["Garlic", 10], ["Tomato", 400], ["Olive oil", 20, "ml"]],
    steps: [["Brown the beef in the oil, in batches.", 8], ["Add onion and garlic; soften.", 5], ["Add tomatoes and simmer, low, as long as you can.", 45], ["Cook the spaghetti and toss it through the sauce.", 10]],
    cooked: [14, 42],
  },
  {
    name: "Avocado Toast",
    file: "avocado-toast",
    status: "tried",
    tags: ["breakfast", "vegan"],
    servings: 1,
    ingredients: [["Sourdough", 80], ["Avocado", 100], ["Lime", 15]],
    steps: [["Toast the bread.", 3], ["Mash the avocado with lime, salt and chilli flakes; spread thick.", 2]],
    cooked: [3],
  },
  {
    name: "Banana Bread",
    file: "banana-bread",
    status: "keeper",
    tags: ["snack", "vegetarian"],
    servings: 8,
    ingredients: [["Banana", 350], ["Flour", 250], ["Butter", 100], ["Egg", 100]],
    steps: [["Mash the bananas with the melted butter.", 3], ["Beat in the eggs, then fold in the flour and a teaspoon of baking soda.", 3], ["Bake in a lined tin at 175 °C.", 55], ["Cool in the tin before slicing.", 15]],
    cooked: [21],
  },
  {
    name: "Pumpkin Soup",
    file: "pumpkin-soup",
    status: "want to try",
    tags: ["lunch", "dinner", "vegan"],
    servings: 4,
    ingredients: [["Pumpkin", 1000], ["Onion", 150], ["Garlic", 10], ["Coconut milk", 200, "ml"], ["Olive oil", 20, "ml"]],
    steps: [["Roast the pumpkin in chunks until soft and caramelised.", 35], ["Soften onion and garlic in the oil.", 6], ["Blend everything with stock and the coconut milk.", 4]],
  },
  {
    name: "Guacamole",
    file: "guacamole",
    status: "tried",
    tags: ["snack", "vegan"],
    servings: 4,
    ingredients: [["Avocado", 400], ["Lime", 30], ["Onion", 40], ["Tomato", 100], ["Coriander", 10]],
    steps: [["Mash the avocados roughly with lime and salt.", 3], ["Fold in finely chopped onion, tomato and coriander.", 4]],
    cooked: [33],
  },
  {
    name: "Berry Yogurt Pots",
    file: "berry-yogurt-pots",
    status: "want to try",
    tags: ["breakfast", "vegetarian"],
    servings: 2,
    ingredients: [["Greek yogurt", 300], ["Oats", 60], ["Berries", 150]],
    steps: [["Layer yogurt and oats in two jars.", 3], ["Top with berries; leave in the fridge overnight.", 1]],
  },
  {
    name: "Street Tacos",
    file: "street-tacos",
    status: "want to try",
    tags: ["dinner"],
    servings: 2,
    ingredients: [["Corn tortillas", 180], ["Chicken breast", 300], ["Avocado", 150], ["Onion", 50], ["Lime", 30], ["Coriander", 10]],
    steps: [["Season and grill the chicken; slice thin.", 12], ["Warm the tortillas in a dry pan.", 3], ["Fill with chicken, avocado, onion and coriander; squeeze over lime.", 3]],
  },
];

export async function seedRecipes(store: Store, _me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("recipe")).length > 0) return;

  const ids = new Map<string, string>();
  for (const [name, i] of Object.entries(INGREDIENTS)) {
    const row = await store.insert("ingredient", {
      name,
      diet: i.diet,
      category: i.category,
      seasons: i.seasons ?? [],
      pricePerKg: i.price,
      inStock: i.stock ?? false,
      caloriesPer100: i.kcal,
      proteinPer100: i.protein,
      fatPer100: i.fat,
      carbsPer100: i.carbs,
    });
    ids.set(name, String(row.id));
  }

  const now = Date.now();
  for (const r of RECIPES) {
    const pic = await photo(`photos/${r.file}.webp`);
    await store.insert("recipe", {
      name: r.name,
      status: r.status,
      tags: r.tags,
      servings: r.servings,
      ingredients: r.ingredients.map(([name, quantity, unit]) => {
        const ingredient = ids.get(name);
        if (!ingredient) throw new Error(`seedRecipes: no ingredient “${name}”`);
        return { ingredient, quantity, unit: unit ?? "g" };
      }),
      steps: r.steps.map(([text, minutes]) => ({ text, ...(minutes ? { durationSec: minutes * 60 } : {}) })),
      timesCooked: r.cooked?.length ?? 0,
      ...(r.cooked?.length ? { lastCookedAt: new Date(now - r.cooked[0]! * DAY) } : {}),
      ...(pic ? { photo: pic } : {}),
    });
  }
}
