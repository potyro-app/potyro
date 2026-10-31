import { test, expect, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { addAsMine, changed, count, needEsmSh, packApp, pixelsOf, watchEsmSh } from "./library-demos";

// apps/photo-garden, packed as its build packs it and added as the person's own app, with p5 1.11.11
// fetched from the real esm.sh (#266 — and the fetcher fix that stopped refusing p5 1.x for merely
// mentioning `require`). The photo goes in the way a phone's would: ctx.caps.camera on the web is a
// file input, so the test answers its file chooser with a fixture. Every check reads the canvas.

const FLOWER = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));

/** Leaf green: the fixture's background. The dusk shown before a photo has none. */
const leafy = (r: number, g: number, b: number, a: number) => a > 100 && g > r + 25 && g > b + 15;
/** The flower's pink. */
const pink = (r: number, g: number, b: number, a: number) => a > 100 && r > 170 && g < 140 && b > 80 && b < 190 && r - g > 70;

test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });

const canvas = (page: Page) => page.locator(".pg-stage canvas");

async function choosePhoto(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose one" }).click();
  await (await chooser).setFiles({ name: "flower.png", mimeType: "image/png", buffer: FLOWER });
}

/** Drag across the canvas from one point to another (fractions of its box), in steps. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await canvas(page).boundingBox())!;
  const at = ([u, v]: [number, number]) => [box.x + u * box.width, box.y + v * box.height] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(...at([from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12]));
}

test("Photo Garden: p5 comes from esm.sh, a photo grows into a living picture that scatters under a drag, and Keep this lands in the Gallery", async ({ page }) => {
  test.setTimeout(120_000);
  await needEsmSh();
  const asked = watchEsmSh(page);
  const { card } = await addAsMine(page, "photo-garden.potyro-app.zip", packApp("photo-garden", "photo-garden.app.ts"));
  expect(card).toContain("fetches p5 1.11.11 from esm.sh");
  expect(card).toMatch(/Asks for camera/);
  expect([...new Set(asked)].sort()).toEqual(["https://esm.sh/p5@1.11.11/es2022/p5.bundle.mjs", "https://esm.sh/p5@1.11.11?bundle"]);

  // Before a photo: the idle dusk garden is already moving behind the welcome card. An artwork is
  // made by keeping the canvas, so the app offers no bare "Add: Artwork" form (quickActions: [], #484).
  await expect(page.getByRole("heading", { name: "Grow a garden from a photo" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Add: Artwork/ })).toHaveCount(0);
  await expect(canvas(page)).toHaveCount(1);
  const idleA = await pixelsOf(canvas(page));
  await page.waitForTimeout(600);
  expect(changed(idleA, await pixelsOf(canvas(page)))).toBeGreaterThan(0.01);
  expect(count(idleA, leafy)).toBeLessThan(idleA.data.length / 4 / 200);

  // A photo, through the camera capability: the specks take its colours and gather into it.
  await choosePhoto(page);
  await expect(page.getByRole("heading", { name: "Grow a garden from a photo" })).toBeHidden();
  await expect.poll(async () => count(await pixelsOf(canvas(page)), leafy), { timeout: 15_000 }).toBeGreaterThan(20_000);
  await expect.poll(async () => count(await pixelsOf(canvas(page), { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }), pink)).toBeGreaterThan(3_000);

  // Alive: the same picture, moving.
  const a = await pixelsOf(canvas(page));
  await page.waitForTimeout(500);
  expect(changed(a, await pixelsOf(canvas(page)))).toBeGreaterThan(0.01);

  // Mosaic settles still, so a drag's effect can be told from the drift: it tears the tiles apart
  // where it passes, and they settle back once it lets go.
  await page.getByRole("button", { name: "Mosaic", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mosaic", exact: true })).toHaveAttribute("aria-pressed", "true");
  const where = { x: 0.3, y: 0.3, w: 0.4, h: 0.3 };
  await expect
    .poll(
      async () => {
        const one = await pixelsOf(canvas(page), where);
        await page.waitForTimeout(150);
        return changed(one, await pixelsOf(canvas(page), where));
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(0.002);
  const settled = await pixelsOf(canvas(page), where);
  await drag(page, [0.32, 0.4], [0.68, 0.48]);
  expect(changed(settled, await pixelsOf(canvas(page), where))).toBeGreaterThan(0.08);
  await page.mouse.up();
  await expect.poll(async () => changed(settled, await pixelsOf(canvas(page), where)), { timeout: 10_000 }).toBeLessThan(0.03);

  // Keep this: a PNG in the app's folder and a record, shown in the Gallery as a real image.
  // Named for the photo's main colour and the style: cropped to this stage the flower fills the frame,
  // and its vivid pink outvotes the duller leaves.
  await page.getByRole("button", { name: "Keep this" }).click();
  const note = page.locator(".pg-kept-note");
  await expect(note).toContainText("Kept “Rose Tessera” in your gallery", { timeout: 15_000 });

  // The share moment, right there: Share hands the kept PNG to the system's save or share dialog
  // (ctx.files.export). The dialog is answered in the page, which reads the picture it is given.
  await page.evaluate(() => {
    const w = window as unknown as { __saved?: { name: string; w: number; h: number; pink: number }; showSaveFilePicker: unknown };
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const bmp = await createImageBitmap(data);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const g = c.getContext("2d")!;
          g.drawImage(bmp, 0, 0);
          const px = g.getImageData(0, 0, c.width, c.height).data;
          let pink = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i]! > 170 && px[i + 1]! < 140 && px[i + 2]! > 80 && px[i + 2]! < 190 && px[i]! - px[i + 1]! > 70) pink++;
          w.__saved = { name: suggestedName, w: c.width, h: c.height, pink };
        },
        close: async () => {},
      }),
    });
  });
  await note.getByRole("button", { name: "Share" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saved?: unknown }).__saved), { timeout: 10_000 }).toBeTruthy();
  const saved = await page.evaluate(() => (window as unknown as { __saved: { name: string; w: number; h: number; pink: number } }).__saved);
  expect(saved.name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-rose-tessera\.png$/);
  // The canvas as it was kept, pixel for pixel, with the flower in it.
  const size = await canvas(page).evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]);
  expect(size[0]).toBeGreaterThan(500);
  expect([saved.w, saved.h]).toEqual(size);
  expect(saved.pink).toBeGreaterThan(3_000);
  await expect(note).toBeHidden();
  await page.locator(".k-tab", { hasText: "Gallery" }).click();
  const piece = page.getByRole("button", { name: "Rose Tessera, open" });
  await expect(piece).toBeVisible({ timeout: 15_000 });
  await expect(piece).toContainText("Mosaic");
  const img = piece.locator("img");
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);

  // Leaving the Studio removed the p5 instance and its canvas.
  await expect(page.locator(".pg-stage")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);

  // The record carries the file.
  await piece.click();
  const box = page.getByRole("dialog", { name: "Rose Tessera" });
  await expect(box.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(() => box.locator("img").evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBeGreaterThan(500);
  // Share hands the picture itself to Potyro's share dialog, which shows it before it goes.
  await box.getByRole("button", { name: "Share" }).click();
  const share = page.locator(".k-share-dialog");
  const preview = share.getByRole("img", { name: /\.png$/ });
  await expect.poll(() => preview.evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBeGreaterThan(500);
  await share.getByRole("button", { name: "Done" }).click();
  await expect(share).toHaveCount(0);
  await box.getByRole("button", { name: "Close" }).click();
  await expect(box).toHaveCount(0);
});
