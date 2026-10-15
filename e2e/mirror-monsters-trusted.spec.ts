import { test, expect, type Page } from "./console-guard";
import { addAsMine, changed, count, packApp, pixelsOf } from "./library-demos";

// The live camera (docs/25), through apps/mirror-monsters added as the person's own app, on Chromium's
// fake camera: a moving test pattern that the browser hands to getUserMedia without asking. Every
// claim reads the canvas or the camera's own tracks — never "an element exists".
//
//   - frames reach the canvas: it changes from frame to frame, the twin is mirror-symmetric, the
//     pixel monster is only its palette;
//   - the shell's "Camera on" shows while it runs, comes back when the app removes it, and Turn off
//     stops it;
//   - the camera STOPS — every track ended — when the page is hidden, when the mirror is left for the
//     Gallery, and when the app is left for Home.

test.use({
  viewport: { width: 1280, height: 900 },
  colorScheme: "light",
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

const canvas = (page: Page) => page.locator(".mm-stage canvas");
const sign = (page: Page) => page.getByTestId("camera-on");

/** Every camera track the page has been given, so a test can say whether they are all off. */
async function watchTracks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const all: MediaStreamTrack[] = [];
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = all;
    md.getUserMedia = async (c) => {
      const s = await real(c);
      all.push(...s.getTracks());
      return s;
    };
  });
}
const tracks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => ({ kind: t.kind, state: t.readyState })));
const live = async (page: Page) => (await tracks(page)).filter((t) => t.state === "live").length;

/** The share of rows whose left half mirrors their right half (within a tolerance). */
async function symmetry(page: Page): Promise<number> {
  const p = await pixelsOf(canvas(page));
  let same = 0;
  let n = 0;
  for (let y = 0; y < p.height; y += 4)
    for (let x = 0; x < p.width / 2 - 4; x += 4) {
      const a = (y * p.width + x) * 4;
      const b = (y * p.width + (p.width - 1 - x)) * 4;
      const d = Math.abs(p.data[a]! - p.data[b]!) + Math.abs(p.data[a + 1]! - p.data[b + 1]!) + Math.abs(p.data[a + 2]! - p.data[b + 2]!);
      if (d < 30) same++;
      n++;
    }
  return same / n;
}

