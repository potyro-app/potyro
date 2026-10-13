import { test, expect, type Locator, type Page } from "@playwright/test";
import { SEED_NAMES, openApp, openHome, openSwitcher, seed } from "./launcher/fixture.js";

// Potyro in the person's language (#298): the device picks it, the You panel switches it live, and
// the pseudo-language proves which text went through a catalog.
//
// THE GUARD. In the pseudo-language every catalog message is accented, bracketed and padded, so any
// run of plain ASCII letters on an extracted surface is a string that skipped the catalog. The
// surfaces covered are the ones extracted so far — the launcher (home and switcher, a tile's menu)
// and the You panel — and #299 widens this list as each batch lands. What is not language is
// allowed by name: app names (the person's own words), people's names, `code`, `translate="no"`.

const PSEUDO = "en-XA";

/** Where the person's own words are, not Potyro's: app names and the monograms made from them, people. */
const NOT_OURS = [
  ".k-launch-name",
  ".k-launch-avatar",
  ".k-launch-face",
  ".k-tile-menu-title",
  ".k-identity-name",
  ".k-identity-avatar",
  "code",
  ".k-passphrase",
  "[translate=no]",
].join(", ");

/** Every plain-English word visible inside `scope`, in text or in what is read aloud. */
async function englishIn(scope: Locator): Promise<string[]> {
  return scope.evaluate(
    (root, { notOurs, seeded }) => {
      // Names also appear INSIDE messages ("Actions for Recipes", "Polski (draft)"): the bundled
      // examples' as well as the seeded ones, and each language's own name for itself — so they are
      // read off the page rather than listed here.
      const names = [...seeded, ...[...document.querySelectorAll(".k-launch-name, [translate=no]")].map((n) => n.textContent?.trim() ?? "")]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      const strip = (s: string): string => {
        let out = s.replace(/\bPotyro\b/g, "");
        for (const n of names) out = out.split(n).join("");
        return out;
      };
      const english = (s: string): boolean => /[A-Za-z]{2,}/.test(strip(s));
      const leaks: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest(notOurs) || !el.checkVisibility()) continue;
        if (english(n.textContent ?? "")) leaks.push(`text: ${n.textContent!.trim()}`);
      }
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (!(el as HTMLElement).checkVisibility?.() || el.closest(notOurs)) continue;
        for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
          const v = el.getAttribute(attr);
          if (v && english(v)) leaks.push(`${attr}: ${v}`);
        }
      }
      return leaks;
    },
    { notOurs: NOT_OURS, seeded: [...SEED_NAMES] },
  );
}

async function settled(scope: Locator): Promise<void> {
  await scope.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

async function openYou(page: Page): Promise<Locator> {
  await page.locator(".k-launch-you").first().click();
  const panel = page.locator(".k-identity");
  await expect(panel).toBeVisible();
  await settled(panel);
  return panel;
}

test.describe("device language", () => {
  test.use({ locale: "pl-PL" });

  test("a Polish device opens in Polish; an empty catalog reads in English, message by message", async ({ page }) => {
    await seed(page);
    const home = await openHome(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    // Polish has no translations yet, so every message falls back to English rather than its id.
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", "Find an app");

    const panel = await openYou(page);
    // Following the device is the choice made, and it says which language that is.
    const auto = panel.getByRole("radio", { name: /Match this device/ });
    await expect(auto).toHaveAttribute("aria-checked", "true");
    await expect(auto).toContainText("Polski");
    await expect(panel.getByRole("radio", { name: /^Polski \(draft\)/ })).toBeVisible();
    await expect(panel.getByRole("radio", { name: /^English/ })).not.toContainText("draft");
    expect(await page.evaluate(() => localStorage.getItem("potyro:locale"))).toBeNull();
  });
});

test.describe("switching", () => {
  test("picking the pseudo-language changes the launcher and the You panel live, and is remembered", async ({ page }) => {
    await seed(page);
    const home = await openHome(page);
    // A marker on the page itself: it survives a re-render and dies with a reload.
    await page.evaluate(() => ((window as unknown as { __stillHere: boolean }).__stillHere = true));

    const panel = await openYou(page);
    await expect(panel.getByRole("heading", { name: "Language" })).toBeVisible();
    await panel.getByRole("radio", { name: /Ƥšéûðö/ }).click();

    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(/^⟦Ýöû ·+⟧$/);
    await expect(panel.getByRole("radio", { name: /Ƥšéûðö/ })).toHaveAttribute("aria-checked", "true");
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", /^⟦Ƒîñð åñ åþþ ·+⟧$/);
    expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("potyro:locale"))).toBe(PSEUDO);

    // And back, without leaving.
    await panel.getByRole("radio", { name: /^English/ }).click();
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("You");
    await page.reload();
    await expect(page.locator(".k-launcher-home").getByRole("searchbox")).toHaveAttribute("placeholder", "Find an app");
  });
});

test.describe("guard: no English on extracted surfaces in the pseudo-language", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await page.addInitScript((tag) => localStorage.setItem("potyro:locale", tag), PSEUDO);
  });

  test("the home launcher, a tile's menu and the You panel", async ({ page }) => {
    const home = await openHome(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", /^⟦/);
    expect(await englishIn(home)).toEqual([]);

    await home.getByRole("button", { name: /Groceries/ }).filter({ has: page.locator(".k-launch-avatar") }).first().waitFor();
    await home.locator(".k-tile-menu-btn").first().click();
    const menu = page.locator(".k-tile-menu");
    await expect(menu).toBeVisible();
    expect(await englishIn(menu)).toEqual([]);
    await page.keyboard.press("Escape");

    const panel = await openYou(page);
    await panel.locator(".k-identity-advanced summary").click();
    expect(await englishIn(panel)).toEqual([]);
  });

  test("the switcher, from inside an app", async ({ page }) => {
    await openApp(page, "groceries", "Groceries");
    const overlay = await openSwitcher(page);
    expect(await englishIn(overlay)).toEqual([]);
  });
});
