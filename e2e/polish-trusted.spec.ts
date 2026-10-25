import { test, expect } from "./console-guard";

// #428 polish, from the owner's screenshots (2026-10-24): the Studio's colour clock never covers the
// app's name, and Add an app's choices draw icons, not characters (DESIGN.md §3.5: Lucide, no emoji).

test.use({ viewport: { width: 1440, height: 900 } });

test("the Studio's name and colour clock never overlap, even for a long name in pt-BR", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("potyro:locale", "pt-BR"));
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const name = page.locator(".k-preview-adjust-name");
  const clock = page.locator(".k-clock");
  await expect(clock).toBeVisible({ timeout: 60_000 });
  // The words themselves, not the button: a squeezed button lets its text run past its own box.
  const overlap = async () => {
    const a = await name.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const { x, y, width, height } = r.getBoundingClientRect();
      return { x, y, width, height };
    });
    const b = (await clock.boundingBox())!;
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  };
  expect(await overlap()).toBe(false);
  // A long name, as a person might give one.
  await name.evaluate((el) => (el.firstChild!.textContent = "Compras da casa e do escritório, divididas por mercado "));
  expect(await overlap()).toBe(false);
});

test("Add an app's four ways in draw icons, not characters", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Add an app/ }).first().click();
  const glyphs = page.locator(".k-add-app-source-glyph");
  await expect(glyphs).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(glyphs.nth(i).locator("svg[data-icon] path")).toBeAttached();
    expect((await glyphs.nth(i).innerText()).trim()).toBe("");
  }
});

// DESIGN.md §11: focus is always visible, a 2px ring in --focus with a 2px offset. The fields used to
// swap the ring for a border tint, which a keyboard user can lose on a busy screen.
test("the fields show the focus ring when reached with Tab", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  const ring = (sel: string) =>
    page.locator(sel).first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { style: c.outlineStyle, width: c.outlineWidth, offset: c.outlineOffset };
    });
  for (const sel of ["textarea.k-prompt-box", ".k-launch-search input.k-input"]) {
    const field = page.locator(sel).first();
    await field.focus();
    await expect(field).toBeFocused();
    expect(await ring(sel)).toEqual({ style: "solid", width: "2px", offset: "2px" });
  }
});

// A checklist's add box floats over the rows, above the page's band ("Done shopping"). The two used
// to sit 10px apart, so the list showed through between them, and a row reached with Tab could stop
// under them (DESIGN.md §11: focus never hidden).
test("a checklist's rows never show under its add box or hide focus behind it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?user=groceries");
  const add = page.locator(".k-check-add");
  const band = page.locator(".k-primary-bar");
  await expect(add).toBeVisible({ timeout: 30_000 });
  await expect(band).toBeVisible();
  // The band rises in on arrival; measure once it has landed.
  await band.evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
  const a = (await add.boundingBox())!;
  const b = (await band.boundingBox())!;
  expect(b.y - (a.y + a.height)).toBeLessThanOrEqual(0.5);

  let checked = 0;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest(".k-check-row")) return null;
      const rc = el.getBoundingClientRect();
      const top = document.querySelector(".k-check-add")!.getBoundingClientRect().top;
      return { bottom: rc.bottom, top, label: el.getAttribute("aria-label") ?? el.textContent };
    });
    if (!r) continue;
    checked++;
    expect(r.bottom, `${r.label} is under the add box`).toBeLessThanOrEqual(r.top + 0.5);
  }
  expect(checked).toBeGreaterThan(5);
});

const EMPTY_APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "polish-empty",
  name: "Reading list",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [
    {
      id: "books",
      title: "Books",
      description: "Books you want to read next, and the ones you finished.",
      view: { type: "list", entity: "book", display: { primary: "title" }, emptyText: "No books yet" },
    },
  ],
});`;

test.describe("an empty page and its sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((source) => {
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "polish-empty", name: "Reading list", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    }, EMPTY_APP);
  });

  // DESIGN.md §6: the mascot at 48px, a heading, one supporting line, one primary button.
  test("an empty page has the mascot, a heading, what the page is for and one button", async ({ page }) => {
    await page.goto("/?user=polish-empty");
    const empty = page.locator(".k-empty-state");
    await expect(empty).toBeVisible({ timeout: 30_000 });
    const mark = (await empty.locator(".k-empty-mark").boundingBox())!;
    expect(Math.round(mark.width)).toBe(48);
    await expect(empty.locator(".k-empty-title")).toHaveText("No books yet");
    await expect(empty.locator(".k-empty-support")).toHaveText("Books you want to read next, and the ones you finished.");
    await expect(empty.getByRole("button")).toHaveCount(1);
  });

  // §6: on a phone a sheet rises with a 36×4 handle; swiping its header down closes it.
  test("on a phone the record sheet shows its handle", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?user=polish-empty");
    await page.getByRole("button", { name: "Add the first one" }).click();
    const sheet = page.locator(".k-sheet");
    await expect(sheet).toBeVisible();
    const handle = await sheet.evaluate((el) => {
      const c = getComputedStyle(el, "::before");
      return { content: c.content, width: c.width, height: c.height };
    });
    expect(handle).toEqual({ content: '""', width: "36px", height: "4px" });
  });
});
