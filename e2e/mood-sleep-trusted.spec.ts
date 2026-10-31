import { test, expect, type Page } from "./console-guard";
import { addAsMine, count, near, needEsmSh, packApp, pixelsOf, watchEsmSh } from "./library-demos";

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

  // Share (#484): a 1080×1350 card on the night palette, handed to the system's save or share dialog
  // (ctx.files.export). The dialog is answered in the page, which reads the picture it is given: the
  // dark sky, and the sleep series (the app's colour at the dark text level) and the mood series
  // really painted, in the sentence and the chart.
  await page.evaluate(() => {
    type Card = { name: string; w: number; h: number; sky: number[]; sleep: number; mood: number; sentence: number };
    const w = window as unknown as { __card?: Card; showSaveFilePicker: unknown };
    const rgb = (css: string): number[] => {
      const g = document.createElement("canvas").getContext("2d")!;
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const sleepRgb = rgb(getComputedStyle(document.querySelector(".ms")!).getPropertyValue("--tinta-d").trim());
    const moodRgb = rgb("#ffa25c");
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const bmp = await createImageBitmap(data);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const g = c.getContext("2d")!;
          g.drawImage(bmp, 0, 0);
          const near = (px: Uint8ClampedArray, i: number, t: number[]) => Math.abs(px[i]! - t[0]!) < 12 && Math.abs(px[i + 1]! - t[1]!) < 12 && Math.abs(px[i + 2]! - t[2]!) < 12;
          const tally = (y0: number, y1: number, t: number[]) => {
            const px = g.getImageData(0, y0, c.width, y1 - y0).data;
            let n = 0;
            for (let i = 0; i < px.length; i += 4) if (near(px, i, t)) n++;
            return n;
          };
          w.__card = {
            name: suggestedName,
            w: c.width,
            h: c.height,
            sky: [...g.getImageData(10, 10, 1, 1).data].slice(0, 3),
            sleep: tally(0, c.height, sleepRgb),
            mood: tally(0, c.height, moodRgb),
            // The sentence's numbers, above the stats: sleep-coloured text in the top third.
            sentence: tally(180, 560, sleepRgb),
          };
        },
        close: async () => {},
      }),
    });
  });
  await page.locator(".ms-hero").getByRole("button", { name: "Share" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __card?: unknown }).__card), { timeout: 15_000 }).toBeTruthy();
  const shared = await page.evaluate(() => (window as unknown as { __card: { name: string; w: number; h: number; sky: number[]; sleep: number; mood: number; sentence: number } }).__card);
  expect(shared.name).toMatch(/^sleep-\d{4}-\d{2}-\d{2}\.png$/);
  expect([shared.w, shared.h]).toEqual([1080, 1350]);
  expect(shared.sky).toEqual([28, 27, 28]); // #1c1b1c, the dark theme's page
  expect(shared.sentence).toBeGreaterThan(1_500);
  expect(shared.sleep).toBeGreaterThan(8_000);
  expect(shared.mood).toBeGreaterThan(2_000);
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
