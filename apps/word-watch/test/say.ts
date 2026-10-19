// `ctx.t` and `ctx.format` in one language, as the host gives them to a trusted app — enough of ctx
// for the app's words.
import { readFileSync } from "node:fs";
import { compileCatalog } from "@potyro/i18n/app-catalogs";
import { IntlMessageFormat } from "intl-messageformat";
import { word, type Ctx } from "potyro";
import type { Say } from "../words.js";

export const LANGUAGES = ["en", "pt-BR", "de", "es", "pl", "it"];

export function sayIn(language: string): Say & { locale: string } {
  const app = { language: "en", languages: LANGUAGES };
  const locale = language === "en" ? "en-GB" : language;
  // The app's words in that language: its catalog, as the host passes it (docs/30).
  const catalog = language === "en" ? undefined : compileCatalog(readFileSync(new URL(`../locales/${language}.po`, import.meta.url), "utf8"));
  return {
    locale: language,
    t: (w, vars) => {
      const s = word(w, language, app, catalog);
      if (!vars) return s;
      const out = new IntlMessageFormat(s, language).format(vars);
      return Array.isArray(out) ? out.join("") : String(out);
    },
    format: {
      locale,
      number: (n, o) => new Intl.NumberFormat(locale, o).format(n),
      date: (d, o) => new Intl.DateTimeFormat(locale, o).format(new Date(d)),
      list: (items, o) => new Intl.ListFormat(locale, { type: o?.type ?? "conjunction" }).format(items),
      money: (minor: number, currency = "EUR") => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100),
    } as Ctx["format"],
  };
}
