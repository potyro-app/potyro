// What a photo is read into, and how the app turns that reading into items the person checks.
//
// The model only reads: what each thing is, what kind of food, and a date — only when one is printed
// on it. The app decides the rest the same way every time: a printed date that cannot be right is
// dropped, a missing one is guessed from the kind of food and where it is kept, and the guess is
// marked as one.

import type { AiValue } from "potyro";
import {
  CATEGORIES,
  PLACES,
  USUAL_PLACE,
  daysBetween,
  guessExpiry,
  isCategory,
  isPlace,
  plausiblePrinted,
  startOfDay,
  toDate,
  type Category,
  type Place,
} from "./shelf-life.js";

/** Checked by the host before the app sees it: a category is always one of the list, a missing date `null`. */
export const SHELF = {
  kind: { oneOf: ["food", "receipt", "not food", "unreadable"] },
  boughtOn: "date?",
  items: [
    {
      name: "text",
      category: { oneOf: CATEGORIES },
      where: { oneOf: PLACES, optional: true },
      bestBefore: "date?",
      amount: "text?",
    },
  ],
} as const;

export type ShelfAnswer = AiValue<typeof SHELF>;
export type ShelfLine = ShelfAnswer["items"][number];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** What the model is told. Model-facing, so English (#297); today's date, so a date without a year can be placed. */
export function instructions(today: Date): string {
  return [
    "A photo of food: groceries on a table, a fridge or cupboard shelf, or a shop receipt. List the food in it.",
    "kind: food for a photo of food, receipt for a receipt, not food when there is no food or drink in it, unreadable when it is too blurry, dark or small to tell.",
    "items: one entry per kind of food or drink. Several of the same thing are one entry with an amount (×4, 500 g, 1 L). On a receipt, one entry per food or drink line; skip bags, cleaning products, deposits, totals and payment lines.",
    "name: short and plain, as a person would say it (Milk, Greek yogurt, Chicken thighs), in the language printed on it. No brand unless it is the only name.",
    "category: produce for fruit, vegetables and herbs; dairy for milk, yogurt, cheese, butter, cream, eggs; meat; fish for fish and seafood; bakery for bread and cakes; frozen for anything frozen; dry for pasta, rice, flour, tins, jars, cereal, snacks; drinks; leftovers for cooked food in a box; other.",
    "where: fridge, freezer or cupboard when the photo shows where it is kept; otherwise null.",
    `bestBefore: ONLY when a best-before, use-by or expiry date is printed on that item and readable in the photo, as YYYY-MM-DD. Today is ${iso(today)}; a printed date without a year is the next one to come. Never guess one: null when none is printed or it cannot be read.`,
    "boughtOn: on a receipt, the date it was printed, as YYYY-MM-DD; otherwise null.",
  ].join("\n");
}

/** One item as the confirm form shows it and the store keeps it. */
export interface Draft {
  name: string;
  expires: Date;
  guessed: boolean;
  category: Category;
  where: Place;
  amount?: string;
}

/** A receipt's date can stand in for "bought today" only when it is recent and not in the future. */
function boughtOn(answer: Pick<ShelfAnswer, "boughtOn">, today: Date): Date {
  const d = toDate(answer.boughtOn);
  if (!d) return startOfDay(today);
  const ago = -daysBetween(today, d);
  return ago >= 0 && ago <= 30 ? startOfDay(d) : startOfDay(today);
}

/** Where a thing is kept: what the photo showed, else where that kind of food usually lives. Frozen food is in the freezer. */
export function placeFor(category: Category, seen: unknown): Place {
  if (category === "frozen") return "freezer";
  return isPlace(seen) ? seen : USUAL_PLACE[category];
}

/** The reading, as items to check: a believable printed date, else a guess that says it is one. */
export function toDrafts(answer: ShelfAnswer, today: Date): Draft[] {
  const from = boughtOn(answer, today);
  return answer.items
    .map((line): Draft | null => {
      const name = (line.name ?? "").trim();
      if (!name) return null;
      const category: Category = isCategory(line.category) ? line.category : "other";
      const where = placeFor(category, line.where);
      const printed = plausiblePrinted(toDate(line.bestBefore), today);
      const amount = (line.amount ?? "").trim();
      return {
        name,
        expires: printed ?? guessExpiry(category, where, from),
        guessed: printed === null,
        category,
        where,
        ...(amount ? { amount } : {}),
      };
    })
    .filter((d): d is Draft => d !== null);
}

/** A row the person checked (or typed): saved as it is, with a guessed date when they left it empty. */
export function finishRow(row: Record<string, unknown>, today: Date): Draft | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const category: Category = isCategory(row.category) ? row.category : "other";
  const where = placeFor(category, row.where);
  const given = toDate(row.expires);
  const amount = typeof row.amount === "string" ? row.amount.trim() : "";
  return {
    name,
    expires: given ? startOfDay(given) : guessExpiry(category, where, today),
    guessed: given ? row.guessed === true : true,
    category,
    where,
    ...(amount ? { amount } : {}),
  };
}
