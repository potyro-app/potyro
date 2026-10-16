import { test, expect, type Page } from "./console-guard";
import { addAsMine, packApp, pixelsOf, type Pixels } from "./library-demos";

// Mirror Monsters on a phone-sized screen (#338, from a Pixel): the kaleidoscope fills EVERY segment
// — every other one was solid dark — and the shell's "Camera on" sign never sits on the app's name.
// Chromium's fake camera stands in for the phone's: a moving test pattern, never as dark as the
// kaleidoscope's background.

test.use({
  viewport: { width: 375, height: 760 },
  colorScheme: "light",
  hasTouch: true,
  // Each engine's fake camera: Chromium's flags, Firefox's prefs (opt-in project, trusted-firefox).
  permissions: async ({ browserName }, use) => use(browserName === "chromium" ? ["camera"] : []),
  launchOptions: [
    async ({ browserName }, use) =>
      use(
        browserName === "firefox"
          ? { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } }
          : { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      ),
    { scope: "worker" },
  ],
});

const canvas = (page: Page) => page.locator(".mm-stage canvas");
const sign = (page: Page) => page.getByTestId("camera-on");

/** The kaleidoscope's background, #140a24: what an empty segment shows. */
const isBackground = (p: Pixels, i: number) => Math.abs(p.data[i]! - 20) + Math.abs(p.data[i + 1]! - 10) + Math.abs(p.data[i + 2]! - 36) < 24;

/**
 * For each of `n` segments around the canvas's middle, the share of points along its middle ray that
 * show picture rather than background. A segment left empty reads 0.
 */
async function segmentFill(page: Page, n: number): Promise<number[]> {
  const p = await pixelsOf(canvas(page));
  const cx = p.width / 2;
  const cy = p.height / 2;
  const r = Math.min(p.width, p.height) / 2;
  const a = (Math.PI * 2) / n;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let seen = 0;
    let all = 0;
    for (let f = 0.12; f <= 0.95; f += 0.04)
      for (const off of [0.3, 0.5, 0.7]) {
        const th = (k + off) * a;
        const x = Math.round(cx + Math.cos(th) * r * f);
        const y = Math.round(cy + Math.sin(th) * r * f);
        if (!isBackground(p, (y * p.width + x) * 4)) seen++;
        all++;
      }
    out.push(seen / all);
  }
  return out;
}

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("Mirror Monsters on a phone: the kaleidoscope fills every segment, and Camera on stays off the app's name and its picture", async ({ page }) => {
  await addAsMine(page, "mirror-monsters.potyro-app.zip", packApp("mirror-monsters", "mirror-monsters.app.ts"));
  await expect(page.getByRole("heading", { name: "Meet your monster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Turn on the camera" }).click();
  await expect(sign(page)).toBeVisible();

  // The sign is under the top bar, clear of the app's name and of every button in the bar, at
  // 375 and at 412 pixels wide (a Pixel's).
  for (const width of [375, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const title = page.locator(".k-topbar-name");
    await expect(title).toBeVisible();
    await expect
      .poll(async () => {
        const s = (await sign(page).boundingBox())!;
        const bar = (await page.locator(".k-topbar").boundingBox())!;
        const name = (await title.boundingBox())!;
        // Nor on the app's picture: the stage keeps below it (--k-chrome-top, docs/04).
        const stage = (await page.locator(".mm-stage").boundingBox())!;
        return { name: intersects(s, name), bar: intersects(s, bar), stage: intersects(s, stage), onScreen: s.x >= 0 && s.x + s.width <= width };
      })
      .toEqual({ name: false, bar: false, stage: false, onScreen: true });
  }
  await sign(page).getByRole("button", { name: "Turn off" }).click({ trial: true });

  // The kaleidoscope: eight segments by default, every one of them showing the picture.
  await page.getByRole("button", { name: /Kaleido/ }).click();
  await expect(canvas(page)).toHaveAttribute("aria-label", /kaleidoscope/);
  await expect.poll(async () => Math.min(...(await segmentFill(page, 8))), { timeout: 10_000 }).toBeGreaterThan(0.9);

  // A tap adds mirrors: ten, every one filled too.
  await canvas(page).click();
  await expect.poll(async () => Math.min(...(await segmentFill(page, 10))), { timeout: 10_000 }).toBeGreaterThan(0.9);
});