/** Make the page hidden (or visible) the way a tab switch or Home does: `document.hidden` and the event. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("Mirror Monsters: the live camera draws on the canvas, the shell says Camera on, and the camera stops on leaving", async ({ page }) => {
  test.setTimeout(120_000);
  await watchTracks(page);
  const { card } = await addAsMine(page, "mirror-monsters.potyro-app.zip", packApp("mirror-monsters", "mirror-monsters.app.ts"));
  expect(card).toMatch(/Asks for camera/);

  // Before the camera: the monster waits on the dark stage, and nothing has asked for the camera.
  await expect(page.getByRole("heading", { name: "Meet your monster" })).toBeVisible({ timeout: 30_000 });
  await expect(canvas(page)).toHaveCount(1);
  expect(await tracks(page)).toEqual([]);
  await expect(sign(page)).toHaveCount(0);

  // On: the shell's sign, a live video track (and no microphone), frames on the canvas.
  await page.getByRole("button", { name: "Turn on the camera" }).click();
  await expect(sign(page)).toBeVisible();
  await expect(sign(page)).toContainText("Camera on");
  await expect.poll(() => live(page)).toBe(1);
  expect((await tracks(page)).map((t) => t.kind)).toEqual(["video"]);
  await expect(page.getByRole("heading", { name: "Meet your monster" })).toBeHidden();

  // Twin: the camera's picture, its left half mirrored onto the right, moving from frame to frame.
  await page.getByRole("button", { name: /Twin/ }).click();
  await expect.poll(() => symmetry(page), { timeout: 10_000 }).toBeGreaterThan(0.97);
  const a = await pixelsOf(canvas(page));
  await page.waitForTimeout(600);
  expect(changed(a, await pixelsOf(canvas(page)))).toBeGreaterThan(0.002);

  // Monster: googly eyes (their whites are the app's own #fffdf7) over the camera's picture.
  await page.getByRole("button", { name: /Monster/ }).first().click();
  const whites = (r: number, g: number, b: number) => r > 250 && g > 248 && b > 240 && b < 252;
  await expect.poll(async () => count(await pixelsOf(canvas(page)), whites), { timeout: 10_000 }).toBeGreaterThan(2_000);

  // Pixel: every pixel is one of the palette's eight colours.
  await page.getByRole("button", { name: /Pixel/ }).click();
  const palette = [[26, 16, 46], [86, 38, 110], [190, 64, 130], [255, 138, 101], [255, 214, 120], [56, 150, 80], [140, 230, 180], [250, 246, 236]];
  const inPalette = (r: number, g: number, b: number) => palette.some((c) => Math.abs(c[0]! - r) + Math.abs(c[1]! - g) + Math.abs(c[2]! - b) < 12);
  await expect
    .poll(async () => {
      const p = await pixelsOf(canvas(page));
      return count(p, (r, g, b) => inPalette(r, g, b)) / (p.data.length / 4);
    }, { timeout: 10_000 })
    .toBeGreaterThan(0.98);

  // The app cannot take the sign away: removed, it is put back.
  await page.evaluate(() => document.querySelector(".k-camera-on")?.remove());
  await expect(sign(page)).toBeVisible();

  // Snap keeps what is on screen.
  await page.getByRole("button", { name: "Snap", exact: true }).click();
  await expect(page.locator(".k-toast").last()).toHaveText("“Pixel 1” is in your Gallery", { timeout: 15_000 });

  // Hidden (another tab, Home, the screen locked): off, and it stays off when the page comes back.
  await setHidden(page, true);
  await expect.poll(() => live(page)).toBe(0);
  await expect(sign(page)).toHaveCount(0);
  await setHidden(page, false);
  await expect(page.getByRole("heading", { name: "The camera is off" })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await live(page)).toBe(0);

  // Back on — the pixel monster moving with the camera again — then the shell's Turn off.
  await page.getByRole("button", { name: "Turn it back on" }).click();
  await expect(sign(page)).toBeVisible();
  await expect.poll(() => live(page)).toBe(1);
  await expect
    .poll(async () => {
      const one = await pixelsOf(canvas(page));
      await page.waitForTimeout(400);
      return changed(one, await pixelsOf(canvas(page)));
    })
    .toBeGreaterThan(0.002);
  await sign(page).getByRole("button", { name: "Turn off" }).click();
  await expect.poll(() => live(page)).toBe(0);
  await expect(sign(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "The camera is off" })).toBeVisible();

  // Leaving the mirror for the Gallery turns it off; the snap is there, as a real picture.
  await page.getByRole("button", { name: "Turn it back on" }).click();
  await expect.poll(() => live(page)).toBe(1);
  await page.locator(".k-tab, .k-nav a, .k-nav button", { hasText: "Gallery" }).first().click();
  await expect.poll(() => live(page)).toBe(0);
  await expect(sign(page)).toHaveCount(0);
  const piece = page.getByRole("button", { name: "Pixel 1, open" });
  await expect(piece).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => piece.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);

  // Back to the mirror: it was turned on before, so opening the mirror turns it on.
  await page.locator(".k-tab, .k-nav a, .k-nav button", { hasText: "Mirror" }).first().click();
  await expect.poll(() => live(page)).toBe(1);
  await expect(sign(page)).toBeVisible();

  // Leaving the app — whatever the app does — turns it off.
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.getByRole("dialog", { name: "Switch app" }).getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("button", { name: "Add an app" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => live(page)).toBe(0);
  await expect(sign(page)).toHaveCount(0);
});
