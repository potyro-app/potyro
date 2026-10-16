import { test, expect, type Locator, type Page } from "./console-guard";
import { SEED_NAMES, openApp, openHome, openSwitcher, seed } from "./launcher/fixture.js";

const SCREENSHOTS = process.env.I18N_SHOTS; // a folder: the guard also saves what it looked at (#299)

// Potyro in the person's language (#298): the device picks it, the You panel switches it live, and
// the pseudo-language proves which text went through a catalog.
//
// THE GUARD. In the pseudo-language every catalog message is accented, bracketed and padded, so any
// run of plain ASCII letters on a surface is a string that skipped the catalog. #299 moved every
// string of shell and views into the catalogs; the surfaces below are the main ones a person meets:
// the launcher (home, a tile's menu, the switcher), the You panel, the Studio (its conversation, a
// version's card, the preview bar), the Add an app card, a data table, a form sheet and a splash.
//
// What is not Potyro's language is allowed by what it is: app names and the app's own words (its
// entities, fields, pages and records — marked `data-k-field`, `data-k-wording`, `data-k-value`,
// `data-k-page` for edit mode, or named per test), what the person typed, people's names, `code`,
// `translate="no"`.

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
  // What a platform request would send of the app's structure: the app's names, as data.
  ".k-ask-card-structure pre",
  // The person's own words in the Studio, and the app's name on its cards and bar.
  ".k-thread-mine",
  ".k-card-name",
  ".k-card-mark",
  ".k-studio-name",
  ".k-preview-title",
  // The app's own screen inside the preview, and records in a data table.
  ".k-preview-screen",
  ".k-data-table tbody",
  ".k-datapage-app-name",
  ".k-splash-name",
  // The map library's own controls and its attribution, which names its data's makers.
  ".maplibregl-ctrl",
].join(", ");

/** The app's own words on screen, read off the markers edit mode uses — they are the app's, not ours. */
const APP_WORDS = "[data-k-field], [data-k-wording], [data-k-value], [data-k-page]";

