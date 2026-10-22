#!/usr/bin/env node
// tokens.css, from the designer's source/potyro-tokens.css: the same file, with the one line that
// fetches the fonts from Google replaced by @font-face rules for the copies in fonts/. The shell is
// offline-first (CLAUDE.md rule 6) and the Capacitor WebView has no business calling Google, so the
// fonts ship with the app. test/tokens.test.ts fails while this is stale:  pnpm gen:tokens
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** The fonts, as DESIGN.md §3.2 names them: Quicksand 600/700 (display), Figtree 400–700 (body), DM Mono 400/500. */
export const FONT_FACES = `/* The fonts ship with the app (offline-first): Google's woff2 files, latin and latin-ext, the
   variable weight axis where the family has one. Replaces the designer's @import of Google Fonts. */
@font-face { font-family: "Quicksand"; font-style: normal; font-weight: 300 700; font-display: swap; src: url("./fonts/quicksand-latin-ext.woff2") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Quicksand"; font-style: normal; font-weight: 300 700; font-display: swap; src: url("./fonts/quicksand-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Figtree"; font-style: normal; font-weight: 300 900; font-display: swap; src: url("./fonts/figtree-latin-ext.woff2") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Figtree"; font-style: normal; font-weight: 300 900; font-display: swap; src: url("./fonts/figtree-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url("./fonts/dmmono-400-latin-ext.woff2") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url("./fonts/dmmono-400-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url("./fonts/dmmono-500-latin-ext.woff2") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url("./fonts/dmmono-500-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }`;

const IMPORT = /^@import url\("https:\/\/fonts\.googleapis\.com\/[^\n]*\n/m;

export function generate(source) {
  if (!IMPORT.test(source)) throw new Error("source/potyro-tokens.css: the Google Fonts @import line was not found");
  return source.replace(IMPORT, FONT_FACES + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(here("../tokens.css"), generate(readFileSync(here("../source/potyro-tokens.css"), "utf8")));
  console.log("tokens.css written");
}
