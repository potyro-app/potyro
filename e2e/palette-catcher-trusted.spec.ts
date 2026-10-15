import { test, expect, type Page } from "@playwright/test";
import { addAsMine, count, near, packApp, pixelsOf } from "./library-demos";

// apps/palette-catcher, packed as its build packs it and added as the person's own app. The photo
// goes in the way a phone's would: ctx.caps.camera on the web is a file input, so the test answers
// its file chooser with a picture it paints itself — four bands of known colour and a small red
// disc — and every check is about what is really on screen: the photo's pixels, the colours the
// chips are painted in, where the markers sit on the photo, the text's contrast, the clipboard, the
// PNG the share card becomes, and the gallery's image.

type RGB = [number, number, number];
const TERRACOTTA: RGB = [196, 98, 64];
const SAGE: RGB = [143, 165, 128];
const CREAM: RGB = [240, 230, 208];
const NAVY: RGB = [32, 46, 86];
const RED: RGB = [214, 40, 48];
const BANDS = [TERRACOTTA, SAGE, CREAM, NAVY];

/** A 800×600 PNG: four vertical bands, and a red disc in the sage band. */
async function bandsPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([bands, red]) => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      const g = c.getContext("2d")!;
      bands.forEach(([r, gg, b], i) => {
        g.fillStyle = `rgb(${r},${gg},${b})`;
        g.fillRect(i * 200, 0, 200, 600);
      });
      g.fillStyle = `rgb(${red.join(",")})`;
      g.beginPath();
      g.arc(300, 420, 46, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL("image/png").split(",")[1]!;
    },
    [BANDS, RED] as const,
  );
  return Buffer.from(b64, "base64");
}

const chips = (page: Page) => page.locator(".pc-work .pc-chip");

/** Each chip's painted background, as the browser computed it. */
const chipColours = (page: Page) =>
  chips(page).evaluateAll((els) =>
    els.map((el) => {
      const m = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
      return [m[0], m[1], m[2]] as [number, number, number];
    }),
  );

const close = (a: RGB, b: RGB, tol = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });

