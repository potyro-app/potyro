import { test, expect } from "./console-guard";
import { readFileSync } from "node:fs";
import { tileAction } from "./launcher-actions";

// The share sheet's ways out (docs/24 §1, §8): copy, WhatsApp, Telegram, the device's own sheet — and,
// inside an app, a 15-second clip of it where the browser can record one, said plainly where not.

test.use({ viewport: { width: 1280, height: 800 } });

test("a demo link goes straight into WhatsApp or Telegram, or is copied; each is counted on this device only", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // The chats are never really reached from a test: their addresses answer here.
  await context.route(/^https:\/\/(wa\.me|t\.me)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>chat</p>" }));
  await page.goto("/");
  await tileAction(page, "Groceries", "share-sheet");
  const sheet = page.locator(".k-share-sheet");
  await sheet.locator('[data-share="demo"]').click();
  const link = await sheet.getByRole("textbox", { name: "Share link" }).inputValue({ timeout: 30_000 });

  const whatsapp = sheet.getByRole("link", { name: "WhatsApp" });
  const telegram = sheet.getByRole("link", { name: "Telegram" });
  expect(await whatsapp.getAttribute("href")).toBe(`https://wa.me/?text=${encodeURIComponent(`Try Groceries, made with Potyro ${link}`)}`);
  const tg = new URL((await telegram.getAttribute("href"))!);
  expect(tg.searchParams.get("url")).toBe(link);
  await expect(whatsapp).toHaveAttribute("target", "_blank");
  await expect(whatsapp).toHaveAttribute("rel", /noopener/);

  const popup = page.waitForEvent("popup");
  await whatsapp.click();
  await (await popup).close();
  await sheet.getByRole("button", { name: "Copy link" }).click();
  await expect(sheet.getByRole("status")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  const counts = JSON.parse((await page.evaluate(() => localStorage.getItem("potyro:share-counts"))) ?? "{}");
  expect(counts).toMatchObject({ "demo-link-made": 1, "share-network:whatsapp": 1, "share-network:copy": 1 });
});

test("inside an app that draws on a canvas, a clip is recorded from it and saved as a file", async ({ page }) => {
  await page.addInitScript(() => {
    // The browser's own download, not the save-file picker, so the test can read the file.
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/?user=groceries");
  await expect(page.locator(".k-app")).toBeVisible({ timeout: 30_000 });
  // A canvas the app draws on, moving — what a p5 sketch or a game is.
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    document.querySelector(".k-app")!.prepend(c);
    const g = c.getContext("2d")!;
    let x = 0;
    const draw = () => {
      g.fillStyle = "#f7f3ea";
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#e4a93c";
      g.fillRect(x % 320, 100, 40, 40);
      x += 6;
      requestAnimationFrame(draw);
    };
    draw();
  });
  await page.getByRole("button", { name: "Share" }).click();
  const sheet = page.locator(".k-share-sheet");
  await expect(sheet.getByRole("heading", { name: "A 15-second clip" })).toBeVisible();
  await sheet.locator('[data-clip="record"]').click();

  // While it records the sheet steps aside for one small bar.
  const pill = page.locator(".k-clip-pill");
  await expect(pill).toContainText(/Recording · 1[45] s/);
  await expect(page.locator(".k-share-sheet")).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await pill.getByRole("button", { name: "Stop" }).click();

  await expect(sheet.getByText("The clip is ready.")).toBeVisible({ timeout: 10_000 });
  const download = page.waitForEvent("download");
  await sheet.locator('[data-clip="save"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^groceries-clip\.(mp4|webm)$/);
  expect(readFileSync((await file.path())!).length).toBeGreaterThan(1_000);
  await expect(sheet).toContainText("Saved groceries-clip.");
});

test("where the browser cannot record, the sheet says so plainly", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).MediaRecorder;
  });
  await page.goto("/?user=groceries");
  await expect(page.locator(".k-app")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Share" }).click();
  const clip = page.locator(".k-share-way-clip");
  await expect(clip.locator('[data-clip="unsupported"]')).toContainText("This browser cannot record the app");
  await expect(clip.locator('[data-clip="record"]')).toHaveCount(0);
});
