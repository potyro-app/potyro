import { test, expect, type Page } from "./console-guard";
import { addAsMine, count, near, needEsmSh, packApp, pixelsOf, watchEsmSh } from "./library-demos";
import { drawSharedPicture, fakeShareSheet } from "./share-files";

// apps/mood-sleep, packed as its build packs it and added as the person's own app, with chart.js
// fetched from the real esm.sh (#266). Every check is about what is drawn: the sentence carries the
// seed's numbers, the chart canvases hold the series' colours, a tag chip takes its dots off the
// scatter, and with esm.sh gone the charts still draw from the copy the app keeps.

const SLEEP: [number, number, number] = [124, 108, 240]; // theme.accent
const MOOD: [number, number, number] = [232, 131, 58];
const EXERCISE: [number, number, number] = [47, 158, 107];

test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });

const lineCanvas = (page: Page) => page.locator(".ms-line canvas");
const scatterCanvas = (page: Page) => page.locator(".ms-scatter canvas");

test("Sleep & Mood: chart.js comes from esm.sh once, and both charts draw what the seed says", async ({ page }) => {
  await needEsmSh();
  await fakeShareSheet(page);
  const asked = watchEsmSh(page);
  const zip = packApp("mood-sleep", "mood-sleep.app.ts", ["--seed", "seed.json"]);
  const { card } = await addAsMine(page, "mood-sleep.potyro-app.zip", zip);

  expect(card).toContain("fetches chart.js 4.5.1 from esm.sh");
  expect(card).toContain("Starts with 20 records");
  // The whole graph, fetched when Add was pressed: the ?bundle stub and the file it re-exports.
  expect([...new Set(asked)].sort()).toEqual(["https://esm.sh/chart.js@4.5.1/es2022/chart.bundle.mjs", "https://esm.sh/chart.js@4.5.1?bundle"]);

  // The sentence is computed from the seed: ten nights of 7h+ average mood 4.3, five under 6h 2.4.
  await expect(page.locator(".ms-insight")).toHaveText("On nights of 7 hours or more your mood averages 4.3. Under 6 hours, it's 2.4.", { timeout: 30_000 });
  await expect(page.locator(".ms-kicker")).toHaveText("20 check-ins · Sep 21 – Oct 11");
  await expect(page.locator(".ms-stats dd")).toHaveText(["6.8h", /^3\.5/, "50%"]);

  // Night by night: both series really painted, in their own colours.
  await expect.poll(async () => count(await pixelsOf(lineCanvas(page)), near(SLEEP)), { timeout: 15_000 }).toBeGreaterThan(400);
  await expect.poll(async () => count(await pixelsOf(lineCanvas(page)), near(MOOD))).toBeGreaterThan(150);

  // The scatter: exercise nights are green dots — until their chip is switched off.
  await expect.poll(async () => count(await pixelsOf(scatterCanvas(page)), near(EXERCISE, 30)), { timeout: 15_000 }).toBeGreaterThan(80);
  const chip = page.getByRole("button", { name: "exercise" });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => count(await pixelsOf(scatterCanvas(page)), near(EXERCISE, 30))).toBeLessThan(10);

  // Share (#484): a 1080×1350 card on the night palette, handed to Potyro's share dialog
  // (ctx.ui.share). The dialog shows the picture before anything leaves; its Share hands it to the
  // share sheet, which keeps what it was given — so this reads the picture itself: the dark sky, and
  // the sleep series (the app's colour at the dark text level) and the mood series really painted, in
  // the sentence and the chart, with the chart panel at least 420px tall.
  await page.locator(".ms-hero").getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Your nights" });
  const preview = dialog.getByRole("img", { name: /^sleep-\d{4}-\d{2}-\d{2}\.png$/ });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => preview.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1080);
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog).toBeHidden();
  const picture = await drawSharedPicture(page);
  expect(picture.name).toMatch(/^sleep-\d{4}-\d{2}-\d{2}\.png$/);
  expect(picture.type).toBe("image/png");
  expect([picture.w, picture.h]).toEqual([1080, 1350]);
  const read = await page.evaluate(() => {
    const g = (window as unknown as { __picture: CanvasRenderingContext2D }).__picture;
    const W = g.canvas.width;
    const rgb = (css: string): number[] => {
      const p = document.createElement("canvas").getContext("2d")!;
      p.fillStyle = css;
      p.fillRect(0, 0, 1, 1);
      return [...p.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const sleepRgb = rgb(getComputedStyle(document.querySelector(".ms")!).getPropertyValue("--tinta-d").trim());
    const moodRgb = rgb("#ffa25c");
    const near = (px: Uint8ClampedArray, i: number, t: number[], tol = 12) => Math.abs(px[i]! - t[0]!) < tol && Math.abs(px[i + 1]! - t[1]!) < tol && Math.abs(px[i + 2]! - t[2]!) < tol;
    const tally = (y0: number, y1: number, t: number[]) => {
      const px = g.getImageData(0, y0, W, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (near(px, i, t)) n++;
      return n;
    };
    // The chart panel: the panel's colour (#2a2829) down a column inside it, clear of its corners.
    const column = g.getImageData(120, 0, 1, g.canvas.height).data;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < g.canvas.height; y++) {
      if (near(column, y * 4, [42, 40, 41], 3)) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return {
      sky: [...g.getImageData(10, 10, 1, 1).data].slice(0, 3),
      sleep: tally(0, g.canvas.height, sleepRgb),
      mood: tally(0, g.canvas.height, moodRgb),
      // The sentence's numbers, above the stats: sleep-coloured text in the top part.
      sentence: tally(180, 520, sleepRgb),
      panel: bottom - top,
    };
  });
  expect(read.sky).toEqual([28, 27, 28]); // #1c1b1c, the dark theme's page
  expect(read.sentence).toBeGreaterThan(1_500);
  expect(read.sleep).toBeGreaterThan(8_000);
  expect(read.mood).toBeGreaterThan(2_000);
  expect(read.panel).toBeGreaterThanOrEqual(420 - 1);
});

test("Sleep & Mood: with esm.sh gone, the charts still draw from the copy the app keeps", async ({ page, context }) => {
  await needEsmSh();
  await addAsMine(page, "mood-sleep.potyro-app.zip", packApp("mood-sleep", "mood-sleep.app.ts", ["--seed", "seed.json"]));
  await expect(page.locator(".ms-insight")).toContainText("4.3", { timeout: 30_000 });
  const url = page.url();

  const after: string[] = [];
  await context.route("https://esm.sh/**", (route) => {
    after.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  await page.goto(url);
  await expect(page.locator(".ms-insight")).toContainText("4.3", { timeout: 30_000 });
  await expect.poll(async () => count(await pixelsOf(lineCanvas(page)), near(SLEEP)), { timeout: 15_000 }).toBeGreaterThan(400);
  expect(after).toEqual([]);
});
