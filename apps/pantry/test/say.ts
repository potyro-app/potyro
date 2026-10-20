// `ctx.t` and `ctx.format` in one language, as the host gives them to a trusted app — enough of ctx
// for the app's words.
import { IntlMessageFormat } from "intl-messageformat";
import { word, type Ctx } from "potyro";
import type { Say } from "../words.js";

export const LANGUAGES = ["en", "pt-BR", "de", "es", "pl", "it"];

export function sayIn(language: string): Say & { locale: string } {
  const app = { language: "en", languages: LANGUAGES };
  const locale = language === "en" ? "en-GB" : language;
  return {
    locale: language,
    t: (w, vars) => {
      const s = word(w, language, app);
      if (!vars) return s;
      const out = new IntlMessageFormat(s, language).format(vars);
      return Array.isArray(out) ? out.join("") : String(out);
    },
    format: {
      locale,
      number: (n, o) => new Intl.NumberFormat(locale, o).format(n),
      date: (d, o) => new Intl.DateTimeFormat(locale, o).format(new Date(d)),
      list: (items, o) => new Intl.ListFormat(locale, { type: o?.type ?? "conjunction" }).format(items),
    } as Ctx["format"],
  };
}
