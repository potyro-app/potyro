import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";

// apps/piano, packed with its plan as its build packs it and added as the person's own app, on a
// phone. The share moment (#484): ticking the day's last block shows "Day done" with the minutes
// practised, and Share hands a 1080×1350 picture of the day to the system's save or share dialog
// (ctx.files.export) — a keyboard across its top, a strip of the app's colour under it, the minutes
// in the app's colour. The dialog is answered in the page, which reads the picture it is given.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" });

interface Shared {
  name: string;
  w: number;
  h: number;
  whiteKey: number[];
  blackKey: number[];
  felt: number;
  minutes: number;
}

test("Piano: a finished day says so, with its minutes, and Share makes a picture of it", async ({ page }) => {
  await addAsMine(page, "piano.potyro-app.zip", packApp("piano", "piano.app.tsx", ["plan.json"]));
  await expect(page.locator(".pn-title")).toContainText("Week 1", { timeout: 30_000 });

  // Not done until every block is ticked.
  const done = page.locator(".pn-daydone");
  const checks = page.locator(".pn-check");
  await expect(checks).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(done).toHaveCount(0);
    await checks.nth(i).click();
    await expect(checks.nth(i)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(done).toContainText("Day done");
  // Week 1's five blocks: 5 + 8 + 10 + 10 + 7 minutes.
  await expect(done).toContainText("40 min practised");

  await page.evaluate(() => {
    const w = window as unknown as { __shared?: Shared; showSaveFilePicker: unknown };
    const rgb = (css: string): number[] => {
      const g = document.createElement("canvas").getContext("2d")!;
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const style = getComputedStyle(document.querySelector(".pn")!);
    const traco = rgb(style.getPropertyValue("--traco").trim());
    const tinta = rgb(style.getPropertyValue("--tinta-l").trim());
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const bmp = await createImageBitmap(data);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const g = c.getContext("2d")!;
          g.drawImage(bmp, 0, 0);
          const at = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
          const tally = (y0: number, y1: number, t: number[]) => {
            const px = g.getImageData(0, y0, c.width, y1 - y0).data;
            let n = 0;
            for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i]! - t[0]!) < 10 && Math.abs(px[i + 1]! - t[1]!) < 10 && Math.abs(px[i + 2]! - t[2]!) < 10) n++;
            return n;
          };
          w.__shared = {
            name: suggestedName,
            w: c.width,
            h: c.height,
            // Fifteen white keys, 72 wide: E's upper half (no black key over it), and D♯.
            whiteKey: at(196, 90),
            blackKey: at(144, 90),
            // The strip under the keys, and the minutes below the title.
            felt: tally(300, 314, traco),
            minutes: tally(560, 740, tinta),
          };
        },
        close: async () => {},
      }),
    });
  });
  await done.getByRole("button", { name: "Share" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared), { timeout: 15_000 }).toBeTruthy();
  const shared = await page.evaluate(() => (window as unknown as { __shared: Shared }).__shared);
  expect(shared.name).toMatch(/^piano-\d{4}-\d{2}-\d{2}\.png$/);
  expect([shared.w, shared.h]).toEqual([1080, 1350]);
  expect(shared.whiteKey).toEqual([255, 255, 255]);
  expect(Math.max(...shared.blackKey)).toBeLessThan(50);
  expect(shared.felt).toBeGreaterThan(1080 * 14 * 0.95);
  expect(shared.minutes).toBeGreaterThan(3_000);

  // Untick one: the day is no longer done.
  await checks.nth(4).click();
  await expect(done).toHaveCount(0);
});
