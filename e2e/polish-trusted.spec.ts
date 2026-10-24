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