/** Every plain-English word visible inside `scope`, in text or in what is read aloud. */
async function englishIn(scope: Locator, appWords: readonly string[] = []): Promise<string[]> {
  return scope.evaluate(
    (root, { notOurs, seeded, marked, extra }) => {
      // Names also appear INSIDE messages ("Actions for Recipes", "Polski (draft)"): the bundled
      // examples' as well as the seeded ones, and each language's own name for itself — so they are
      // read off the page rather than listed here.
      const names = [
        ...seeded,
        ...extra,
        ...[...document.querySelectorAll(`.k-launch-name, [translate=no], ${marked}`)].map((n) => n.textContent?.trim() ?? ""),
        ...[...document.querySelectorAll("option[data-autonym]")].map((o) => o.getAttribute("data-autonym") ?? ""),
      ]
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
      // A closed select draws only its chosen option, and no option is "visible" to the walk above —
      // so every option of a visible select is read, as the open list would show them.
      for (const select of root.querySelectorAll("select")) {
        if (!select.checkVisibility() || select.closest(notOurs)) continue;
        for (const o of select.options) if (english(o.text)) leaks.push(`option: ${o.text}`);
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
    { notOurs: NOT_OURS, seeded: [...SEED_NAMES], marked: APP_WORDS, extra: [...appWords] },
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

  test("a Polish device opens in Polish, and the picker says it follows the device", async ({ page }) => {
    await seed(page);
    const home = await openHome(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", "Znajdź aplikację");

    const panel = await openYou(page);
    // Following the device is the choice made, and it says which language that is.
    const picker = panel.getByRole("combobox", { name: "Język" });
    await expect(picker).toHaveValue("auto");
    await expect(picker.locator("option:checked")).toHaveText("Jak to urządzenie (Polski)");
    await expect(picker.locator('option[value="pl"]')).toHaveText("Polski (wersja robocza)");
    await expect(picker.locator('option[value="de"]')).toHaveText("Deutsch — niemiecki (wersja robocza)");
    await expect(picker.locator('option[value="en"]')).toHaveText("English — angielski");
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
    // Its label is the heading, so its name changes language with everything else; hold it by id.
    await expect(panel.getByRole("combobox", { name: "Language" })).toBeVisible();
    const picker = panel.locator("#k-lang-select");
    await expect(picker).toHaveValue("auto");
    await expect(picker.locator('option[value="en"]')).toHaveText("English");
    await expect(picker.locator('option[value="pl"]')).toHaveText("Polski — Polish (draft)");
    await picker.selectOption(PSEUDO);

    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(/^⟦Ýöû ·+⟧$/);
    await expect(picker).toHaveValue(PSEUDO);
    // The options re-render in the new language too: the name in the current language is accented.
    await expect(picker.locator('option[value="pl"]')).toHaveText(/Polski — Þöļîšĥ \(ðŕåƒţ\)/);
    await expect(home.getByRole("searchbox")).toHaveAttribute("placeholder", /^⟦Ƒîñð åñ åþþ ·+⟧$/);
    expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("potyro:locale"))).toBe(PSEUDO);

    // And back, without leaving.
    await picker.selectOption("en");
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

    // A sealed app's menu: it has every item a trusted one has, plus "Let it run as yours".
    await home.getByRole("button", { name: /Gym log/ }).and(home.locator(".k-tile-menu-btn")).click();
    const menu = page.locator(".k-tile-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="promote"]')).toBeVisible();
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

// ---- #299: the Studio, Add an app, a data table, a form sheet and a splash ----------------------

/** A tiny app the Studio can change: one entity, one page. */
const NOTES = (title: string) => `import { defineApp } from "potyro";

export default defineApp({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: { label: "Note", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [
    { id: "all", title: ${JSON.stringify(title)}, view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

/** The dev server's generate endpoint (the `claude -p` engine), answering with `source`. */
async function stubGenerator(page: Page, source: string): Promise<void> {
  await page.route("**/__generate**", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "job-1" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + source + "```\n" }) });
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage: false });
}

test.describe("guard: the Studio, Add an app, data, forms and the splash in the pseudo-language", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tag) => {
      localStorage.setItem("potyro:locale", tag);
      // The dev server's engine, so a change can be made without a key; the endpoint is stubbed.
      localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" }));
    }, PSEUDO);
  });

  test("the Studio: an empty conversation, a version's card, and the preview bar", async ({ page }) => {
    test.slow();
    /** The app's name and the page title the change gives it: the app's words. */
    const APP_NAMES = ["Notes", "Jotter"];
    await seed(page, [{ id: "notes", name: "Notes", source: NOTES("Notes"), trusted: true, updatedAt: new Date().toISOString() }]);
    await stubGenerator(page, NOTES("Jotter"));
    await openApp(page, "notes", "Notes");
    // A wide screen has the tool in the bar; a phone has it in the ⋯ menu.
    const tool = page.locator("[data-tool=studio]:visible");
    if (await tool.count()) await tool.first().click();
    else {
      await page.locator(".k-topbar .k-topbar-btn[aria-haspopup]").last().click();
      await page.locator('[role=menuitem][data-action=studio]').click();
    }
    const studio = page.locator(".k-studio");
    await expect(studio.locator(".k-studio-empty")).toBeVisible({ timeout: 30_000 });
    await settled(studio);
    expect(await englishIn(studio, APP_NAMES)).toEqual([]);
    await shot(page, "studio-empty");

    await studio.locator(".k-composer textarea").fill("rename the page to Jotter");
    await studio.locator(".k-composer-send").click();
    const card = studio.locator(".k-card[data-current]");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(studio.locator(".k-thread-working")).toHaveCount(0);
    expect(await englishIn(studio, APP_NAMES)).toEqual([]);
    expect(await englishIn(card, APP_NAMES)).toEqual([]);
    await shot(page, "studio-card");

    const bar = studio.locator(".k-preview-bar");
    if (!(await bar.isVisible())) await card.locator(".k-card-open").click();
    await expect(bar).toBeVisible();
    await settled(studio);
    expect(await englishIn(bar, APP_NAMES)).toEqual([]);
    await shot(page, "studio-preview");
  });

  test("Add an app: where it comes from, and the card for pasted source", async ({ page }) => {
    await seed(page, []);
    await page.goto("/");
    await page.locator(".k-launch-addbtn:visible").first().click();
    const dialog = page.locator(".k-add-app");
    await expect(dialog).toBeVisible();
    expect(await englishIn(dialog)).toEqual([]);

    await dialog.locator(".k-add-app-source").nth(2).click();
    await dialog.locator(".k-add-app-paste").fill(NOTES("Notes"));
    await dialog.locator(".k-add-app-entry-paste button[type=submit]").click();
    const card = dialog.locator(".k-add-app-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    // "Notes" is the app's name, "Note" the kind of record it keeps: the app's words, not ours.
    expect(await englishIn(dialog, ["Notes", "Note"])).toEqual([]);
    await shot(page, "add-an-app");
  });

  test("a data table on the Data page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".k-data-btn:visible").first().click();
    const data = page.locator(".k-datapage");
    await expect(data).toBeVisible();
    await data.locator(".k-datapage-app", { hasText: "Groceries" }).click();
    const table = data.locator(".k-data-table");
    await expect(table.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
    // The tabs and the column heads are the app's own kinds of record and fields.
    const words = await data.locator('[role=tab], .k-data-table thead th[scope=col]:not(:last-child)').allTextContents();
    expect(await englishIn(data, words.map((w) => w.replace(/[\d\s]+$/, "").trim()))).toEqual([]);
  });

  test("a form sheet", async ({ page }) => {
    await page.goto("/?user=places");
    await expect(page.locator("h1").first()).toHaveText("Places", { timeout: 30_000 });
    // The map page adds in place; the list page has the quick action that opens the form.
    await page.getByRole("tab", { name: "All places" }).or(page.getByRole("button", { name: "All places" })).first().click();
    await page.locator(".k-quick:visible, .k-fab:visible").first().click();
    const sheet = page.locator(".k-sheet").last();
    await expect(sheet).toBeVisible();
    await settled(sheet);
    // Its fields and their options are the app's words: the form's labels, and the choices it offers.
    const words = await sheet.locator(".k-form-label, [role=radio], [aria-pressed], .k-chip").allTextContents();
    // A field's placeholder is the app's words too ("The cardamom bun"), like its label.
    const hints = await sheet.locator("[placeholder]").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder") ?? "").filter(Boolean));
    // "opening hour": a list field's own word for one row, after "Add:".
    expect(await englishIn(sheet, ["Place", "opening hour", ...hints, ...words.map((w) => w.replace(/[*\s]+$/, "").trim())])).toEqual([]);
    await shot(page, "form-sheet");
  });

  test("the splash while an app opens", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.goto("/?user=plants");
    const splash = page.locator(".k-splash");
    // Slowed down twenty times, a cold dev server takes a while to draw even the splash.
    await splash.waitFor({ timeout: 90_000 });
    expect(await englishIn(splash, ["Plants"])).toEqual([]);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
});

