import { test, expect, type Frame, type Page } from "./console-guard";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Breakout, added from its package as someone else's app (sealed), plays (#267): its `mount` screen
// draws on a canvas in its own sandboxed frame, reads its levels with ctx.files and its best score
// with ctx.storage through the mediated ctx, and takes the keyboard and the pointer. The evidence is
// the canvas's own pixels, read inside the frame, before and after a key and a pointer move.

const PACK = fileURLToPath(new URL("../scripts/pack-app.mjs", import.meta.url));
const BREAKOUT = fileURLToPath(new URL("../apps/breakout", import.meta.url));

function pack(from: string, files: string[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "sealed-breakout-"));
  for (const f of files) copyFileSync(join(from, f), join(dir, f));
  execFileSync("node", [PACK, ...files, "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
  return readFileSync(join(dir, "out.zip"));
}

async function addSealed(page: Page, name: string, zip: Buffer): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([{ name: `${name}.potyro-app.zip`, mimeType: "application/zip", buffer: zip }]);
  await expect(dialog.getByRole("region", { name: new RegExp(`About ${name}`, "i") })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
}

/** A cheap fingerprint of the canvas's pixels, and how many of them are drawn. */
const look = (frame: Frame) =>
  frame.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!c || !c.width) return { drawn: 0, hash: 0 };
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    let hash = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! > 0) drawn++;
      hash = (Math.imul(hash, 31) + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7 + d[i + 3]! * 11) | 0;
    }
    return { drawn, hash };
  });

for (const width of [1280, 412]) {
  test(`Breakout, sealed, draws its board and plays in its frame (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 800 ? 800 : 915 });
    await addSealed(page, "Breakout", pack(BREAKOUT, ["breakout.app.ts", "levels.json"]));
    const el = page.locator(".k-sealed-view iframe");
    await expect(el).toHaveCount(1, { timeout: 30_000 });
    await expect(el).toHaveAttribute("sandbox", "allow-scripts");
    const frame = (await (await el.elementHandle())!.contentFrame())!;
    // The board is drawn: bricks from levels.json, read through ctx.files in the sealed box.
    await expect.poll(async () => (await look(frame)).drawn, { timeout: 30_000 }).toBeGreaterThan(5000);
    // The frame fills the room it was given, and the canvas fits inside it.
    const box = await el.boundingBox();
    expect(box!.width).toBeGreaterThan(width > 800 ? 600 : 300);
    expect(box!.height).toBeGreaterThanOrEqual(320);

    // Waiting to launch, the board holds still.
    const before = await look(frame);
    await page.waitForTimeout(300);
    expect((await look(frame)).hash).toBe(before.hash);

    // Space launches the ball (the frame has the keyboard once tapped into): the board moves.
    await frame.locator("canvas").focus();
    await el.focus();
    await page.keyboard.press("Space");
    const seen = new Set<number>();
    for (let i = 0; i < 5; i++) {
      seen.add((await look(frame)).hash);
      await page.waitForTimeout(120);
    }
    expect(seen.size).toBeGreaterThan(3);

    // The pointer steers the paddle: P pauses, then moving the pointer changes what is drawn.
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    const paused = await look(frame);
    await page.waitForTimeout(200);
    expect((await look(frame)).hash).toBe(paused.hash);
    const canvasBox = await frame.locator("canvas").boundingBox();
    await page.mouse.move(canvasBox!.x + 10, canvasBox!.y + canvasBox!.height - 20);
    await expect.poll(async () => (await look(frame)).hash).not.toBe(paused.hash);
  });
}
