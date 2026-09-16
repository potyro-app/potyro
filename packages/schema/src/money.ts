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

/** One person's share of `total` — the same arithmetic as {@link splitEvenly}, for one index. */
export function shareOf(total: number, people: number, index: number): number {
  return splitEvenly(total, people)[index] ?? 0;
}
