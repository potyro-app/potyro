// The values a field actually holds, for a filter that offers "what is in my data".
//
// A filter chip whose `from` names an enum reads its choices off the definition. A field with no
// declared options — a country typed as text, a year, free tags — has no such list, and the chip
// used to come up with nothing to choose. Its choices are the records' own values instead.
//
// Pure and synchronous: the caller already has the rows (the same query a record chip runs).

/** A value a chip can offer: what the record holds, unchanged, so the app's `filter` compares it
 *  to the field with `===` or `includes` exactly as it would an enum's option. */
export type OfferedValue = string | number;

/** More choices than this is a search box's job, not a sheet of chips; the most used are kept. */
export const DISTINCT_VALUES_CAP = 50;

/** A value longer than this is prose, not a category: a chip of it could not be read anyway. */
const LONGEST_VALUE = 80;

/** The field types whose stored values read as choices. */
const VALUE_TYPES = new Set(["text", "url", "number", "tags"]);

/** Does a filter on this field take its choices from the records (it declares none of its own)? */
export function offersRecordValues(field: { type?: string; options?: readonly string[] } | null | undefined): boolean {
  if (!field || !VALUE_TYPES.has(field.type ?? "")) return false;
  return !field.options?.length;
}

function offered(value: unknown): value is OfferedValue {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && value.length <= LONGEST_VALUE;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function inOrder(a: OfferedValue, b: OfferedValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The distinct values of `field` across `rows`, sorted, empty ones left out.
 *
 * A list-valued field (tags) offers each of its entries. Over the cap, the values the most records
 * hold are the ones kept — the long tail of one-offs is what a filter is least useful for.
 */
export function distinctValues(
  rows: readonly Readonly<Record<string, unknown>>[],
  field: string,
  cap: number = DISTINCT_VALUES_CAP,
): OfferedValue[] {
  const counts = new Map<OfferedValue, number>();
  for (const row of rows) {
    const held = row[field];
    // Once per record, however often a list repeats an entry.
    const entries = new Set<unknown>(Array.isArray(held) ? held : [held]);
    for (const value of entries) {
      if (offered(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const values = [...counts.keys()].sort(inOrder);
  if (values.length <= cap) return values;
  // Stable sort: among equally used values the earlier in reading order stays.
  const kept = [...values].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, Math.max(0, cap));
  return kept.sort(inOrder);
}

/** How two typed values are told to be the same choice: surrounding space and letter case apart. */
export function valueKey(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

/**
 * The choices a `text` field with `suggest` offers in its form (#82): what the records hold in
 * `field`, then the app's declared starting values that no record uses yet. Sorted as a filter's
 * chips are.
 *
 * "barolo", "Barolo" and " Barolo " are one choice. The spelling offered is the one the most records
 * use (the earliest record's among equals), and a record's spelling wins over a declared one, so
 * picking a choice writes exactly what a filter on the field already shows. Not capped: the control
 * narrows as the person types, and shows as many as it has room for.
 */
export function suggestedValues(
  rows: readonly Readonly<Record<string, unknown>>[],
  field: string,
  declared: readonly string[] = [],
): string[] {
  const choices = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const held = row[field];
    if (!offered(held) || typeof held !== "string") continue;
    const spelling = held.trim();
    const key = valueKey(spelling);
    const spellings = choices.get(key) ?? new Map<string, number>();
    spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1);
    choices.set(key, spellings);
  }
  const out: string[] = [];
  for (const spellings of choices.values()) {
    // Map order is first-seen order, and `>` keeps the earlier of two equally used spellings.
    let best = "";
    let most = 0;
    for (const [spelling, n] of spellings) {
      if (n > most) [best, most] = [spelling, n];
    }
    out.push(best);
  }
  for (const value of declared) {
    if (!offered(value) || typeof value !== "string") continue;
    const key = valueKey(value);
    if (choices.has(key)) continue;
    choices.set(key, new Map());
    out.push(value.trim());
  }
  return out.sort(inOrder);
}
