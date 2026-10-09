// Typing an amount of money (KA-26).
//
// The value is whole minor units — `4200` for €42.00 — and the box takes what a person actually
// writes: "42", "42.5", "42,50". Kept as TEXT while typing, because a half-written "42." is not a
// number yet and re-formatting under the cursor is how a field fights the person using it. It
// becomes an integer on every keystroke that parses, and is tidied when the field is left.

import { useEffect, useState } from "react";
import { formatMoney, minorDigits, parseMoney, type MoneyField } from "potyro";

/** The symbol for a currency, on its own — "€", "$", "¥". */
export function currencySign(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Minor units as the digits a person edits: `4200` -> `"42.00"`, `5` (JPY) -> `"5"`. */
export function editableAmount(minorUnits: number | null | undefined, currency: string): string {
  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return "";
  const digits = minorDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

export function MoneyInput({
  field,
  value,
  onChange,
  label,
}: {
  field: MoneyField;
  value: unknown;
  onChange: (v: unknown) => void;
  label?: string;
}) {
  const currency = field.currency ?? "EUR";
  const [typed, setTyped] = useState(() => editableAmount(value as number, currency));

  // Follow the value when it changes from somewhere else (a default, a rollback) — but never while
  // this field is being typed into, which would move the cursor and rewrite what was half-written.
  useEffect(() => {
    if (document.activeElement?.getAttribute?.("data-money") === field.label || typeof value !== "number") return;
    setTyped((current) => (parseMoney(current, currency) === value ? current : editableAmount(value, currency)));
  }, [value, currency, field.label]);

  return (
    <span className="k-money-input">
      <span className="k-money-sign" aria-hidden>
        {currencySign(currency)}
      </span>
      <input
        className="k-input"
        type="text"
        inputMode="decimal"
        data-money={field.label}
        aria-label={label ?? field.label}
        placeholder={field.placeholder ?? editableAmount(0, currency)}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          const parsed = parseMoney(e.target.value, currency);
          onChange(e.target.value.trim() === "" ? null : parsed);
        }}
        onBlur={() => {
          const parsed = parseMoney(typed, currency);
          setTyped(parsed == null ? "" : editableAmount(parsed, currency));
        }}
      />
    </span>
  );
}

/** An amount on screen, in the reader's own format. Tabular figures so a column lines up. */
export function MoneyValue({ field, value }: { field: MoneyField; value: unknown }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return <span className="k-money">{formatMoney(value, field.currency ?? "EUR")}</span>;
}

/**
 * Which money field a list shows down its right — the one the view names, the entity's first
 * otherwise, and none when the view says `false`.
 */
export function moneyColumn(
  runtime: { definition: { entities: Record<string, { fields: Record<string, { type: string }> }> } },
  entity: string,
  declared: string | false | undefined,
): { key: string; field: MoneyField } | null {
  if (declared === false) return null;
  const fields = runtime.definition.entities[entity]?.fields ?? {};
  if (declared) {
    const named = fields[declared];
    return named?.type === "money" ? { key: declared, field: named as MoneyField } : null;
  }
  const first = Object.entries(fields).find(([, f]) => f.type === "money");
  return first ? { key: first[0], field: first[1] as MoneyField } : null;
}

/** What the rows on screen come to. Added as integers — the whole reason money is stored this way. */
export function MoneyTotal({
  field,
  rows,
  valueKey,
  noun,
}: {
  field: MoneyField;
  rows: readonly Record<string, unknown>[];
  valueKey: string;
  /** The entity's own word, so it reads "3 expenses" rather than "3 rows". */
  noun?: string;
}) {
  const amounts = rows.map((r) => r[valueKey]).filter((v): v is number => typeof v === "number" && Number.isInteger(v));
  if (!amounts.length) return null;
  const total = amounts.reduce((sum, n) => sum + n, 0);
  const word = noun?.trim() || "row";
  return (
    <p className="k-money-total">
      <span>
        {rows.length} {rows.length === 1 ? word.toLowerCase() : plural(word).toLowerCase()}
      </span>
      <b className="k-money">{formatMoney(total, field.currency ?? "EUR")}</b>
    </p>
  );
}

/** Enough English for a count beside a noun: "expense" -> "expenses", "entry" -> "entries". */
function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}
