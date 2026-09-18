// Money, in whole minor units (KA-26).
//
// An amount is an INTEGER of cents — 4200 is €42.00 — and never a float. `0.1 + 0.2` is not `0.3`,
// and in a shared ledger that difference is written into the document and merged: two people's
// copies drift apart by a rounding error nobody can find afterwards. Integers cannot drift.
//
// The currency decides how many minor digits there are. A yen has none, so `5` is ¥5, not ¥0.05 —
// which is why nothing here divides by a hard-coded 100.

/** Minor digits for an ISO 4217 code, from the runtime's own currency data. */
export function minorDigits(currency: string): number {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions();
    return parts.maximumFractionDigits ?? 2;
  } catch {
    return 2; // an unknown code: behave like the common case rather than throw at render time
  }
}

/** `4200` -> `"€42.00"`, written the way the reader's own device writes money. */
export function formatMoney(minorUnits: number, currency = "EUR", locale?: string): string {
  const digits = minorDigits(currency);
  const value = minorUnits / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** What a person typed (`"42.00"`, `"42,00"`, `"1 234.5"`) as whole minor units, or `null`. */
export function parseMoney(typed: string, currency = "EUR"): number | null {
  const cleaned = typed.replace(/[\s\u00a0]/g, "").replace(/,/g, ".");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // Rounded, not truncated, and only once: the string is the only float this ever sees.
  return Math.round(value * 10 ** minorDigits(currency));
}

/**
 * Split `total` between `people`, to the minor unit, with the remainder handed out one each.
 *
 * Everyone's copy must agree on who pays the extra cent, so the order is the caller's and the
 * result is deterministic — never `total / n` rounded independently on each device, which is how
 * three people paying for a €10.00 dinner end up owing €10.01 between them.
 */
export function splitEvenly(total: number, people: number): number[] {
  if (!Number.isInteger(total) || !Number.isInteger(people) || people <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(total);
  const each = Math.floor(amount / people);
  const remainder = amount - each * people;
  return Array.from({ length: people }, (_, i) => sign * (each + (i < remainder ? 1 : 0)));
}

/**
 * Split `total` by `weights` — two shares for the couple sharing a room, one each for the rest.
 *
 * Largest remainder, ties broken by order, for the same reason {@link splitEvenly} hands its
 * remainder out in the caller's: every copy of a shared ledger must land on the same cents. Compute
 * each share independently and three devices can disagree about a bill by a cent each, permanently.
 *
 * A weight that is not a positive number counts as zero, and all-zero weights split nothing — a
 * split nobody is in is not an error, it is an expense still being filled in.
 */
export function splitByShares(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total)) return [];
  const w = weights.map((x) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  if (sum <= 0) return w.map(() => 0);

  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(total);
  const exact = w.map((x) => (amount * x) / sum);
  const out = exact.map(Math.floor);
  let left = amount - out.reduce((s, x) => s + x, 0);
  // Whoever is furthest short of their exact share takes the next unit; ties go to the earlier one.
  const order = exact
    .map((e, i) => ({ i, under: e - out[i]! }))
    .sort((a, b) => b.under - a.under || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out.map((x) => sign * x);
}

/** One person's share of `total` — the same arithmetic as {@link splitEvenly}, for one index. */
export function shareOf(total: number, people: number, index: number): number {
  return splitEvenly(total, people)[index] ?? 0;
}
