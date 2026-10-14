// Lingui's configuration, for the CLI (`pnpm i18n:extract`) and for every build that compiles the
// macros (the shell's Vite config, and the shell/views/i18n Vitest configs) — they all read THIS
// file through `build.ts`, so the extractor and the compiler can never disagree about the catalogs.
//
// One catalog per language, for shell and views together: both are Potyro's own UI, shipped in
// one bundle, and a person reads them as one product. The catalogs live here rather than in the
// shell because views must not depend on the shell (scripts/check-boundaries.mjs).
//
// `runtimeConfigModule` points the macros at `@potyro/i18n` instead of `@lingui/react`: Lingui's
// own `useLingui`/`Trans` throw outside an `I18nProvider`, and the shell renders through several
// React roots (dialogs, panels, observed renders) plus tests that render one component. Ours read
// the one global instance and re-render on a language change, provider or not.

import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";
import { LOCALES, SOURCE_LOCALE } from "./src/locale.ts";

export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  locales: [...LOCALES],
  // No fallback chain between languages. A message a language lacks compiles to its English source
  // (that is what `sourceLocale` does for an empty msgstr), and the runtime lays every catalog over
  // English as well (`withFallback` in src/i18n.ts), so a gap reads in English, never as a hash.
  fallbackLocales: false,
  catalogs: [
    {
      path: "<rootDir>/locales/{locale}/messages",
      include: ["<rootDir>/../shell/src", "<rootDir>/../views/src"],
      exclude: ["**/node_modules/**"],
    },
  ],
  // Origins without line numbers: where a message is used helps a translator, but a line number
  // changes on every unrelated edit above it and would churn all six catalogs.
  format: formatter({ lineNumbers: false }),
  orderBy: "message",
  runtimeConfigModule: {
    i18n: ["@potyro/i18n", "i18n"],
    Trans: ["@potyro/i18n", "Trans"],
    useLingui: ["@potyro/i18n", "useLingui"],
  },
});