test("Palette Catcher: a photo becomes a palette with markers where each colour is; copy, rename, save, share and the gallery", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { card } = await addAsMine(page, "palette-catcher.potyro-app.zip", packApp("palette-catcher", "palette-catcher.app.ts"));
  expect(card).toMatch(/Asks for camera/);

  // Before a photo: the welcome, over a fan of real colour.
  await expect(page.getByRole("heading", { name: "Catch the colours of anything" })).toBeVisible({ timeout: 30_000 });
  const fanColours = await page.locator(".pc-hero .pc-fchip").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(fanColours).size).toBe(7);

  // A photo, through the camera capability.
  const png = await bandsPng(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a photo" }).click();
  await (await chooser).setFiles({ name: "bands.png", mimeType: "image/png", buffer: png });

  // The photo itself is on screen, at its own shape.
  const photo = page.locator(".pc-photo canvas");
  await expect(photo).toHaveCount(1, { timeout: 15_000 });
  const shown = await pixelsOf(photo);
  expect(shown.width).toBeGreaterThan(500);
  expect(count(shown, near(NAVY, 6))).toBeGreaterThan(shown.data.length / 4 / 6);

  // Six colours by default: every band, and the small red accent the bands would have drowned.
  await expect(chips(page)).toHaveCount(6);
  const colours = await chipColours(page);
  for (const c of [...BANDS, RED]) expect(colours.some((x) => close(x, c)), `${c} in ${JSON.stringify(colours)}`).toBe(true);

  // Each colour's marker sits on the photo where that colour is.
  const box = (await photo.boundingBox())!;
  const pins = page.locator(".pc-pin");
  await expect(pins).toHaveCount(6);
  for (const [i, c] of colours.entries()) {
    const at = BANDS.findIndex((b) => close(b, c));
    if (at < 0) continue;
    const p = (await pins.nth(i).boundingBox())!;
    const u = (p.x + p.width / 2 - box.x) / box.width;
    expect(Math.floor(u * 4), `marker ${i}`).toBe(at);
  }
  const redPin = (await pins.nth(colours.findIndex((x) => close(x, RED))).boundingBox())!;
  expect(Math.hypot((redPin.x + redPin.width / 2 - box.x) / box.width - 0.375, (redPin.y + redPin.height / 2 - box.y) / box.height - 0.7)).toBeLessThan(0.08);

  // The words on every chip read on its colour: 4.5:1 or better, measured on the page.
  const ratios = await chips(page).evaluateAll((els) => {
    const lum = (s: string) => {
      const [r, g, b] = s.match(/\d+/g)!.slice(0, 3).map((v) => {
        const c = Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    return els.map((el) => {
      const bg = lum(getComputedStyle(el).backgroundColor);
      const fg = lum(getComputedStyle(el.querySelector(".pc-chip-name")!).color);
      return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    });
  });
  for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);

  // Eight colours, and the choice is remembered across a trip to the Gallery.
  await page.getByRole("group", { name: "How many colours" }).getByRole("button", { name: "8" }).click();
  await expect(chips(page)).toHaveCount(8);
  await page.locator(".k-tab", { hasText: "Gallery" }).click();
  await expect(page.getByRole("heading", { name: "No palettes yet" })).toBeVisible();
  await page.locator(".k-tab", { hasText: "Catch" }).click();
  await expect(chips(page)).toHaveCount(8);
  await page.getByRole("group", { name: "How many colours" }).getByRole("button", { name: "6" }).click();
  await expect(chips(page)).toHaveCount(6);

  // One colour up close: its codes, and Copy puts the hex on the clipboard.
  const navyAt = (await chipColours(page)).findIndex((x) => close(x, NAVY));
  const navyChip = chips(page).nth(navyAt);
  const navyHex = (await navyChip.getAttribute("data-hex"))!.toUpperCase();
  await navyChip.click();
  const sheet = page.getByRole("dialog", { name: "Midnight" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".pc-code dd").first()).toHaveText(navyHex);
  await expect(sheet.locator(".pc-code dd").nth(1)).toHaveText(/^rgb\(\d+, \d+, \d+\)$/);
  await expect(sheet.locator(".pc-code dd").nth(2)).toHaveText(/^oklch\([\d.]+% [\d.]+ [\d.]+\)$/);
  await sheet.getByRole("button", { name: `Copy ${navyHex}` }).click();
  await expect(page.locator(".k-toast").last()).toHaveText(`Copied ${navyHex}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(navyHex);
  // White text reads on navy; the sheet says so with a grade.
  await expect(sheet.locator(".pc-pair").first()).toContainText("AAA");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // Rename, then save: a record with the photo, and the button says it is done.
  await page.getByRole("button", { name: "Rename" }).click();
  const ask = page.getByRole("dialog", { name: "Name this palette" });
  await ask.getByRole("textbox").fill("Beach huts");
  await ask.getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".pc-work .pc-name")).toHaveText("Beach huts");
  await page.getByRole("button", { name: "Save to gallery" }).click();
  await expect(page.locator(".k-toast").last()).toHaveText("Saved “Beach huts” to your gallery", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();

  // Share card: a 1080×1350 PNG that carries the palette's colours, handed to the save dialog.
  await page.evaluate(() => {
    const w = window as unknown as { __card?: { name: string; px: number[][]; w: number; h: number }; showSaveFilePicker: unknown };
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const bmp = await createImageBitmap(data);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const g = c.getContext("2d")!;
          g.drawImage(bmp, 0, 0);
          // One pixel from the middle-top of each chip column of the strip (6 columns, 64px margins).
          const px = Array.from({ length: 6 }, (_, i) => [...g.getImageData(Math.round(64 + (952 / 6) * (i + 0.5)), 840, 1, 1).data].slice(0, 3));
          w.__card = { name: suggestedName, px, w: bmp.width, h: bmp.height };
        },
        close: async () => {},
      }),
    });
  });
  await page.getByRole("button", { name: "Share card" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __card?: unknown }).__card), { timeout: 15_000 }).toBeTruthy();
  const cardPng = (await page.evaluate(() => (window as unknown as { __card: { name: string; px: RGB[]; w: number; h: number } }).__card))!;
  expect(cardPng.name).toMatch(/^beach-huts-\d{8}-\d{6}\.png$/);
  expect([cardPng.w, cardPng.h]).toEqual([1080, 1350]);
  const now = await chipColours(page);
  cardPng.px.forEach((p, i) => expect(close(p, now[i]!, 3), `column ${i}: ${p} vs ${now[i]}`).toBe(true));
  await expect(page.locator(".k-toast").last()).toHaveText("Your card is saved as an image, ready to share");

  // The Gallery: the photo as a real image, the strip in the palette's colours, and it can go.
  await page.locator(".k-tab", { hasText: "Gallery" }).click();
  const piece = page.getByRole("button", { name: "Beach huts, open" });
  await expect(piece).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => piece.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);
  const strip = await piece.locator(".pc-strip i").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).backgroundColor));
  expect(strip).toHaveLength(6);
  expect(strip.every(Boolean)).toBe(true);
  await piece.click();
  const view = page.getByRole("dialog", { name: "Beach huts" });
  await expect(view.locator(".pc-chip")).toHaveCount(6);
  await view.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete “Beach huts”?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "No palettes yet" })).toBeVisible({ timeout: 15_000 });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, colorScheme: "dark" });

  test("Palette Catcher: the sample gives a full palette at 375, in Polish, with nothing wider than the screen", async ({ page }) => {
    await addAsMine(page, "palette-catcher.potyro-app.zip", packApp("palette-catcher", "palette-catcher.app.ts"));
    // Polish, chosen the way You → Language chooses it, once the app is in.
    await page.evaluate(() => localStorage.setItem("potyro:locale", "pl"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Złap kolory czegokolwiek" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Wypróbuj na przykładzie" }).click();
    await expect(chips(page)).toHaveCount(6);
    await expect(page.locator(".pc-work .pc-sub")).toContainText("6 kolorów złapanych");
    // The sample really painted: a dusk sky and a warm dune.
    const shown = await pixelsOf(page.locator(".pc-photo canvas"));
    expect(count(shown, (r, g, b) => b > r && b > 70 && r < 80)).toBeGreaterThan(5000);
    expect(count(shown, (r, g, b) => r > 140 && g < 120 && b < 90)).toBeGreaterThan(5000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
