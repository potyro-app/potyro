import { test, expect, type Frame, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installShared, startGapMeter, startProbe, type Probe } from "./realm.js";

// Sealed apps draw their own screens (#267, docs/22 §11): a shared app's custom view renders in a
// sandboxed frame of its own, on every engine, behind a watchdog and a crash-loop guard. What is
// checked is the real thing — the frame's own DOM and pixels, keys and taps reaching it, its writes
// landing in the shell's store, the probe server's count — never only that an element exists.
//
// The default `sandbox` project's Chromium is the headless shell: no site isolation, so the frame
// shares the shell's thread there, as in Firefox and WebKit. Only `channel: "chromium"` puts it out
// of process, which is where an endless loop is survivable (docs/22 §4.2).

test.use({ viewport: { width: 1280, height: 800 } });

const FIXTURE = readFileSync(fileURLToPath(new URL("./fixtures/sealed-views.app.tsx", import.meta.url)), "utf8");

let probe: Probe;
test.beforeAll(async () => {
  probe = await startProbe();
});
test.afterAll(async () => {
  await probe.close();
});

async function open(page: Page): Promise<void> {
  probe.hits.length = 0;
  await page.addInitScript(() => localStorage.setItem("potyro-secret", "the shell's own"));
  await installShared(page, "sealed-views", "Sealed views", FIXTURE.replaceAll("__PROBE__", probe.origin));
}

/** The view's frame, once its screen is up. */
async function viewFrame(page: Page): Promise<Frame> {
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveCount(1, { timeout: 30_000 });
  const handle = await el.elementHandle();
  const frame = await handle!.contentFrame();
  await expect.poll(async () => (await frame!.locator("#sv-title").count()) > 0, { timeout: 30_000 }).toBe(true);
  return frame!;
}

const toast = (page: Page) => page.locator(".k-toast").last();
const notice = (page: Page) => page.locator(".k-sealed-notice");

test("a shared app's own screen renders in its sandboxed frame: its DOM, its pixels, its input, its writes", async ({ page }) => {
  await open(page);
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveAttribute("sandbox", "allow-scripts", { timeout: 30_000 });
  const srcdoc = String(await el.getAttribute("srcdoc"));
  expect(srcdoc).toContain("default-src 'none'");
  expect(srcdoc).toContain("connect-src 'none'");
  await expect(el).toHaveAttribute("title", /Board/);
  const frame = await viewFrame(page);

  // The frame is its own opaque origin, and the screen is the app's React tree, in it.
  expect(await frame.evaluate(() => self.origin)).toBe("null");
  await expect(frame.locator("#sv-title")).toHaveText("Sealed board");
  await expect(frame.locator("#sv-count")).toHaveText("0 notes");

  // Real pixels on its canvas, and a tap on it changes them.
  const red = () => frame.evaluate(() => {
    const c = document.getElementById("sv-canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 1]! < 80 && d[i + 3]! > 200) n++;
    return n;
  });
  await expect.poll(red).toBe(40 * 40);
  await frame.locator("#sv-canvas").click({ position: { x: 5, y: 5 } });
  await expect.poll(red).toBe(60 * 40);

  // Keys reach it once it has focus.
  await frame.locator("#sv-title").click();
  await page.keyboard.press("k");
  await expect(frame.locator("#sv-key")).toHaveText("key: k");

  // Its theme is the shell's.
  const shellInk = await page.locator(".k-app").evaluate((n) => getComputedStyle(n).getPropertyValue("--ink").trim());
  await expect(frame.locator("#sv-ink")).toHaveText(shellInk);

  // A write from the screen lands in the shell's store: the frame's live query and the plain list both see it.
  await frame.locator("#sv-add").click();
  await expect(frame.locator("#sv-count")).toHaveText("1 notes");
  await frame.locator("#sv-go").click();
  await expect(page.getByRole("listitem").filter({ hasText: "from the screen 1" })).toHaveCount(1);
});
