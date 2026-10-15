import { test, expect } from "./console-guard";
import { seed } from "./launcher/fixture.js";

// Every shipped language reads as itself (#300): choose it under You → Language and the launcher,
// the You panel and the Studio say real, translated words — not English, not a hash id. A few
// strings per surface, chosen from different catalogs' corners (a placeholder, a heading, a button,
// an accessible name), so a language whose catalog failed to load or compile cannot pass.

const LANGUAGES = [
  {
    tag: "de",
    find: "App finden",
    you: "Du",
    language: "Sprache",
    newApp: /Neue App/,
    studioHeading: "Was möchtest du machen?",
    describe: "Beschreib die App",
  },
  {
    tag: "pl",
    find: "Znajdź aplikację",
    you: "Ty",
    language: "Język",
    newApp: /Nowa aplikacja/,
    studioHeading: "Co chcesz zrobić?",
    describe: "Opisz aplikację",
  },
  {
    tag: "es",
    find: "Buscar una app",
    you: "Tú",
    language: "Idioma",
    newApp: /Nueva app/,
    studioHeading: "¿Qué te gustaría crear?",
    describe: "Describe la app",
  },
  {
    tag: "it",
    find: "Trova un’app",
    you: "Tu",
    language: "Lingua",
    newApp: /Nuova app/,
    studioHeading: "Cosa vorresti creare?",
    describe: "Descrivi l’app",
  },
  {
    tag: "pt-BR",
    find: "Encontrar um app",
    you: "Você",
    language: "Idioma",
    newApp: /Novo app/,
    studioHeading: "O que você gostaria de criar?",
    describe: "Descreva o app",
  },
] as const;

for (const lang of LANGUAGES) {
  test(`${lang.tag}: the launcher, the You panel and the Studio read in it`, async ({ page }) => {
    await seed(page);
    await page.goto("/");
    const home = page.locator(".k-launcher-home");
    await expect(home).toBeVisible();

    // Chosen the way a person chooses it, from English.
    await page.locator(".k-launch-you").first().click();
    const panel = page.locator(".k-identity");
    await panel.locator("#k-lang-select").selectOption(lang.tag);
    await expect(page.locator("html")).toHaveAttribute("lang", lang.tag);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(lang.you);
    await expect(panel.getByRole("heading", { name: lang.language })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: lang.language })).toHaveValue(lang.tag);
    // Remembered: after a reload it is still the language.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", lang.tag);
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", lang.find);

    // The Studio, opened from the launcher, in the same language.
    await page.getByRole("button", { name: lang.newApp }).first().click();
    const studio = page.locator(".k-studio");
    await expect(studio.getByRole("heading", { name: lang.studioHeading })).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByRole("textbox", { name: lang.describe })).toBeVisible();
  });
}
