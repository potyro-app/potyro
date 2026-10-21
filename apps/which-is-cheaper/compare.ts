// The arithmetic of "which is cheaper", in plain functions: a price (whole minor units, KA-26) over an
// amount in a unit becomes a price per base unit (a gram, a millilitre, a piece); items of one kind
// compare; the cheapest wins by a percentage against the runner-up. No screen, no ctx — tests read it.

export const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
export type Unit = (typeof UNITS)[number];

/** What a unit measures, so grams compare with kilograms and never with litres. */
export type Kind = "weight" | "volume" | "count";

/** How many base units (g, ml, pcs) one of this unit is. */
const BASE: Record<Unit, number> = { g: 1, kg: 1000, ml: 1, l: 1000, pcs: 1 };
export const KIND: Record<Unit, Kind> = { g: "weight", kg: "weight", ml: "volume", l: "volume", pcs: "count" };

/** What a price is shown "per": 100 g, 100 ml, or a piece. */
export const SHOWN_PER: Record<Kind, { amount: number; unit: Unit }> = {
  weight: { amount: 100, unit: "g" },
  volume: { amount: 100, unit: "ml" },
  count: { amount: 1, unit: "pcs" },
};

export interface Item {
  name?: string;
  /** Whole minor units: €4.99 is 499. */
  price: number | null;
  amount: number | null;
  unit: Unit;
}

export type Priced = Item & { price: number; amount: number };

/** An item that can be priced: a price and an amount above zero. */
export function complete(i: Item): i is Priced {
  return typeof i.price === "number" && i.price >= 0 && typeof i.amount === "number" && i.amount > 0 && Number.isFinite(i.amount);
}

/** Minor units per ONE base unit (a gram, a millilitre, a piece), unrounded. */
export function perBase(i: Priced): number {
  return i.price / (i.amount * BASE[i.unit]);
}

/** Minor units per the shown amount (100 g, 100 ml, a piece), rounded to whole minor units. */
export function perShown(i: Priced): number {
  return Math.round(perBase(i) * SHOWN_PER[KIND[i.unit]].amount);
}

export interface Verdict {
  /** Indexes of the complete items, cheapest first. */
  order: number[];
  /** The cheapest complete item, or null when fewer than two are complete or they are of different kinds. */
  winner: number | null;
  /** How much cheaper the winner is than the runner-up, whole percent; 0 when the same. */
  saving: number;
  /** Why there is no winner. */
  reason?: "incomplete" | "kinds";
}

/** "Same price" when within half a percent of each other. */
const SAME_WITHIN = 0.005;

export function compare(items: Item[]): Verdict {
  const done: Array<{ i: Priced; at: number }> = [];
  items.forEach((i, at) => {
    if (complete(i)) done.push({ i, at });
  });
  if (done.length < 2) return { order: done.map((d) => d.at), winner: null, saving: 0, reason: "incomplete" };
  const kinds = new Set(done.map((d) => KIND[d.i.unit]));
  if (kinds.size > 1) return { order: done.map((d) => d.at), winner: null, saving: 0, reason: "kinds" };
  const ranked = [...done].sort((a, b) => perBase(a.i) - perBase(b.i));
  const first = perBase(ranked[0]!.i);
  const second = perBase(ranked[1]!.i);
  const same = second === 0 || Math.abs(second - first) / second < SAME_WITHIN;
  const saving = same ? 0 : Math.round(((second - first) / second) * 100);
  return { order: ranked.map((r) => r.at), winner: ranked[0]!.at, saving };
}

/** "4,99" or "4.99" as a person types it → whole minor units, or null. Accepts a comma or a dot. */
export function parseMoney(text: string, minorDigits = 2): number | null {
  const s = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10 ** minorDigits);
}

/** "1,5" or "500" → a number above zero, or null. */
export function parseAmount(text: string): number | null {
  const s = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The currencies offered, and the one a locale most likely shops in. */
export const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "PLN", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function currencyFor(locale: string): Currency {
  const region = /-([A-Z]{2})\b/.exec(locale)?.[1] ?? "";
  if (region === "US") return "USD";
  if (region === "GB") return "GBP";
  if (region === "BR") return "BRL";
  if (region === "PL") return "PLN";
  if (region === "CH") return "CHF";
  return "EUR";
}
