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