// ---- #311's card: "Potyro can't do this yet", and what it would send ------------------------------

test("guard: the platform-request card and its review, in the pseudo-language", async ({ page }) => {
  test.slow();
  await page.addInitScript((tag) => {
    localStorage.setItem("potyro:locale", tag);
    // OpenRouter with a stub key, the engine that drives the modify loop; its endpoint is scripted.
    sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub" }));
  }, PSEUDO);
  await seed(page, [{ id: "notes", name: "Notes", source: NOTES("Notes"), trusted: true, updatedAt: new Date().toISOString() }]);
  const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
  let calls = 0;
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { tool_choice?: string };
    calls++;
    if (body.tool_choice === "none") return route.fulfill(reply({ content: "TITLE: Scan barcodes\nI wanted to scan a barcode so the title fills itself in." }));
    if (calls === 1) return route.fulfill(reply({ content: "", tool_calls: [{ id: "l1", type: "function", function: { name: "lookup", arguments: JSON.stringify({ query: "barcodeScanner" }) } }] }));
    return route.fulfill(reply({ content: "NEEDS-PLATFORM: reading barcodes with the camera" }));
  });

  await openApp(page, "notes", "Notes");
  const tool = page.locator("[data-tool=studio]:visible");
  await tool.first().click();
  const studio = page.locator(".k-studio");
  await studio.locator(".k-composer textarea").fill("let me scan a barcode to add a note");
  await studio.locator(".k-composer-send").click();
  const card = studio.locator(".k-ask-card");
  await expect(card).toBeVisible({ timeout: 90_000 });
  // The request is the person's own words, written for them: not Potyro's.
  const request = ["Scan barcodes", "I wanted to scan a barcode so the title fills itself in."];
  expect(await englishIn(card, request)).toEqual([]);

  await card.locator(".k-card-open").click();
  const review = card.locator(".k-ask-card-review");
  await expect(review).toBeVisible();
  await review.locator("summary").click();
  // The structure is the app's own (its entity, fields and pages), and code.
  await expect(review.locator("pre")).toBeVisible();
  expect(await englishIn(card, request)).toEqual([]);
});
