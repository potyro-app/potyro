import { test, expect, type Page } from "./console-guard";
import { addAsMine, count, packApp, pixelsOf } from "./library-demos";
import { canvas, eyeWhites, onStage } from "./mirror-faces";

// Faces in the live camera (docs/25 §Faces), through Mirror Monsters, with the face SCRIPTED: the dev
// shell's `potyro:faces = "script"` hands the live camera faces read from localStorage instead of
// running the model, so each claim says exactly where the face is and what it does. The model itself
// is mirror-faces-model-trusted.spec.ts. Every claim reads the canvas.
//
//   - the monster's googly eyes sit on the face's eyes — and follow when the face moves or tilts;
//   - its mouth opens (a tongue shows) when the face's mouth opens, its eyes shut when the face blinks;
//   - with faces failing to load, the app says so once and the monster still sits on the blob.

test.use({
  viewport: { width: 412, height: 860 },
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

interface Sketch {
  x: number;
  y: number;
  size: number;
  roll?: number;
  expressions?: Record<string, number>;
}

/** Script the faces the camera "finds" (fractions of the picture; `size` its width's fraction). */
async function script(page: Page, faces: Sketch[]): Promise<void> {
  await page.evaluate((f) => localStorage.setItem("potyro:faces-script", JSON.stringify(f)), faces);
}

/** Where a scripted face's eyes land on the canvas, and the googly eye's radius there. */
async function expectedEyes(page: Page, f: Sketch): Promise<{ eyes: { x: number; y: number }[]; r: number }> {
  const { cw, ch } = await canvas(page).evaluate((el) => ({ cw: (el as HTMLCanvasElement).width, ch: (el as HTMLCanvasElement).height }));
  // The camera's own size and facing (each engine's fake camera has its own), as its track reports them.
  const { vw, vh, mirrored } = await page.evaluate(() => (window as unknown as { __video: { vw: number; vh: number; mirrored: boolean } }).__video);
  const size = f.size * vw;
  const roll = f.roll ?? 0;
  const at = (u: number, v: number) => ({ x: f.x * vw + (u * Math.cos(roll) - v * Math.sin(roll)) * size, y: f.y * vh + (u * Math.sin(roll) + v * Math.cos(roll)) * size });
  const eyes = [at(-0.2, -0.1), at(0.2, -0.1)].map((e) => onStage(e, vw, vh, cw, ch, mirrored));
  // The googly eye: 1.25 times half the eye's width (0.18 of the face's).
  return { eyes, r: 0.09 * size * eyes[0]!.k * 1.25 };
}

/** "on the eyes" when most of each expected eye is white and little is elsewhere (the fangs are white too); else what was seen. */
async function onTheEyes(page: Page, want: { eyes: { x: number; y: number }[]; r: number }): Promise<string> {
  const w = await eyeWhites(page, want.eyes, want.r);
  return Math.min(...w.near) > 0.45 && w.stray < 0.15 ? "on the eyes" : JSON.stringify(w);
}

const TONGUE = (r: number, g: number, b: number) => Math.abs(r - 224) < 14 && Math.abs(g - 80) < 14 && Math.abs(b - 122) < 14;

async function start(page: Page, mode: "script" | "fail", faces: Sketch[] = []): Promise<void> {
  await page.addInitScript(
    ([m, f]) => {
      localStorage.setItem("potyro:faces", m);
      localStorage.setItem("potyro:faces-script", f);
      const md = navigator.mediaDevices;
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => {
        const s = await real(c);
        const set = s.getVideoTracks()[0]?.getSettings() ?? {};
        (window as unknown as { __video: { vw: number; vh: number; mirrored: boolean } }).__video = {
          vw: set.width ?? 640,
          vh: set.height ?? 480,
          mirrored: set.facingMode !== "environment",
        };
        return s;
      };
    },
    [mode, JSON.stringify(faces)] as const,
  );
  await addAsMine(page, "mirror-monsters.potyro-app.zip", packApp("mirror-monsters", "mirror-monsters.app.ts"));
  await expect(page.getByRole("heading", { name: "Meet your monster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Turn on the camera" }).click();
  await expect(page.getByTestId("camera-on")).toBeVisible();
}

test("Mirror Monsters: the monster's eyes sit on the face's eyes, its mouth opens with theirs, it blinks with them", async ({ page }) => {
  test.setTimeout(120_000);
  const face: Sketch = { x: 0.5, y: 0.45, size: 0.32 };
  await start(page, "script", [face]);

  // On the eyes: most of each expected eye's disc is the googly eye's white, and almost no white is anywhere else.
  let want = await expectedEyes(page, face);
  await expect.poll(() => onTheEyes(page, want), { timeout: 10_000 }).toBe("on the eyes");

  // The face moves and tilts: the eyes go with it.
  const moved: Sketch = { x: 0.36, y: 0.52, size: 0.28, roll: 0.35 };
  await script(page, [moved]);
  want = await expectedEyes(page, moved);
  await expect.poll(() => onTheEyes(page, want), { timeout: 10_000 }).toBe("on the eyes");

  // Mouth shut: no tongue. Mouth open: the monster's mouth opens and its tongue shows.
  await script(page, [face]);
  await expect.poll(async () => count(await pixelsOf(canvas(page)), TONGUE), { timeout: 10_000 }).toBe(0);
  await script(page, [{ ...face, expressions: { mouthOpen: 1, jawOpen: 1 } }]);
  await expect.poll(async () => count(await pixelsOf(canvas(page)), TONGUE), { timeout: 10_000 }).toBeGreaterThan(300);

  // A blink: the lids come down over the whites.
  await script(page, [face]);
  want = await expectedEyes(page, face);
  const open = (await eyeWhites(page, want.eyes, want.r)).total;
  await script(page, [{ ...face, expressions: { blinkLeft: 1, blinkRight: 1 } }]);
  await expect.poll(async () => (await eyeWhites(page, want.eyes, want.r)).total, { timeout: 10_000 }).toBeLessThan(open * 0.3);
});

test("Mirror Monsters: when faces cannot be found it says so once, and the monster still sits on the skin-tone blob", async ({ page }) => {
  await start(page, "fail");
  await expect(page.locator(".k-toast").last()).toHaveText("The monster can’t see faces on this device, so it follows the colours of your skin instead.", { timeout: 15_000 });
  const whites = (r: number, g: number, b: number) => r > 250 && g > 248 && b > 240 && b < 252;
  await expect.poll(async () => count(await pixelsOf(canvas(page)), whites), { timeout: 10_000 }).toBeGreaterThan(2_000);
  // Once, not every frame.
  await page.waitForTimeout(800);
  expect(await page.locator(".k-toast", { hasText: "can’t see faces" }).count()).toBeLessThanOrEqual(1);
});
