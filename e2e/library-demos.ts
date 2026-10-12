// Shared steps for the library demo apps (apps/mood-sleep, apps/photo-garden): pack an app exactly as
// its `build` script does, add it through Add an app as the person's own, and read what a canvas
// really shows.
//
// These specs fetch the libraries from the REAL esm.sh, on purpose: they are the real-world check of
// #266 that the fixture-served libraries-trusted.spec.ts cannot be. With no route to esm.sh they skip
// and say why, rather than fail for a reason that has nothing to do with the code.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Pack `apps/<app>` the way its package.json `build` does; returns the zip's bytes. */
export function packApp(app: string, entry: string, extra: string[] = []): Buffer {
  const dir = mkdtempSync(join(tmpdir(), `${app}-e2e-`));
  const cwd = join(process.cwd(), "apps", app);
  const out = join(dir, `${app}.potyro-app.zip`);
  execFileSync(process.execPath, [join(process.cwd(), "scripts/pack-app.mjs"), entry, ...extra, "-o", out], { cwd, env: { ...process.env, INIT_CWD: cwd } });
  return readFileSync(out);
}

/** Skip the calling test when esm.sh cannot be reached from here. */
export async function needEsmSh(): Promise<void> {
  let reachable = false;
  try {
    const res = await fetch("https://esm.sh/", { method: "HEAD", signal: AbortSignal.timeout(8_000) });
    reachable = res.status < 500;
  } catch {
    reachable = false;
  }
  test.skip(!reachable, "esm.sh is not reachable from this machine: these specs check the real library fetch (#266)");
}

/** Every request the page makes to esm.sh, in order. */
export function watchEsmSh(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://esm.sh/")) asked.push(r.url());
  });
  return asked;
}

/** Add a package from this device, as mine; returns the card as it read before Add. */
export async function addAsMine(page: Page, name: string, zip: Buffer): Promise<{ card: string }> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer: zip });
  const about = dialog.getByRole("region", { name: /About / });
  await expect(about).toBeVisible({ timeout: 30_000 });
  const card = (await about.innerText()).replace(/\s+/g, " ");
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 60_000 });
  return { card };
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row, in the canvas's own pixels. */
  data: Uint8Array;
}

/**
 * What a canvas holds right now, optionally only a box of it (fractions of its size). The bytes come
 * back as base64: a whole canvas as a JSON array is millions of numbers, slow enough under load to eat
 * a poll's whole timeout.
 */
export async function pixelsOf(canvas: Locator, box?: { x: number; y: number; w: number; h: number }): Promise<Pixels> {
  const got = await canvas.evaluate((el, b) => {
    const c = el as HTMLCanvasElement;
    const g = c.getContext("2d")!;
    const x = Math.floor((b?.x ?? 0) * c.width);
    const y = Math.floor((b?.y ?? 0) * c.height);
    const w = Math.max(1, Math.floor((b?.w ?? 1) * c.width));
    const h = Math.max(1, Math.floor((b?.h ?? 1) * c.height));
    const d = g.getImageData(x, y, w, h).data;
    let bin = "";
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { width: w, height: h, b64: btoa(bin) };
  }, box);
  return { width: got.width, height: got.height, data: new Uint8Array(Buffer.from(got.b64, "base64")) };
}

/** How many pixels pass `test` (r, g, b, a). */
export function count(p: Pixels, test: (r: number, g: number, b: number, a: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) if (test(p.data[i]!, p.data[i + 1]!, p.data[i + 2]!, p.data[i + 3]!)) n++;
  return n;
}

/** Share of pixels that differ noticeably between two reads of the same box. */
export function changed(a: Pixels, b: Pixels): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    if (d > 40) n++;
  }
  return n / (a.data.length / 4);
}

/** Pixels within `tol` of a colour (per channel). */
export const near = (rgb: [number, number, number], tol = 40) => (r: number, g: number, b: number, a: number) =>
  a > 100 && Math.abs(r - rgb[0]) <= tol && Math.abs(g - rgb[1]) <= tol && Math.abs(b - rgb[2]) <= tol;
