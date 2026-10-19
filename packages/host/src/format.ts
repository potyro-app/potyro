// `ctx.locale`, `ctx.t` and `ctx.format` (#302, docs/20 §2) — the one implementation both runners
// use. A person's own app calls these directly; a shared app in the sealed box (which has no `Intl`)
// reaches them through `__hostPure`, and `hostPure` below is what answers it. Same code, so a date
// reads the same at both provenances (the parity test holds that).
//
// ICU messages (`ctx.t(words, vars)`, plurals) need a run-time formatter, because app messages
// arrive at run time, not at build time. That is `intl-messageformat` (FormatJS): it INTERPRETS the
// parsed message — no `new Function`, no generated code — which is what makes it safe to run on
// words a stranger's app sends to the host. It is loaded lazily (`loadMessageFormat`) when an app
// is loaded, so the shell's first screen does not carry it.

import type { Catalog, Ctx, CtxFormat, FormatDateOptions, FormatNumberOptions, Language, Words } from "potyro";
import { isContextWords, isWordsMap, minorDigits, word } from "potyro";

type MessageFormatCtor = typeof import("intl-messageformat").IntlMessageFormat;
let MessageFormat: MessageFormatCtor | null = null;
let loading: Promise<void> | null = null;

/** Load the ICU formatter once. The hosts await it in `load`, so it is there before any app code runs. */
export function loadMessageFormat(): Promise<void> {
  loading ??= import("intl-messageformat").then(
    (m) => void (MessageFormat = m.IntlMessageFormat),
    (e: unknown) => {
      loading = null; // offline with the chunk missing: the next load tries again
      console.warn("[potyro] the message formatter did not load:", e);
    },
  );
  return loading;
}

// ── caches: building an Intl formatter costs far more than using one ──────────────────────────

const MAX_CACHED = 256;
const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  const made = make();
  cache.set(key, made);
  return made;
}

// ── the allow-list: what an app may ask a formatter for (the box sends nothing else) ─────────

const DATE_OPTIONS: Record<keyof FormatDateOptions, readonly string[]> = {
  dateStyle: ["full", "long", "medium", "short"],
  timeStyle: ["short", "medium"],
  weekday: ["long", "short"],
  day: ["numeric", "2-digit"],
  month: ["long", "short", "numeric"],
  year: ["numeric", "2-digit"],
  hour: ["numeric", "2-digit"],
  minute: ["2-digit"],
};
const RELATIVE_UNITS = ["minute", "hour", "day", "week", "month", "year"] as const;
type RelativeUnit = (typeof RELATIVE_UNITS)[number];

/** Limits on one request, so a formatter call cannot be made into a way to burn the host's time. */
export const FORMAT_LIMITS = { listItems: 1000, chars: 10_000, vars: 100 } as const;

class FormatError extends Error {}

function text(value: unknown, what: string): string {
  const s = String(value ?? "");
  if (s.length > FORMAT_LIMITS.chars) throw new FormatError(`${what} is longer than ${FORMAT_LIMITS.chars} characters`);
  return s;
}

function dateOptions(opts: unknown): Intl.DateTimeFormatOptions {
  const out: Record<string, string> = {};
  if (opts != null && typeof opts === "object") {
    for (const [key, allowed] of Object.entries(DATE_OPTIONS)) {
      const v = (opts as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string" || !allowed.includes(v)) throw new FormatError(`ctx.format.date: ${key} must be one of ${allowed.join(", ")}`);
      out[key] = v;
    }
  }
  // dateStyle/timeStyle cannot be mixed with the parts in Intl; the parts win, as most specific.
  const parts = ["weekday", "day", "month", "year", "hour", "minute"].some((k) => k in out);
  if (parts) {
    delete out.dateStyle;
    delete out.timeStyle;
  }
  return Object.keys(out).length ? out : { dateStyle: "medium" };
}

function fractionDigits(v: unknown, key: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 20) throw new FormatError(`ctx.format.number: ${key} must be a whole number from 0 to 20`);
  return v;
}

function numberOptions(opts: unknown): Intl.NumberFormatOptions {
  if (opts == null || typeof opts !== "object") return {};
  const o = opts as FormatNumberOptions;
  const out: Intl.NumberFormatOptions = {};
  if (o.style !== undefined) {
    if (!["decimal", "percent", "unit"].includes(o.style)) throw new FormatError("ctx.format.number: style must be decimal, percent or unit");
    out.style = o.style;
  }
  if (o.unit !== undefined) out.unit = text(o.unit, "unit").slice(0, 64);
  if (out.style === "unit" && !out.unit) throw new FormatError('ctx.format.number: style "unit" needs a unit, like "kilogram"');
  const min = fractionDigits(o.minimumFractionDigits, "minimumFractionDigits");
  const max = fractionDigits(o.maximumFractionDigits, "maximumFractionDigits");
  if (min !== undefined) out.minimumFractionDigits = min;
  if (max !== undefined) out.maximumFractionDigits = Math.max(max, min ?? 0);
  if (o.signDisplay !== undefined) {
    if (!["auto", "always", "exceptZero"].includes(o.signDisplay)) throw new FormatError("ctx.format.number: signDisplay must be auto, always or exceptZero");
    out.signDisplay = o.signDisplay;
  }
  return out;
}

