import { test, expect } from "./console-guard";
import { addAsMine, count, packApp, pixelsOf } from "./library-demos";
import jsQR from "../apps/qr-maker/node_modules/jsqr/dist/jsQR.js";

// apps/qr-maker, packed as its build packs it: a link typed on the Make screen is drawn as a code
// while typing — and the canvas really holds one: an independent decoder reads the link back from
// its pixels. Keep puts it under Kept with its picture.

test("QR Maker draws a readable code as you type, and keeps it with its picture", async ({ page }) => {
  await addAsMine(page, "qr-maker.potyro-app.zip", packApp("qr-maker", "qr-maker.app.ts"));

  const canvas = page.getByRole("img", { name: "The QR code" });
  // Never an empty card: the first open shows the app's own address as a code, until the first keystroke.
  await expect(canvas).toBeVisible();
  await expect(page.getByText("https://potyro.app", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Link" }).click();
  const link = page.getByRole("textbox", { name: "Link" });
  await link.fill("");
  await link.pressSequentially("potyro.app/gallery");
  await expect(canvas).toBeVisible();
  await expect(page.getByText("https://potyro.app/gallery")).toBeVisible();
  if (process.env.SHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: process.env.SHOT });
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  // The pixels are a QR code that says what was typed.
  const px = await pixelsOf(canvas);
  expect(count(px, (r, g, b) => r < 60 && g < 60 && b < 60)).toBeGreaterThan(200);
  const read = jsQR(new Uint8ClampedArray(px.data.buffer, px.data.byteOffset, px.data.length), px.width, px.height);
  expect(read?.data).toBe("https://potyro.app/gallery");

  // Keep: named, then under Kept with its picture.
  await page.getByRole("button", { name: "Keep" }).click();
  const ask = page.locator(".k-dialog", { hasText: "What should this code be called?" });
  await expect(ask.locator("input")).toHaveValue("potyro.app");
  await ask.locator("input").fill("Gallery link");
  await ask.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("Kept. It is under Kept.")).toBeVisible();
  await page.getByRole("button", { name: "Kept" }).first().click();
  const row = page.locator(".qm-row", { hasText: "Gallery link" });
  await expect(row).toBeVisible();
  await expect(row.locator("img")).toHaveJSProperty("naturalWidth", (25 + 8) * 10) /* version 2, 25 modules, 4 quiet each side, 10 px a module */;
  await row.click();
  await expect(page.getByRole("dialog", { name: "Gallery link" })).toBeVisible();
});
