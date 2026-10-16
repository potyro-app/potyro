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

/**
 * Press a button in the frame without waiting for the frame to finish handling it: a click Playwright
 * performs waits for the frame's input to be acknowledged, which a spinning frame never does.
 */
async function press(frame: Frame, selector: string): Promise<void> {
  await frame.evaluate((sel) => void setTimeout(() => (document.querySelector(sel) as HTMLElement).click(), 50), selector);
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

test("nothing the screen tries reaches the network, the shell's storage, the top page or another op", async ({ page, consoleGuard }) => {
  consoleGuard.allow(
    /Refused to|Content Security Policy|Content-Security-Policy|Blocked form submission|Blocked opening|Blocked a frame|sandbox|SecurityError|Unsafe attempt|not allowed to navigate|Failed to load|NetworkError|access-control|WebSocket connection|EventSource|ERR_BLOCKED|beacon|can.t establish a connection/i,
    "the adversarial screen tries every way out on purpose; the browser says it refused each one",
  );
  await open(page);
  const before = page.url();
  await page.evaluate(() => (document.cookie = "potyro-cookie=the-shells"));
  const frame = await viewFrame(page);
  // The shell hears every message the frame posts to it, and acts on none of them.
  await page.evaluate(() => {
    const w = window as unknown as { __fromFrame: number };
    w.__fromFrame = 0;
    window.addEventListener("message", () => w.__fromFrame++);
  });
  await frame.locator("#sv-escape").click();
  await expect(toast(page)).toContainText('"origin"', { timeout: 60_000 });
  const report = JSON.parse(String(await toast(page).textContent())) as Record<string, string>;

  expect(report["origin"]).toMatch(/opaque origin null/);
  // Refused (Chromium, Firefox), or a cookie jar of its own that is empty (WebKit): never the shell's.
  expect(report["document.cookie"]).toMatch(/^(blocked|ALLOWED: $)/);
  expect(JSON.stringify(report)).not.toContain("the-shells");
  for (const k of ["localStorage", "sessionStorage", "indexedDB", "parent.document", "parent.localStorage", "top.location.href", "fetch(probe)", "WebSocket(relay)", "EventSource", "<img src>", "window.open", "top navigation", "RTCPeerConnection"]) {
    expect(report[k], k).toMatch(/^blocked/);
  }
  expect(report["raw op: relay.connect"]).toBe("blocked: op not allowed: relay.connect");
  expect(report["raw op: space.invite"]).toBe("blocked: op not allowed: space.invite");
  expect(report["raw op: unknown ctxId"]).toBe("blocked: no such ctx");

  // What actually happened: nothing reached the probe, the shell is where it was with its secret, no
  // trust dialog opened and no record was written by the messages posted to the shell directly.
  await page.waitForTimeout(800);
  expect(probe.hits).toEqual([]);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("potyro-secret"))).toBe("the shell's own");
  expect(await page.evaluate(() => (window as unknown as { __fromFrame: number }).__fromFrame)).toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(frame.locator("#sv-count")).toHaveText("0 notes");
});

/** Whether this engine puts the view's frame out of the shell's process (desktop Chromium only). */
const outOfProcess = (projectName: string) => projectName === "sandbox-chromium-full";

test("a screen that spins for 3 s is replaced by the app's plain version, calmly, and can be tried again", async ({ page }, info) => {
  await open(page);
  const frame = await viewFrame(page);
  const gap = await startGapMeter(page);
  const started = Date.now();
  await press(frame, "#sv-spin");
  await expect(notice(page)).toContainText("This app’s screen stopped responding, so Potyro is showing its plain version.", { timeout: 15_000 });
  expect(Date.now() - started).toBeLessThan(8_000);
  await expect(page.locator(".k-sealed-view iframe")).toHaveCount(0);
  // Never an error: a status, the app's other pages, and the way back.
  await expect(notice(page)).toHaveAttribute("role", "status");
  await expect(page.locator(".k-view-error, .k-part-problem")).toHaveCount(0);
  // Out of process the shell never froze; sharing its thread, it did for the loop's length only.
  if (outOfProcess(info.project.name)) expect(await gap()).toBeLessThan(250);

  // The rest of the app works on: its plain page, and its logic in the realm.
  await notice(page).getByRole("button", { name: "Notes" }).click();
  await page.locator(".k-page-action", { hasText: "Still here?" }).click();
  await expect(toast(page)).toHaveText("still here: 1.234,5");

  // Back on the screen's page it stays plain until the person asks; then the screen is back.
  await page.goto("/?user=sealed-views");
  await expect(notice(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-sealed-view iframe")).toHaveCount(0);
  await notice(page).getByRole("button", { name: "Try its screen again" }).click();
  const again = await viewFrame(page);
  await expect(again.locator("#sv-count")).toHaveText("0 notes");
});

test("a screen that never stops is stopped where the frame runs apart, and the sandbox's process is freed", async ({ page }, info) => {
  test.skip(!outOfProcess(info.project.name), "only survivable where the frame is out of process (docs/22 §4.2): elsewhere it hangs the tab, which the crash-loop guard below covers");
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await open(page);
  const frame = await viewFrame(page);
  const gap = await startGapMeter(page);
  await press(frame, "#sv-forever");
  await expect(notice(page)).toBeVisible({ timeout: 15_000 });
  expect(await gap()).toBeLessThan(250);
  // The logic frame shared the spinning view's process and could not answer: every realm restarted.
  await expect.poll(() => warnings.some((w) => /every sealed box was restarted/.test(w)), { timeout: 10_000 }).toBe(true);
  // A new screen mounts and answers: the process holding the endless loop is gone.
  await notice(page).getByRole("button", { name: "Try its screen again" }).click();
  const again = await viewFrame(page);
  await again.locator("#sv-add").click();
  await expect(again.locator("#sv-count")).toHaveText("1 notes");
});

test("a tab that died with a screen mounting: the next start opens the plain version, never the screen, until asked", async ({ page }) => {
  // What a tab frozen by an endless loop leaves behind when the person closes or reloads it: the
  // marker written before the view mounted, never refreshed again.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded-marker")) return;
    sessionStorage.setItem("seeded-marker", "1");
    localStorage.setItem("potyro:sealed-view:mounting:deadtab:1", JSON.stringify({ app: "sealed-views", page: "board", at: Date.now() - 60_000 }));
  });
  await open(page);
  await expect(notice(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-sealed-view iframe")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("potyro:sealed-view:mounting:deadtab")))).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("potyro:sealed-view:off") ?? "{}"))).toHaveProperty("sealed-views");
  // A reload is a new start: still plain.
  await page.reload();
  await expect(notice(page)).toBeVisible({ timeout: 30_000 });
  await notice(page).getByRole("button", { name: "Try its screen again" }).click();
  const frame = await viewFrame(page);
  await expect(frame.locator("#sv-title")).toHaveText("Sealed board");
  expect(await page.evaluate(() => localStorage.getItem("potyro:sealed-view:off"))).toBeNull();
});

test("the screen follows the shell's theme, light and dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  const frame = await viewFrame(page);
  const ink = () => page.locator(".k-app").evaluate((n) => getComputedStyle(n).getPropertyValue("--ink").trim());
  const light = await ink();
  await expect(frame.locator("#sv-ink")).toHaveText(light);
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await ink();
  expect(dark).not.toBe(light);
  await expect.poll(() => frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim())).toBe(dark);
  expect(await frame.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
});