function toDate(d: unknown): Date {
  const date = d instanceof Date ? d : new Date(typeof d === "number" || typeof d === "string" ? d : NaN);
  if (Number.isNaN(date.getTime())) throw new FormatError("ctx.format: not a date");
  return date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNIT_MS: Record<RelativeUnit, number> = { minute: MINUTE, hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

/** The unit a person would say: minutes under an hour, hours under a day, days under a week… */
function unitFor(ms: number): RelativeUnit {
  const abs = Math.abs(ms);
  if (abs < HOUR) return "minute";
  if (abs < DAY) return "hour";
  if (abs < 7 * DAY) return "day";
  if (abs < 30 * DAY) return "week";
  if (abs < 365 * DAY) return "month";
  return "year";
}

// ── the formatter ──────────────────────────────────────────────────────────────────────────────

const baseOf = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/**
 * The locale formats are made in (docs/20 §2.2): the person's own when it speaks the language the
 * words are in ("en-GB" for an English app → 13/10/2026), otherwise the words' language — a Pole
 * reading an English-only app reads "Oct 13" inside an English sentence, not "13 paź".
 */
export function formatLocaleFor(personLocale: string | undefined, wordsLanguage: Language | undefined): string {
  const person = personLocale && isLocale(personLocale) ? personLocale : undefined;
  if (!wordsLanguage) return person ?? "en";
  if (person && baseOf(person) === baseOf(wordsLanguage)) return person;
  return wordsLanguage;
}

function isLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/** Format an ICU message. Throws a readable error for a malformed one — the app's bug, contained like any other. */
export function formatMessage(message: string, vars: Record<string, unknown>, locale: string): string {
  if (!MessageFormat) {
    void loadMessageFormat();
    // Only before the formatter has arrived (a ctx built without a load): plain `{name}` holes.
    return message.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
  }
  const Ctor = MessageFormat;
  const format = cached(`m|${locale}|${message}`, () => {
    try {
      return new Ctor(message, locale);
    } catch (e) {
      throw new FormatError(`ctx.t: "${message.slice(0, 80)}" is not a message I can read: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const out = format.format(vars as Record<string, string | number | Date>);
  return Array.isArray(out) ? out.join("") : String(out);
}

export interface WordsContext {
  /** The language the app's words are shown in (`ctx.locale`). */
  language: Language;
  /** The app's own language and languages, for the fallbacks of `word()`. */
  app: { language?: Language; languages?: Language[] };
  /** The BCP 47 tag dates and numbers are formatted in (`ctx.format.locale`). */
  formatLocale: string;
  /** `ctx.now()` — `relative` measures from it, so it is fixed within a pass. */
  now: () => Date;
  /**
   * The app's translations for `language` (docs/30). Only the sealed box passes it: there `app` is not
   * the definition, so the catalog cannot be found through it.
   */
  catalog?: Catalog;
}

/** `ctx.t`: the words for the language, an ICU message when `vars` are given. */
export function translate(w: Words, vars: Record<string, unknown> | undefined, wc: WordsContext): string {
  const chosen = word(w, wc.language, wc.app, wc.catalog);
  if (vars == null) return chosen;
  return formatMessage(text(chosen, "a message"), vars, wc.formatLocale);
}

/** `ctx.format`, in one locale, measuring `relative` from `now`. */
export function makeFormat(locale: string, now: () => Date): CtxFormat {
  return {
    locale,
    date(d, opts) {
      const o = dateOptions(opts);
      return cached(`d|${locale}|${JSON.stringify(o)}`, () => new Intl.DateTimeFormat(locale, o)).format(toDate(d));
    },
    number(n, opts) {
      const o = numberOptions(opts);
      const key = `n|${locale}|${JSON.stringify(o)}`;
      let f: Intl.NumberFormat;
      try {
        f = cached(key, () => new Intl.NumberFormat(locale, o));
      } catch (e) {
        throw new FormatError(`ctx.format.number: ${e instanceof Error ? e.message : String(e)}`);
      }
      return f.format(Number(n));
    },
    money(minor, currency = "EUR") {
      const code = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : "EUR";
      const digits = minorDigits(code);
      const f = cached(`c|${locale}|${code}`, () => new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: digits }));
      return f.format(Number(minor) / 10 ** digits);
    },
    relative(d, opts) {
      const ms = toDate(d).getTime() - now().getTime();
      const unit = opts?.unit ?? unitFor(ms);
      if (!RELATIVE_UNITS.includes(unit)) throw new FormatError(`ctx.format.relative: unit must be one of ${RELATIVE_UNITS.join(", ")}`);
      const numeric = opts?.numeric === "always" ? "always" : "auto";
      const f = cached(`r|${locale}|${numeric}`, () => new Intl.RelativeTimeFormat(locale, { numeric }));
      return f.format(Math.round(ms / UNIT_MS[unit]), unit);
    },
    list(items, opts) {
      if (!Array.isArray(items)) throw new FormatError("ctx.format.list takes an array of strings");
      if (items.length > FORMAT_LIMITS.listItems) throw new FormatError(`ctx.format.list: more than ${FORMAT_LIMITS.listItems} items`);
      const type = opts?.type === "disjunction" ? "disjunction" : "conjunction";
      const f = cached(`l|${locale}|${type}`, () => new Intl.ListFormat(locale, { type }));
      return f.format(items.map((i) => text(i, "a list item")));
    },
  };
}

// ── the sealed box's way in: one synchronous, authority-free call ─────────────────────────────

function checkWordsArg(w: unknown): Words {
  if (typeof w === "string") return text(w, "a message");
  if (isContextWords(w)) return { text: text(w.text, "a message"), context: text(w.context, "a context") };
  if (!isWordsMap(w)) throw new FormatError("ctx.t takes words: text, { text, context }, or a map of languages to text");
  const entries = Object.entries(w);
  if (entries.length > FORMAT_LIMITS.vars) throw new FormatError("ctx.t: too many languages in one map");
  for (const [, v] of entries) text(v, "a message");
  return w as Words;
}

function checkVars(vars: unknown): Record<string, unknown> {
  if (vars == null || typeof vars !== "object" || Array.isArray(vars)) throw new FormatError("ctx.t: vars must be an object of names to values");
  const entries = Object.entries(vars);
  if (entries.length > FORMAT_LIMITS.vars) throw new FormatError(`ctx.t: more than ${FORMAT_LIMITS.vars} vars`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = typeof v === "number" || v instanceof Date ? v : text(v, `the var "${k}"`);
  return out;
}

/** What `__hostPure` may ask for. Anything else is refused before any formatter runs. */
export const PURE_OPS = ["date", "number", "money", "relative", "list", "t"] as const;

/** The answer's first character: what follows is the formatted text, or why there is none. Printable
 *  on purpose — a NUL would end the string on its way into the box. */
export const PURE_OK = "+";
export const PURE_ERROR = "!";

/** A date crosses as `{ __kdate: iso }` (the marshal's tag); anything else as it is. */
const revive = (v: unknown): unknown =>
  v != null && typeof v === "object" && typeof (v as { __kdate?: unknown }).__kdate === "string" ? new Date((v as { __kdate: string }).__kdate) : v;

/**
 * Answer one `__hostPure` request from the box: plain JSON in (no reviver, it costs), and the text
 * out after one marker character — `PURE_OK` and the formatted string, or `PURE_ERROR` and why — so
 * the box parses nothing. It touches no store, no capability and no person — only `Intl` and the
 * ICU formatter over the arguments it is handed — which is why it may be synchronous. The locale is
 * the host's, never the app's: the request carries none.
 */
export function hostPure(json: string, ctx: Pick<Ctx, "t" | "format">): string {
  const format = ctx.format;
  try {
    if (json.length > FORMAT_LIMITS.chars * 4) throw new FormatError("the request is too large");
    const req = JSON.parse(json) as Record<string, unknown> | null;
    if (req == null || typeof req !== "object") throw new FormatError("not a request");
    req.value = revive(req.value);
    if (req.vars && typeof req.vars === "object") for (const [k, v] of Object.entries(req.vars)) (req.vars as Record<string, unknown>)[k] = revive(v);
    const op = req.op as string;
    let value: string;
    switch (op) {
      case "date":
        value = format.date(req.value as Date, req.opts as FormatDateOptions | undefined);
        break;
      case "number":
        if (typeof req.value !== "number") throw new FormatError("ctx.format.number takes a number");
        value = format.number(req.value, req.opts as FormatNumberOptions | undefined);
        break;
      case "money":
        if (typeof req.value !== "number") throw new FormatError("ctx.format.money takes whole minor units, a number");
        value = format.money(req.value, req.currency == null ? undefined : text(req.currency, "currency"));
        break;
      case "relative": {
        const o = (req.opts ?? {}) as { unit?: RelativeUnit; numeric?: "auto" | "always" };
        value = format.relative(req.value as Date, { unit: o.unit, numeric: o.numeric });
        break;
      }
      case "list": {
        const o = (req.opts ?? {}) as { type?: "conjunction" | "disjunction" };
        value = format.list(req.value as string[], { type: o.type });
        break;
      }
      case "t":
        // No vars: a plain string looked up in the app's catalog (docs/30).
        value = ctx.t(checkWordsArg(req.words), req.vars == null ? undefined : (checkVars(req.vars) as Record<string, string | number | Date>));
        break;
      default:
        throw new FormatError(`unknown request ${JSON.stringify(String(op)).slice(0, 40)}`);
    }
    return PURE_OK + value;
  } catch (e) {
    return PURE_ERROR + (e instanceof Error ? e.message : String(e));
  }
}
