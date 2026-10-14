// @potyro/i18n — Potyro's own words in the person's language (#297, #298).
//
// For code in shell and views:
//   import { t } from "@lingui/core/macro";            // a string outside a component
//   import { Trans, useLingui } from "@lingui/react/macro"; // in a component — re-renders on a switch
//   import { fmt } from "@potyro/i18n";                  // dates, numbers, relative times, lists
//
// The macros compile to imports from THIS package (lingui.config.ts `runtimeConfigModule`). Run
// `pnpm i18n:extract` after adding or changing a message; `test/catalog.test.ts` fails while the
// English catalog is stale.

import { i18n } from "./i18n.js";
import { accent } from "./accent.js";
import { PSEUDO_LOCALE, intlLocale } from "./locale.js";
import { formatDate, formatDateRange, formatList, formatNumber, formatRelativeDays, formatRelativeTime, type DateInput } from "./format.js";

export {
  i18n,
  LOCALE_KEY,
  currentDeviceLocale,
  deviceLanguages,
  initialLocale,
  isPseudoAvailable,
  savedLocale,
  setLocale,
  setPseudoAvailable,
  setSystemLanguages,
  startI18n,
  withFallback,
  resetI18nForTests,
} from "./i18n.js";
export { Trans, useLingui, useLocale } from "./react.js";
export {
  LOCALES,
  LOCALE_INFO,
  PSEUDO_LOCALE,
  SOURCE_LOCALE,
  deviceLocale,
  intlLocale,
  matchLocale,
  normalizeTag,
  resolveLocale,
  type AppLocale,
  type DeviceLanguages,
  type LocaleInfo,
} from "./locale.js";
export { formatDate, formatDateRange, formatList, formatNumber, formatRelativeDays, formatRelativeTime, type DateInput } from "./format.js";

/** In the pseudo-language, what went through these helpers is accented too — so a raw `toLocaleString()` is not. */
const marked = (s: string): string => (i18n.locale === PSEUDO_LOCALE ? accent(s) : s);

/**
 * The format helpers in the active language. Read at call time, so a component that re-renders on
 * a switch (it uses `useLingui`) formats in the new language.
 */
export const fmt = {
  date: (value: DateInput, options?: Intl.DateTimeFormatOptions): string => marked(formatDate(i18n.locale, value, options)),
  dateRange: (from: DateInput, to: DateInput, options?: Intl.DateTimeFormatOptions): string => marked(formatDateRange(i18n.locale, from, to, options)),
  number: (value: number, options?: Intl.NumberFormatOptions): string => marked(formatNumber(i18n.locale, value, options)),
  relative: (value: DateInput, now?: DateInput, options?: Intl.RelativeTimeFormatOptions): string =>
    marked(formatRelativeTime(i18n.locale, value, now, options)),
  /** Whole days from today: "today", "yesterday", "in 3 days" (`numeric: "auto"`). */
  days: (days: number): string => marked(formatRelativeDays(i18n.locale, days)),
  list: (items: readonly string[], options?: Intl.ListFormatOptions): string => marked(formatList(i18n.locale, items, options)),
  /** A language's name in the active language ("Polish", "polski", "Polnisch"); the tag itself where `Intl` cannot say. */
  language: (tag: string): string => {
    try {
      return marked(new Intl.DisplayNames([intlLocale(i18n.locale)], { type: "language" }).of(tag) ?? tag);
    } catch {
      return tag;
    }
  },
};
