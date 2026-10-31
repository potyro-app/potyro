import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { drawSharedPicture, fakeShareSheet } from "./share-files";

// apps/piano, packed with its plan as its build packs it and added as the person's own app, on a
// phone. The share moment (#484): ticking the day's last block shows "Day done" with the minutes
// practised, and Share hands a 1080×1350 picture of the day to Potyro's share dialog (ctx.ui.share) —
// a keyboard across its top, a strip of the app's colour under it, the minutes in the same colour, the
// week in a footer band. The dialog shows it; its Share hands it to the share sheet, which keeps what
// it was given, so this reads the picture itself.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" });

test("Piano: a finished day says so, with its minutes, and Share makes a picture of it", async ({ page }) => {
  await fakeShareSheet(page);
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

  // The Day done line reads as text on the app's tint: --ink, not the softer grey.
  await expect(done.locator("p")).toHaveCSS("color", "rgb(35, 31, 32)"); // --ink, #231f20
  expect(await done.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  const share = done.getByRole("button", { name: "Share" });
  await share.click();
  const dialog = page.getByRole("dialog", { name: "Day done" });
  const preview = dialog.getByRole("img", { name: /^piano-\d{4}-\d{2}-\d{2}\.png$/ });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => preview.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1080);
  await expect(share).toBeDisabled();
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(share).toBeEnabled();
  const picture = await drawSharedPicture(page);
  expect(picture.name).toMatch(/^piano-\d{4}-\d{2}-\d{2}\.png$/);
  expect([picture.w, picture.h]).toEqual([1080, 1350]);
  const shared = await page.evaluate(() => {
    const g = (window as unknown as { __picture: CanvasRenderingContext2D }).__picture;
    const W = g.canvas.width;
    const rgb = (css: string): number[] => {
      const p = document.createElement("canvas").getContext("2d")!;
      p.fillStyle = css;
      p.fillRect(0, 0, 1, 1);
      return [...p.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const traco = rgb(getComputedStyle(document.querySelector(".pn")!).getPropertyValue("--traco").trim());
    const at = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
    const tally = (y0: number, y1: number, t: number[]) => {
      const px = g.getImageData(0, y0, W, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i]! - t[0]!) < 10 && Math.abs(px[i + 1]! - t[1]!) < 10 && Math.abs(px[i + 2]! - t[2]!) < 10) n++;
      return n;
    };
    return {
      // Fifteen white keys, 72 wide: E's upper half (no black key over it), and D♯.
      whiteKey: at(196, 90),
      blackKey: at(144, 90),
      // The strip under the keys, and the minutes below the title: both the app's own orange.
      felt: tally(300, 314, traco),
      minutes: tally(560, 740, traco),
      // The footer band (the surface colour, #f3f3f4) runs to the card's foot: no empty white under the week.
      band: [at(4, 1110), at(4, 1345)],
    };
  });
  expect(shared.whiteKey).toEqual([255, 255, 255]);
  expect(Math.max(...shared.blackKey)).toBeLessThan(50);
  expect(shared.felt).toBeGreaterThan(1080 * 14 * 0.95);
  expect(shared.minutes).toBeGreaterThan(3_000);
  expect(shared.band).toEqual([
    [243, 243, 244],
    [243, 243, 244],
  ]);

  // Untick one: the day is no longer done.
  await checks.nth(4).click();
  await expect(done).toHaveCount(0);
});
