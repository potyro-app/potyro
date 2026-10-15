import { test, expect, type Page } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { canvas, eyeWhites, onStage } from "./mirror-faces";

// Faces from the REAL model (docs/25 §Faces): MediaPipe's Face Landmarker, loaded by the shell from the
// files it serves itself, finding the face in a picture Chromium's fake camera plays from a file —
// Leonardo's Mona Lisa (public domain), whose eyes are at known places in the frame. The monster's
// googly eyes landing on HER eyes is the claim that the model loaded, ran, and that its points come
// back in the frame's own, unmirrored, coordinates.
//
// e2e/fixtures/face-mona-lisa.mjpeg: 640×480, six frames of a slight zoom. Her eyes, measured on the
// frame: (256, 196) and (322, 196), about 30 px wide.

test.use({
  viewport: { width: 412, height: 860 },
  colorScheme: "light",
  hasTouch: true,
  permissions: async ({ browserName }, use) => use(browserName === "chromium" ? ["camera"] : []),
  launchOptions: [
    async ({ browserName }, use) =>
      use(
        browserName === "chromium"
          ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-video-capture=e2e/fixtures/face-mona-lisa.mjpeg"] }
          : {},
      ),
    { scope: "worker" },
  ],
});

const EYES = [
  { x: 256, y: 196 },
  { x: 322, y: 196 },
];

/** Every request the page and its workers make for the face finder's files. */
function watchFaces(page: Page): string[] {
  const asked: string[] = [];
  page.context().on("request", (r) => {
    if (r.url().includes("/potyro-faces/")) asked.push(new URL(r.url()).pathname);
  });
  return asked;
}

test("Faces: the real model finds the face in the camera's picture, and the monster's eyes land on its eyes", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium's fake camera can play a file");
  test.setTimeout(180_000);
  const asked = watchFaces(page);
  await addAsMine(page, "mirror-monsters.potyro-app.zip", packApp("mirror-monsters", "mirror-monsters.app.ts"));
  await expect(page.getByRole("heading", { name: "Meet your monster" })).toBeVisible({ timeout: 30_000 });
  // Nothing of the face finder is fetched until an app asks for faces.
  expect(asked).toEqual([]);

  await page.getByRole("button", { name: "Turn on the camera" }).click();
  await expect(page.getByTestId("camera-on")).toBeVisible();

  const { cw, ch } = await canvas(page).evaluate((el) => ({ cw: (el as HTMLCanvasElement).width, ch: (el as HTMLCanvasElement).height }));
  const eyes = EYES.map((e) => onStage(e, 640, 480, cw, ch));
  // Her eye is ~30 px wide; the googly eye is 1.25 times half of it.
  const r = 15 * eyes[0]!.k * 1.25;
  await expect
    .poll(
      async () => {
        const w = await eyeWhites(page, eyes, r);
        return Math.min(...w.near) > 0.4 && w.stray < 0.15 ? "on her eyes" : JSON.stringify(w);
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toBe("on her eyes");

  // Served from Potyro's own origin, by the shell: the runtime and the model.
  expect(asked.some((u) => u.endsWith("/face_landmarker.task"))).toBe(true);
  expect(asked.some((u) => u.endsWith(".wasm"))).toBe(true);
  // No toast: faces loaded.
  await expect(page.locator(".k-toast", { hasText: "can’t see faces" })).toHaveCount(0);
});
